# Deployment

Production deployment guide for Remote Dev. This document covers the blue/green
slot-swap deploy model, the auto-deploy webhook (GitHub Actions → HMAC-signed
POST), the poll-based auto-update alternative, the npm deploy scripts, the
relationship to the `rdv` process manager, and operator gotchas observed in
production.

> **Audience:** operators self-hosting Remote Dev in production.
> For multi-instance / Kubernetes deployments see [`MULTI_INSTANCE.md`](./MULTI_INSTANCE.md).
> For first-time install and environment setup see [`SETUP.md`](./SETUP.md).

---

## 1. Deploy model: blue/green slot swap

Production runs the **standalone Next.js build** plus the **terminal server**,
both served over **Unix sockets** under `~/.remote-dev/run/`. New builds are
compiled into an *inactive* slot while the *active* slot keeps serving, then the
running servers are restarted onto the new build and health-checked before the
deploy is committed. If health checks fail, the deploy rolls back automatically.

Source of truth: [`scripts/deploy.ts`](../scripts/deploy.ts).

### Directory layout

All deploy state lives under the data dir (`RDV_DATA_DIR`, default `~/.remote-dev`):

```
~/.remote-dev/
├── deploy/
│   ├── state.json      # Active slot, commit SHA, timestamps, previous slot
│   ├── deploy.lock     # PID-based concurrent-deploy lock (O_EXCL create)
│   └── deploy.log      # Append-only deploy history
├── builds/
│   ├── blue/standalone/   # Build slot A (standalone output + static + public)
│   └── green/standalone/  # Build slot B
├── run/
│   ├── nextjs.sock     # Next.js Unix socket
│   └── terminal.sock   # Terminal server Unix socket
└── server/
    ├── next.pid        # Running Next.js PID
    └── terminal.pid    # Running terminal server PID
```

### `state.json` shape

```jsonc
{
  "activeSlot":     "blue",     // "blue" | "green"
  "activeCommit":   "<full sha>",
  "deployedAt":     "<ISO timestamp>",
  "previousSlot":   "green",
  "previousCommit": "<full sha>"
}
```

### Slot lifecycle (a single `deploy`)

1. **Acquire lock.** `deploy.lock` is created with `O_EXCL` (atomic, kernel-level).
   A stale lock whose PID is dead is reclaimed; a lock held by a live PID aborts
   the deploy.
2. **Pick the inactive slot.** Reads `state.json`; if active is `blue`, builds into
   `green` (and vice-versa). Defaults to `blue` on first run.
3. **Build into the inactive slot** (`buildSlot`):
   - `git fetch origin` then `git merge --ff-only origin/master`
   - `bun install --frozen-lockfile`
   - `cargo install --path crates/rdv` (soft requirement — warns and continues if
     `cargo` is unavailable; the rdv CLI is not strictly required for the web app)
   - `bun run build`
   - Copy `.next/standalone`, `.next/static`, and `public/` into
     `builds/{slot}/standalone/`
4. **Swap.** Stop the current servers (`stopCurrentServers`), run DB migrations
   while stopped (`db:push` + `db:migrate-github-accounts`), then restart via the
   `rdv` process manager (see [§5](#5-relationship-to-the-rdv-process-manager)).
5. **Health-check.**
   - **Local:** wait for both sockets to appear, then `GET /api/sessions` over the
     Next.js socket. `200` (valid JSON) or `401` (auth pending) both count as
     healthy. Timeout: 90 s.
   - **External:** `GET <DEPLOY_EXTERNAL_URL>/api/sessions`. A JSON response, a CF
     Access login page (non-JSON 200), or `401`/`403` from CF Access all count as
     reachable. Timeout: 30 s.
6. **Commit or roll back.** On success, write the new `state.json` (slots swapped).
   On any health-check failure, stop servers and `rollbackTo` the previous slot,
   then exit non-zero.

> **Note on the slot directories vs. the live process.** Builds are *materialized*
> per slot for rollback bookkeeping, but the live servers are (re)started by the
> `rdv` process manager from the project checkout, not by pointing a process at a
> slot directory. The slot/state machinery tracks *which commit is live* and gives
> rollback a known-good target; the actual restart path is `rdv:prod`.

### Stopping servers safely

`stopCurrentServers()` reads `next.pid` / `terminal.pid` and sends `SIGTERM` to the
whole **process group** (`kill -<pgid>`), because each server is spawned
`detached: true` (its own session/pgid leader). This reaches the real server
(grandchild) instead of only the `bun run tsx` wrapper. After a grace period it
escalates to `SIGKILL`, then removes stale sockets and PID files. It also clears a
**stale** `instance.lock` — but only when the lock is same-host **and** its holder
PID is dead; a live-owner lock is preserved (warned, not removed).

---

## 2. Auto-deploy webhook (CI on push to `master`)

The default production path. On push to `master`, GitHub Actions sends an
**HMAC-SHA256-signed** webhook to the running server, which spawns
`scripts/deploy.ts` as a detached background process.

- **Workflow:** [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml)
  (`name: Deploy to Production`), triggers on `push` to `master` and
  `workflow_dispatch`. Tag pushes are skipped (releases are handled separately).
- **Endpoint:** [`src/app/api/deploy/route.ts`](../src/app/api/deploy/route.ts)
  (`POST /api/deploy`).

### Request contract

| Item | Value |
|------|-------|
| Method / path | `POST <DEPLOY_URL>/api/deploy` |
| `X-Hub-Signature-256` | `sha256=<hmac-sha256(rawBody, DEPLOY_WEBHOOK_SECRET)>` |
| `X-GitHub-Event` | `push` (non-`push` events are acknowledged and ignored) |
| Body | `{ "ref": "refs/heads/master", "after": "<sha>", "pusher": { "name": "<actor>" } }` |
| CF Access headers | `CF-Access-Client-Id` / `CF-Access-Client-Secret` (service-token, to get past Cloudflare Access) |

The signature is generated in CI with:

```bash
SIGNATURE="sha256=$(echo -n "$PAYLOAD" | openssl dgst -sha256 -hmac "$DEPLOY_WEBHOOK_SECRET" | awk '{print $NF}')"
```

### Server-side handling

1. **Auto-update gate.** If `AUTO_UPDATE_ENABLED=true`, the webhook is **disabled**
   and returns `410 Gone` (`code: "WEBHOOK_DEPRECATED"`) — the server is expected to
   pull updates itself (see [§3](#3-auto_update_enabled-poll-based-vs-webhook)).
2. **Secret check.** Missing `DEPLOY_WEBHOOK_SECRET` → `503`.
3. **Signature verify.** Constant-time (`timingSafeEqual`) HMAC comparison; failure → `401`.
4. **Ref filter.** Only `refs/heads/master` deploys; other refs are acknowledged and ignored.
5. **Concurrency.** If `deploy.lock` is held by a live PID → `409 Conflict`.
6. **Spawn.** Launches `bun run scripts/deploy.ts` detached (`stdio: "ignore"`,
   `child.unref()`) with a **clean environment** — `NODE_ENV` is deliberately
   omitted because the inherited `__NEXT_*` / `NODE_ENV=production` vars break
   `next build`. Returns `202 Accepted` with the short commit and child PID.

### Response codes

| Code | Meaning |
|------|---------|
| `202` | Deploy triggered (CI treats this as success) |
| `409` | Deploy already in progress (CI logs a warning, non-fatal) |
| `401` | Invalid signature |
| `410` | Webhook deprecated because auto-update is enabled |
| `503` | `DEPLOY_WEBHOOK_SECRET` not configured |

### Required configuration

| Where | Name | Purpose |
|-------|------|---------|
| Server env (`.env.local`) | `DEPLOY_WEBHOOK_SECRET` | HMAC secret; **must match** the GitHub secret |
| Server env | `DEPLOY_EXTERNAL_URL` | External URL for the post-deploy health check (default `https://dev.bryanli.net`) |
| Server env | `DEPLOY_PROJECT_ROOT` | Project checkout where `scripts/` lives (default `~/Projects/btli/remote-dev`) |
| Server env | `RDV_DATA_DIR` | Optional; forwarded to the deploy child if set |
| GitHub → Secrets | `DEPLOY_WEBHOOK_SECRET` | Signs the webhook payload |
| GitHub → Secrets | `CF_ACCESS_CLIENT_ID`, `CF_ACCESS_CLIENT_SECRET` | Cloudflare Access service token |
| GitHub → Variables | `DEPLOY_URL` | Base URL the webhook POSTs to |

Run [`scripts/deploy-setup.sh`](../scripts/deploy-setup.sh) once on the production
host to generate the secret, initialize deploy state, and install the watchdog (see
[§4](#4-npm-scripts)). It prints the exact `gh secret set` / `gh variable set`
commands to register CI.

---

## 3. `AUTO_UPDATE_ENABLED`: poll-based vs. webhook

Remote Dev supports two mutually-exclusive update paths. The webhook
(§2) is the default; the poll path is for hosts that should update themselves
without inbound CI access (e.g. distributed installs).

| | Webhook path (default) | Poll path (`AUTO_UPDATE_ENABLED=true`) |
|---|---|---|
| Trigger | CI POSTs to `/api/deploy` on push to `master` | Server polls **GitHub Releases** on a schedule |
| Builds from | Source (`git merge --ff-only` + `bun run build`) | Downloaded release artifact |
| `/api/deploy` | Active | Returns `410 Gone` |
| Driver | `scripts/deploy.ts` | `AutoUpdateOrchestrator` in the terminal server |
| Apply via CLI | n/a | `rdv system update check` / `rdv system update apply` |

### Poll-path internals

- Policy: [`src/domain/value-objects/UpdatePolicy.ts`](../src/domain/value-objects/UpdatePolicy.ts).
- Orchestrator: [`src/services/auto-update-orchestrator.ts`](../src/services/auto-update-orchestrator.ts)
  — lifecycle is **detect → schedule (delay) → drain sessions → apply → restart**,
  started alongside the update scheduler in the terminal-server process and able to
  recover an in-progress deployment after a restart.

Environment variables:

| Var | Default | Meaning |
|-----|---------|---------|
| `AUTO_UPDATE_ENABLED` | `false` | `true` enables the poll path (and disables the webhook) |
| `AUTO_UPDATE_DELAY_MINUTES` | `5` | Wait after detecting a release before applying |
| `AUTO_UPDATE_DRAIN_TIMEOUT_SECONDS` | `60` | Max wait for active sessions to drain before applying |

Manual control with the `rdv` CLI:

```bash
rdv system update            # show current/latest version + state
rdv system update check      # poll GitHub Releases now
rdv system update apply      # download + apply, then restart the service
```

See [`RDV_CLI.md`](./RDV_CLI.md) for the full `rdv system` reference.

---

## 4. npm scripts

Defined in `package.json` (all are thin wrappers around `scripts/deploy.ts`,
except `deploy:setup`).

| Script | Command | Behavior |
|--------|---------|----------|
| `bun run deploy` | `bun run scripts/deploy.ts` | Full blue/green deploy of latest `master` into the inactive slot, with health-check + auto-rollback |
| `bun run deploy:rollback` | `… --rollback` | Restart on the **previous** slot from `state.json`, health-check, and swap state back |
| `bun run deploy:status` | `… --status` | Print active/previous slot, commits, per-slot build presence, and lock state |
| `bun run deploy:init` | `… --init` | Initialize `state.json` from the current running build (copies it into the `blue` slot). No-op if state already exists |
| `bun run deploy:setup` | `bash scripts/deploy-setup.sh` | One-time host setup: generate `DEPLOY_WEBHOOK_SECRET`, create deploy dirs, `deploy:init`, install the watchdog launchd service |

### Watchdog

`deploy-setup.sh` installs a **launchd** agent on macOS
(`~/Library/LaunchAgents/dev.remote.app.watchdog.plist`) that runs every 5 minutes
to keep the servers up. On Linux it is not auto-installed; add a cron entry instead
(the script prints the exact line, `*/5 * * * * bash …/watchdog.sh`). Logs land in
`~/.remote-dev/logs/watchdog.log`; deploy logs in `~/.remote-dev/deploy/deploy.log`.
Uninstall with `bash scripts/deploy-setup.sh --uninstall-watchdog`.

---

## 5. Relationship to the `rdv` process manager

For local and self-hosted production, the two servers are managed by
[`scripts/rdv.ts`](../scripts/rdv.ts) (not to be confused with the Rust `rdv` CLI in
`crates/rdv/`). The deploy script **restarts through this manager** rather than
spawning servers directly, because it re-execs under a **login shell**
(`$SHELL -l -c …`) to recover the full locale/`PATH` environment (`LC_ALL`, `LANG`,
etc.) that node-pty needs for correct UTF-8 PTY encoding.

| Script | Action |
|--------|--------|
| `bun run rdv:prod` | Start both servers in production mode (background, detached process groups) |
| `bun run rdv:dev` | Start both servers in dev mode |
| `bun run rdv:restart` | Restart both servers |
| `bun run rdv:stop` | Stop both servers |
| `bun run rdv:status` | Show server status |

Servers are spawned `detached: true` so each is its own process-group leader; this
is what lets both the deploy script and `rdv:stop` cleanly group-kill the entire
tree (wrapper + real server) instead of leaking the grandchild on every restart.

---

## 6. Known issues / operator gotchas

These are **real, observed** production behaviors. Treat them as operational cautions.

- **`rdv:restart` can leave prod half-up — recover with a fresh `rdv:prod`, not another restart.**
  A restart can end with the **outer Unix socket listening** but the **inner
  Next.js process unreachable**, at which point the wrapper serves its own `502`.
  Re-running `rdv:restart` does not reliably clear this state. Recover with a clean
  `bun run rdv:prod` (stop, then fresh start).

- **Single-host watchdog deadlock when `RDV_BASE_PATH` is empty.**
  On a self-hosted single host the Kubernetes-style instance lock can deadlock the
  watchdog's restart attempt. The fix is that the lock logic **no-ops when the base
  path is empty** (single-tenant); ensure you are on a build that includes this
  behavior. If a restart appears wedged, check for a stale `~/.remote-dev/instance.lock`
  whose holder PID is dead before forcing anything.

- **macOS has no `setsid`.** The process manager relies on `detached: true` (Bun's
  POSIX `setsid` equivalent) for process-group control; do not assume a `setsid`
  binary exists. When backgrounding manually, use `nohup` (e.g.
  `nohup bun run rdv:prod`), not `setsid`.

- **Webhook/CI deploys have been observed to corrupt terminal glyphs; a manual CLI deploy does not.**
  Deploys triggered via the GitHub Actions webhook have produced glyph/rendering
  corruption in active terminals that a manual `bun run deploy` (or `rdv:prod`) on
  the host does not exhibit — likely an environment difference in the spawned child.
  If you see glyph corruption after a CI deploy, redeploy from the host CLI.

---

## See also

- [`MULTI_INSTANCE.md`](./MULTI_INSTANCE.md) — multi-instance / Kubernetes hosting, `RDV_BASE_PATH`, per-instance locks
- [`SETUP.md`](./SETUP.md) — installation, environment variables, first run
- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — two-server model, terminal/tmux flow
- [`RDV_CLI.md`](./RDV_CLI.md) — `rdv system update` and the full CLI reference
- [`README.md`](./README.md) — documentation index
