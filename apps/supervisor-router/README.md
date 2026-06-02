# @remote-dev/supervisor-router

The **Supervisor data-plane router** — a small, **stateless** Bun reverse proxy
that is the **single front door** behind the Cloudflare tunnel for the instance
host (e.g. `dev.example.com`). It routes `/<slug>/*` to the matching Remote Dev
instance (proxying the `/<slug>/ws` terminal WebSocket), and proxies every
non-instance path — root `/`, `/login`, `/api/*`, assets — to the **Supervisor
dashboard** on the same host. One external hostname, one Cloudflare Access app.

> **Status: Phase 1 (remote-dev-jvcx.6).** Convention routing, the last-known-good
> allowlist poller, and HTTP + WebSocket proxying. The live end-to-end tunnel +
> Cloudflare-Access WebSocket path is verified by the **jvcx.11** smoke test, not
> by this package's unit tests.

## What it does (spec §5)

- **Convention routing, NO prefix stripping.** The instance image is slug-aware
  and genuinely serves under `/<slug>`, and the Supervisor serves at root, so the
  router forwards the **full path and query unchanged** in both cases:
  - `GET /healthz` → `{ "status": "ok" }` (router liveness; answered locally,
    never proxied).
  - `/api/internal/*` → **404** (answered locally, never proxied — the
    Supervisor's allowlist endpoint is not exposed at the front door).
  - `/<slug>/ws` **with** a WebSocket upgrade → bridge to
    `ws://rdv.rdv-<slug>.svc.cluster.local:6002` + the same path.
  - any other `/<slug>/…` for a **ready** instance →
    `http://rdv.rdv-<slug>.svc.cluster.local:6001` + the same path + query.
  - **everything else** — root `/`, `/login`, `/api/*`, assets, a reserved first
    segment (`api`, `_next`, `login`, `icons`, …), a **malformed** slug, or a
    valid slug **not in the allowlist** — is proxied **unchanged** to the
    **Supervisor dashboard** (a WS upgrade goes to the Supervisor's ws base).
    The router is the single front door; it serves the dashboard at `/`, not a
    separate hostname.
- **Fail-open allowlist (§15 M4).** Every `ROUTER_ALLOWLIST_POLL_MS` (default
  10 s) the router polls the Supervisor's
  `GET /api/internal/routes` (with the `x-supervisor-internal-secret` header) and
  caches the `{ slug → { namespace, service, httpPort, wsPort, ready } }` map. On
  a **failed** poll it **keeps the last-known-good cache** (keeps routing
  known-ready slugs) and logs a warn — it never wipes the cache. Run `replicas ≥ 2`
  (it is stateless).
- **Auth pass-through.** The router does **not** terminate auth: the `Cookie`
  (carrying `CF_Authorization`) and `Cf-Access-Jwt-Assertion` headers are
  forwarded unchanged to whichever upstream it selects — each upstream (the
  Supervisor dashboard or an instance) validates Cloudflare Access itself. For
  WebSockets the `Upgrade`/`Connection`/`Sec-WebSocket-*` headers are forwarded.
  Hop-by-hop headers are stripped on the HTTP path. Auth tokens are never logged.

## Architecture

A single `Bun.serve` process — native HTTP + WebSocket upgrade, no `ws`
dependency, no Next.js. The routing decision is a **pure** function
(`src/lib/router-core.ts`); the allowlist poller (`src/lib/allowlist.ts`) and the
HTTP/WS proxies (`src/lib/proxy.ts`) do the I/O; `src/index.ts` wires them
together and handles graceful `SIGTERM`/`SIGINT` shutdown.

## Development

From the **repo root**:

```bash
bun install        # resolves this workspace
bun run dev:router # bun --watch on :6004 (this package's `dev` script)
```

Or from `apps/supervisor-router`:

```bash
bun run dev        # bun --watch src/index.ts (:6004)
bun run start      # bun run src/index.ts
bun run typecheck
bun run lint
bun run test
bun run build      # bun build src/index.ts --target bun --outdir dist
```

## Environment

See [`.env.example`](./.env.example). Bun loads `.env` automatically.

- `ROUTER_PORT` — listen port (default **6004**)
- `ROUTER_SUPERVISOR_URL` — Supervisor base URL: BOTH the allowlist-poll source
  AND the default proxy upstream (the dashboard the router fronts at `/`); its WS
  base is derived from it (http→ws, https→wss)
  (default `http://supervisor.rdv-system.svc.cluster.local:6003`)
- `SUPERVISOR_INTERNAL_SECRET` — shared secret presented to the Supervisor's
  `/api/internal/routes` (must match the Supervisor's value; may be blank in dev)
- `ROUTER_ALLOWLIST_POLL_MS` — allowlist poll cadence in ms (default `10000`)
- `LOG_LEVEL` — `error|warn|info|debug|trace`

## Follow-up

The slug validator (`src/lib/slug.ts`) is duplicated from
`apps/supervisor/src/lib/slug.ts`; consolidating both into one shared package is
tracked as a spec §15 m2 follow-up.
