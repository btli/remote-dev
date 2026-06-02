# Changelog

All notable changes to Remote Dev will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Supervisor router is now the **single external front door** (Option C). Non-instance traffic — root `/`, `/login`, `/api/*`, assets — is proxied to the **Supervisor dashboard** on the same host (the Supervisor became the router's default upstream, with no path stripping), and `/<slug>/*` continues to route to the matching instance. This **eliminates the separate Supervisor hostname and the second Cloudflare Access app** that the original spec §15 M3 mandated: one hostname, one CF Access app (so `SUPERVISOR_CF_ACCESS_AUD` and the instances' `CF_ACCESS_AUD` may be the same value), with dashboard-vs-instance isolation enforced by policy within that one app plus the Supervisor's role gate. The router still never terminates auth — it forwards `CF_Authorization` untouched to whichever upstream it selects. `/api/internal/*` is now **blocked at the router** (answered 404 locally, never proxied) so the Supervisor's allowlist endpoint is not externally reachable. (`apps/supervisor-router`: `decideRoute` + `index.ts` wiring.)
- Documented the **two deployment shapes** across the docs: **Shape A** — single-instance "routerless" (the base app at root, `RDV_BASE_PATH=""`, no supervisor/router — the original product), and **Shape B** — multi-instance (the supervisor + router single front door). Reversed the now-superseded "Supervisor on its own hostname / two CF Access apps" guidance in the k3s supervisor spec (§5/§6.6/§14/§15 M3), `docs/SUPERVISOR_DEPLOY.md`, `docs/MULTI_INSTANCE.md`, `docs/ARCHITECTURE.md`, `docs/ENHANCEMENTS.md`, the app READMEs, and the `deploy/k8s/supervisor` manifests/secrets template. (`docs/ENHANCEMENTS.md` and `docs/ARCHITECTURE.md` also corrected to reflect that the supervisor platform's Phases 0–2 have shipped.)

### Fixed

- Instance image Dockerfile: provisioned k8s instances CrashLooped at startup (`exit 1`) because the runtime stage's `/app` directory stayed **root-owned** while the container runs as the non-root `rdv` user (uid 10001). The entrypoint's basePath materialization does `sed -i` over `/app/server.js` (and `/app/.next`, `/app/public`) to rewrite the `/rdvslug` sentinel to the real per-instance slug, and `sed -i` must create a temp file in the target file's directory — so it failed with `sed: couldn't open temporary file /app/sedXXXX: Permission denied` → `FATAL: sed failed during basePath materialization`. `WORKDIR /app` creates `/app` as root and the `COPY --chown=rdv:rdv` lines only chown the copied *contents*, not the directory itself. Added `RUN chown -R rdv:rdv /app` in the runtime stage (after the COPYs, before `USER rdv`) so the non-root entrypoint can `sed -i` in place. Single-instance / `RDV_BASE_PATH=""` runs skip materialization, which is why this was never caught. (remote-dev-qy7t)
- Supervisor router: proxied responses no longer carry `Content-Encoding: gzip` (or `br`/`deflate`) on a body that has already been decompressed. Bun's `fetch` auto-decompresses upstream responses but leaves the original `Content-Encoding`/`Content-Length` on the headers; `proxyHttp` forwarded them verbatim, so clients — and Cloudflare — tried to decode an already-plaintext body → `ZlibError` / corrupted responses (including the dashboard root once Option C put the gzipped Supervisor on the router's default path; the latent bug affected instance proxying too). The router now strips both framing headers and re-streams the identity body when the upstream compressed, leaving uncompressed responses' accurate `Content-Length` intact. (`apps/supervisor-router/src/lib/proxy.ts`)
- Supervisor image: the web container crashed at startup with `Cannot find module '@libsql/isomorphic-ws'` (and `@libsql/isomorphic-fetch`) when the standalone server opened the DB, so the admin seed and every DB request failed. Root cause: `@libsql/isomorphic-ws@0.1.5` / `@libsql/isomorphic-fetch@0.3.1` are published WITHOUT the `web.*` files their package.json `exports` select under the `bun` runtime condition (only the `node.*` variants ship). The runtime image is `oven/bun`, where `node` is a bun shim, so the resolver matches the `bun` condition → missing `./web.mjs`/`./web.js`/`./web.cjs` → module-not-found. (Real Node.js never hit this because it matches the `node` condition, which exists — so it only surfaced once the image was actually run.) `apps/supervisor/Dockerfile` now materializes the missing `web.*` from the working `node.*` siblings (trivial re-exports of `ws`/`node-fetch`) in the standalone's canonical `.bun` libsql packages, with a `test -f` guard so a libsql version bump fails the build rather than silently un-fixing it.
- Supervisor image: the controller container crashed immediately with `Cannot find module './cjs/index.cjs'` / exit 1. The `controller` npm script invoked `tsx` (a Node-only loader that does not run under bun), but the `oven/bun` runtime executes the script via `bun run controller`. Changed the `apps/supervisor/package.json` `controller` script from `tsx src/controller/index.ts` to `bun src/controller/index.ts` — bun runs the TypeScript entry natively, so the reconcile loop now starts and runs (degrading gracefully with no cluster) instead of failing on module resolution. (`dev:controller` is unchanged.)
- Instance image Dockerfile: removed the invalid `RUN bun rebuild better-sqlite3 node-pty` line from the build stage — `bun` has no `rebuild` subcommand (the build failed with `error: Script not found "rebuild"`), and the step was redundant: the native modules are already compiled during `bun install --frozen-lockfile` because they are listed in the root `package.json` `trustedDependencies`.
- Instance image Dockerfile: copy the workspace `package.json` files (apps/*, packages/*) before `bun install --frozen-lockfile` — the root manifest declares workspaces, so a frozen install needs every member's manifest present (build failed with "lockfile had changes, but lockfile is frozen").
- Instance image Dockerfile: copy `bun` from the `build-deps` stage instead of an unexpanded `${BUN_VERSION}` image ref in the `runtime` stage (the global ARG is out of scope there) — this broke the k8s instance image build (`invalid reference format`).
- Startup commands no longer lose their first character when oh-my-zsh's periodic auto-update prompt appears during shell init. `createSession` now suppresses shell-init update prompts (`DISABLE_AUTO_UPDATE`/`DISABLE_UPDATE_PROMPT`) and waits for the shell to settle before typing. (remote-dev-w75y)

### Added

- Supervisor: **native OIDC login** (apps/supervisor) via NextAuth v5 as a second auth path alongside Cloudflare Access. Generic env-driven OIDC (`SUPERVISOR_OIDC_ISSUER` / `…_CLIENT_ID` / `…_CLIENT_SECRET` / `…_NAME` + `AUTH_SECRET`, auto-discovered) adds a `/login` page with a "Sign in with <name>" button; the provider registers only when fully configured. **Dual auth**: a request authenticates with a valid CF Access JWT **or** a valid NextAuth (JWT-strategy) OIDC session — CF first, then OIDC session, then the dev `SUPERVISOR_ADMIN_EMAIL` fallback — both mapping to a `supervisor_user` (role logic unchanged). **Closed allowlist**: the `signIn` callback rejects an OIDC login unless the email is already a known `supervisor_user` or equals `SUPERVISOR_ADMIN_EMAIL`, so an IdP authenticating an unknown email is denied (the CF path keeps its auto-`viewer` behavior). The SAME allowlist is **re-checked on every request** in the OIDC dual-auth path (without auto-creating a row), so deleting a user's `supervisor_user` row revokes their existing JWT session on the next request. The proxy passes `/login` + `/api/auth/*` unconditionally and accepts a CF assertion **or** a NextAuth session for page routes; when OIDC is configured but CF is not, unauthenticated page routes are **redirected to `/login`** (edge gate). The edge `getToken` check uses the exact NextAuth v5 cookie name (`__Secure-authjs.session-token` on HTTPS / `authjs.session-token` on HTTP) + matching `secureCookie`, so valid sessions are not silently rejected on prod HTTPS. The production fail-closed startup guard now requires CF **or** OIDC configured (else `process.exit(1)`), still overridable by `SUPERVISOR_ALLOW_INSECURE_AUTH=1`. Adds the standard NextAuth Drizzle tables (`user`/`account`/`session`/`verificationToken`) linked to `supervisor_user` by email (instances' `ownerId` keeps referencing `supervisor_user.id`). (remote-dev-jvcx)
- Supervisor: **migrate-on-boot** (apps/supervisor) — committed Drizzle migrations (`apps/supervisor/drizzle/`, bundled into the standalone image) are applied at startup before the admin seed, so a fresh PVC gets the full schema (existing tables + the new NextAuth tables) instead of relying on `db:push`. The `0000` migration uses `CREATE TABLE/INDEX IF NOT EXISTS`, so a **legacy DB created by `db:push`** (the 5 original tables, no `__drizzle_migrations` history) is migrated without a "table already exists" crash-loop — the existing tables are skipped and only the 4 new NextAuth tables are created. A hard migrate failure logs and rethrows so a broken migrate fails the boot loudly rather than serving a tableless app. (remote-dev-bqgo)
- **Generic OIDC login provider** for the base app: sign in through any standards-compliant OpenID Connect identity provider (Okta, Authentik, Keycloak, Auth0, Entra, Google Workspace, …), enabled by setting `OIDC_ISSUER` + `OIDC_CLIENT_ID` + `OIDC_CLIENT_SECRET` (display label `OIDC_NAME` / `NEXT_PUBLIC_OIDC_NAME`). Endpoints are auto-discovered from `${OIDC_ISSUER}/.well-known/openid-configuration`; the provider is registered (and a "Sign in with {OIDC_NAME}" button appears on `/login`) only when all three are configured. Sign-in is **default-denied** — like GitHub, an OIDC login is rejected unless the user's email is in the `authorizedUsers` allowlist — and it works alongside Cloudflare Access (no change to the CF Access / API-key / localhost-email paths). Callback URL: `https://<host>/api/auth/callback/oidc`. (`src/auth.ts`, `src/app/(auth)/login/`)
- Supervisor: per-instance image-pull secret provisioning (`SUPERVISOR_INSTANCE_IMAGE_PULL_SECRET_NAME` / `…_DOCKERCONFIGJSON`) and instance pod `nodeSelector` pinning (`SUPERVISOR_INSTANCE_NODE_SELECTOR`) for private-registry / mixed-arch clusters (remote-dev-2xhg, remote-dev-389c).
- Supervisor instance lifecycle depth (apps/supervisor): suspend/resume (StatefulSet scale 0↔1, PVC retained), pod-log tail and namespace-events read-only APIs (degrade gracefully with no cluster), rolling image rollout and grow-only PVC resize via PATCH /api/instances/:id, a steady-state reconciler that converges `ready`/`suspended` instances toward their desired replicas/image/size, an instance detail page with the audit log + metadata + live logs/events + a lifecycle action panel, and the persistentvolumeclaims patch/update RBAC grant for resize (remote-dev-jvcx.8).
- k3s deployment manifests for the Supervisor platform (deploy/k8s/supervisor/): least-privilege ServiceAccount/ClusterRole, the Supervisor Deployment (web + controller, replicated-PVC SQLite) and the replicas≥2 router Deployment in rdv-system, plus per-app Dockerfiles and a deploy runbook (docs/SUPERVISOR_DEPLOY.md) — completes Phase 1 of the k3s supervisor epic (remote-dev-jvcx.7).
- Scaffolded the Supervisor data-plane router (apps/supervisor-router): a stateless Bun proxy that routes /<slug>/* to the instance Service (no prefix stripping), proxies the /<slug>/ws terminal WebSocket, and fails open from a last-known-good allowlist polled from the Supervisor's /internal/routes (remote-dev-jvcx.6).
- Supervisor storage targets (apps/supervisor): live discovery of StorageClasses + schedulable nodes (local-path) + registered NFS/custom targets, the 4-backend PVC translation with per-backend resiliency notes, a register/delete API, and a create-instance form with a storage-target dropdown; instance creation snapshots the chosen target so later edits don't affect existing instances (remote-dev-jvcx.5).
- Supervisor provisioner-service (apps/supervisor): k8s object builders (namespace/secret/service/statefulset/seed-job), transactional create with namespace-delete rollback, instance state machine, and a 30s reconciler that drives create→ready and terminate→delete; POST/DELETE /api/instances now provision/terminate via the reconciler (remote-dev-jvcx.4).
- Scaffolded the k3s Supervisor control-plane service (apps/supervisor): Next.js + Drizzle schema, role-based auth (admin/operator/viewer, owner-scoped instances), @kubernetes/client-node wrapper, and a controller-process skeleton — foundation for Phase 1 of the k3s supervisor epic (remote-dev-jvcx.3).
- **Documentation overhaul — new docs**: added `docs/README.md` (docs index /
  landing page), `docs/DEPLOYMENT.md` (blue/green + HMAC auto-deploy webhook),
  `docs/AGENTS.md` (the 5 agent CLIs + profile isolation), and
  `docs/RDV_CLI.md` (full `rdv` Rust CLI reference). Documented the
  **Antigravity** (`agy`, `ANTIGRAVITY.md`, shares `.gemini`) agent provider.
- **Multi-instance hosting (Phase 1 — plumbing core)**: new `RDV_BASE_PATH`
  env var lets one domain host multiple isolated `remote-dev` pods under
  path prefixes (`/alpha/`, `/beta/`, …). Phase 1 wires up the helper module
  (`src/lib/base-path.ts`), Next.js `basePath`, terminal-server WebSocket
  upgrade gating on `{prefix}/ws` with a strict-boundary match, the
  client-side WS URL builder (`window.__RDV_BASE_PATH__` read by
  `useTerminalWsUrl`), and a SSR-embedded base-path script in
  `<head>`. Default (empty `RDV_BASE_PATH`) deployments are byte-identical
  to current behavior. NextAuth cookie scoping, the absolute-URL audit, the
  `/api/config` endpoint, init.sh, and docs follow in Phases 2–4.
  **Do not set `RDV_BASE_PATH` in production multi-instance deployments
  yet** — cookie path scoping lands in Phase 2 (see
  `docs/plans/multi-instance-basepath.md` §7.6). Without it, sessions can
  bleed between instances on the same host.
- **Multi-instance hosting (Phase 2 — NextAuth cookie scoping)**: NextAuth's
  session/state/pkce/nonce/callback/webauthn cookies are now path-scoped to
  `RDV_BASE_PATH` and name-differentiated per instance slug
  (`__Secure-rdv-<slug>-session-token` etc.) via the new
  `src/lib/auth-cookies.ts` helper. The CSRF cookie keeps `Path=/` because
  the `__Host-` prefix requires it; functional isolation between instances
  on the same host is enforced by each pod owning its own `AUTH_SECRET`
  (which must be unique per instance — see plan §6.1).
  `src/auth.ts` pins AuthJS's internal `basePath` to the full external path
  (`${RDV_BASE_PATH}/api/auth`) so the OAuth callback URL handed to GitHub
  and the URLs in `/api/auth/providers` include the deployment prefix, and
  `src/app/api/auth/[...nextauth]/route.ts` restores the prefix on inbound
  requests (Next.js strips it before route handlers see them) so AuthJS's
  action parsing matches. Together these keep GitHub OAuth working under
  `RDV_BASE_PATH` (AC-7). `src/proxy.ts` reads the configured session cookie
  name via the new `getSessionCookieName()` helper so the proxy and the auth
  handler agree on which cookie carries the JWT.
  **Caveat for upgrades**: when a live deployment flips `RDV_BASE_PATH` from
  empty to a value (or vice versa), the NextAuth cookie names change too,
  so every signed-in user must sign in again on the first request after the
  rollout — no data loss, but a one-time logout is unavoidable.
- **Multi-instance hosting (Phase 3 — URL audit + runtime config)**: new
  `apiFetch` client-side wrapper (`src/lib/api-fetch.ts`) prefixes
  `window.__RDV_BASE_PATH__` onto every browser-initiated request so the
  client survives a non-empty basePath. All 108 bare `fetch("/api/...")`
  call sites in the app code were migrated to `apiFetch` (see commit
  `c3c56950`), and an ESLint guard (`no-restricted-syntax` on bare-
  string-literal fetch arguments starting with `/api`) prevents the
  pattern from creeping back. New `/api/config` endpoint behind
  `withApiAuth` (so it accepts session cookies **and** Bearer API keys)
  returns the deployment's `basePath`, `instanceSlug`, and package
  version — used by ops tooling and the multi-instance smoke test to
  prove which pod answered a request. Every response now carries an
  `X-RDV-Instance` header echoing the slug, set in the middleware so
  it survives 404s and static asset responses. The GitHub OAuth
  account-linking callback (`/api/auth/github/callback`) now reads
  `getBasePath()` when redirecting back to the app so the link flow
  works under `RDV_BASE_PATH`. **Default (empty basePath) deployments
  remain byte-identical**: `apiFetch` becomes a thin pass-through.
- **k3s slug-aware image (Phase 0 — runtime basePath materialization)**:
  one container image now serves any instance slug chosen at runtime,
  removing the per-slug image build requirement. Next.js bakes
  `basePath`/`assetPrefix` at build time, so the image is built once with a
  sentinel basePath (`Dockerfile` build stage sets `RDV_BASE_PATH=/rdvslug`)
  and the container entrypoint (`docker/entrypoint.sh`) rewrites that sentinel
  to the real per-instance slug — or empty for root — across the FULL runtime
  tree (`/app/server.js`, `/app/.next`, AND `/app/public`) before starting the
  servers. The pass is idempotent (PVC done-marker keyed on the target slug)
  and HARD-FAILS the boot if any `/rdvslug` survives anywhere, so a
  half-rewritten app never serves. App-owned, root-absolute URLs that Next
  never prefixes are made slug-aware: `src/app/layout.tsx` interpolates the
  server-side `BASE_PATH` into the PWA manifest link, favicon, and
  apple-touch-icon; `next-auth/react` `SessionProvider` is mounted with
  `basePath={`${slug}/api/auth`}` (via the now-exported `runtimeBasePath()`
  helper in `src/lib/api-fetch.ts`) so client session/CSRF/signout calls hit
  the slug; the `next/image` logo in `Header.tsx` and the browser-notification
  icon in `useNotificationPermission.ts` are runtime-prefixed; the service
  worker is now served from a runtime-templated route handler
  (`src/app/sw.js/route.ts`, replacing the static `public/sw.js`) whose cached
  URLs are interpolated from the server-side `BASE_PATH`, so the PWA works both
  at root (single-host prod) and under a slug with no build-time baking —
  `ServiceWorkerRegistration` registers `${prefix}/sw.js` with a matching
  `${prefix}/` scope; `public/manifest.json` uses manifest-relative
  icon/`start_url` paths so it is correct under any slug and at root with no
  materialization. Default (empty basePath) local/Electron builds are
  unaffected — they build normally with `basePath` omitted and do not use this
  image.
- **Multi-instance hosting (Phase 5 — K8s production hardening)**: new
  `/api/healthz` (liveness) and `/api/readyz` (readiness) probes plus the
  full set of container hardening required to safely run multiple
  isolated `remote-dev` instances on Kubernetes. Both probes are
  unauthenticated and bypassed by the proxy middleware so the kubelet can
  hit them without CF Access. `/api/readyz` probes the SQLite database,
  the `tmux` binary, and the in-pod terminal server (`/health` on
  `TERMINAL_PORT`) with a 1s timeout — a wedged terminal server now
  drops the pod out of LB endpoints instead of routing failing session
  creates to a half-dead pod. `Dockerfile` ships native modules
  (`better-sqlite3`, `node-pty`) into `/app/node_modules` so the
  terminal server (built with `--external node-pty`) can resolve them
  at runtime, runs the native-module ABI smoke test post-`USER rdv`
  switch, and is built multi-arch (`linux/amd64,linux/arm64`) via
  `docker buildx`. `docker/entrypoint.sh` pins `TMUX_TMPDIR` onto the
  PVC so tmux sessions survive container restarts within a pod, checks
  both write AND execute permissions on `RDV_DATA_DIR` for a clean
  pre-flight error when `securityContext.fsGroup` is wrong, and
  force-kills children at t=25s to exit cleanly inside K8s's default
  30s `terminationGracePeriodSeconds`. New advisory instance lock
  (`src/lib/instance-lock.ts`) writes a JSON record with hostname +
  PID + startedAt + writer nonce at `${RDV_DATA_DIR}/instance.lock`
  and refuses to start when a *live, same-host, recent* PID owns it —
  cross-host or aged-out same-host locks are reclaimed automatically
  so the lock no longer crashloops K8s pods whose previous incarnation
  crashed without cleanup (tini-as-PID-1 is always alive in a fresh
  PID namespace). The lock release runs on `process.on('exit')` and
  `uncaughtException` in addition to the explicit shutdown handler,
  and defensively skips the unlink when the on-disk nonce no longer
  matches ours. New `ENABLE_LOCAL_CREDENTIALS` env var (`true` |
  `false` | unset) makes the localhost-credentials gate deterministic
  in containers where `x-forwarded-for` doesn't reflect the loopback;
  `src/auth.ts` refuses to start when `ENABLE_LOCAL_CREDENTIALS=true`
  AND `NODE_ENV=production` AND `AUTH_URL` is a non-loopback host, so
  a single Helm typo can't accidentally turn every authorized email
  into a passwordless backdoor. `scripts/rdv.ts` honors `PORT`,
  `TERMINAL_PORT`, and `AUTH_URL` env vars so process-manager starts
  inside the container respect the K8s manifest's port/URL config.
  New `docs/MULTI_INSTANCE.md` deployment guide covers
  StatefulSet/Service/IngressRoute reference manifests, multi-arch
  `docker buildx` build instructions, per-instance `AUTH_SECRET`
  rotation, first-boot seeding, and known limitations.
- **Multi-instance hosting (Phase 4 — init + docs + integration test)**:
  `scripts/init.sh` accepts `--base-path` and `--instance-slug` flags,
  validates them against the same lowercase-segment regex
  `src/lib/base-path.ts` uses, and either seeds a fresh `.env.local`
  with `RDV_BASE_PATH` / `RDV_INSTANCE_SLUG` / a prefixed `AUTH_URL`,
  or upserts those keys into an existing file. Docs landed for the
  full feature: `docs/SETUP.md` gained a "Multi-Instance Deployment"
  section with the per-instance env-var table; `docs/ARCHITECTURE.md`
  added a short section on the layering; `docs/API.md` documents
  `/api/config` and `X-RDV-Instance`; `docs/openapi.yaml` got a
  matching `/api/config` path. New opt-in integration test
  (`src/integration/multi-instance.test.ts`, gated on
  `RDV_INTEGRATION_URL`) re-asserts AC-2/3/5 against a real running
  server with structured cookie parsing — kept opt-in so the unit
  runner doesn't pay a `next build` per CI run.
- **Mobile**: terminal search overlay reachable on both the PWA and the
  Flutter embed. PWA users get a "Search terminal" item in the session
  more-menu (`SessionMetadataSheet`). The Flutter shell drives the same
  overlay via two new bridge methods, `window.rdvBridge.openSearch()` /
  `closeSearch()` (bridge version bumped to 2). The xterm.js SearchAddon
  overlay's Up/Down/Close buttons now meet the 44 px iOS HIG tap target
  on mobile while keeping the original compact desktop sizing (closes
  remote-dev-mezp).
- **Mobile app**: two-finger pinch-to-zoom resizes the terminal font in
  the Flutter app's `/m/session` view; the final size persists via user
  preferences (closes remote-dev-kpxd).

### Fixed

- Terminal server `/health` now returns 503 (not a 200 with the detail buried in the body) when the scheduler subsystem isn't running, so `/api/readyz` correctly reports the pod as not-ready and pulls a wedged terminal server out of the load balancer instead of routing session-create traffic to it (remote-dev-n1uv).
- Deploy pipeline now reports the true async deploy outcome to CI: the GH workflow polls a new HMAC-authed `GET /api/deploy/status` after triggering and fails if the deploy doesn't land, closing the silent false-positive-deploy gap where a server-side abort left CI green on the old commit (remote-dev-6pbo).
- Deploy-status CI feedback loop: allow `/api/deploy/status` through the proxy auth boundary (it has its own HMAC auth) and make the deploy workflow's status poll tolerant of non-JSON responses, so the poll reaches the endpoint and a transient garbled response can't false-fail the job (follow-up to remote-dev-6pbo).
- **Production deploy no longer aborts on a dirty/untracked working tree**
  (remote-dev-1oxx): `scripts/deploy.ts` → `buildSlot()` Step 1 previously ran
  `git merge --ff-only origin/master` in `PROJECT_ROOT`, which aborts the entire
  deploy when a stray untracked file collides with an incoming tracked file
  (a real incident: an untracked `docs/MOBILE_ARCHITECTURE.md` blocked PR #309's
  deploy with "untracked working tree files would be overwritten by merge …
  Aborting") or when a tracked file is dirty (e.g. `.beads/issues.jsonl`, which
  `bd` auto-flushes). `buildSlot` now `git reset --hard origin/master` instead,
  guarded by a `git merge-base --is-ancestor HEAD origin/master` divergence
  check that refuses to reset (preserving the old `--ff-only` safety) if
  `PROJECT_ROOT` has local commits not on origin. Gitignored runtime data
  (`.env.local`, `sqlite.db`, `node_modules`, build slots) is left untouched.
  Also fixes a stale log label that read `git merge --ff-only origin/main` —
  the wrong branch name (remote-dev-k1jg).
- **Watchdog now health-checks the local origin, not the CF-Access-fronted
  public URL** (remote-dev-j4wr): `scripts/watchdog.sh` previously curled
  `https://dev.bryanli.net/api/sessions` with an app Bearer token and accepted
  200/401/403 as "alive". But Cloudflare Access intercepts at the edge and
  returns a 302 login redirect when the request lacks a CF Access *service*
  token, so every probe was a false FAIL — after 3 consecutive (~15 min) the
  watchdog restarted perfectly healthy prod. The probe now hits the Next.js
  origin directly over its unix socket (`$RDV_DATA_DIR/run/nextjs.sock`, with a
  TCP `127.0.0.1:$PORT` fallback for dev) at `GET /api/healthz`, accepting only
  `200`. This bypasses Cloudflare entirely and measures actual origin liveness,
  eliminating the spurious restarts. Failure-count, threshold, deploy-lock, and
  restart logic are unchanged — only the detection was wrong.

- **Instance lock no longer deadlocks single-host restarts** (remote-dev-i85i):
  the `instance.lock` data-dir guard now engages ONLY in multi-instance mode
  (non-empty `RDV_BASE_PATH`), or when forced via `RDV_FORCE_INSTANCE_LOCK=1`.
  On single-host (dev, Electron, self-hosted single-tenant prod) it is a no-op
  and never touches the lock file. Previously a watchdog/`rdv.ts`/`deploy.ts`
  restart — which spawns the new terminal server while the old one is briefly
  still alive — hit `acquireInstanceLock()`, saw the live holder, and refused
  to start, crash-looping until the 5-minute age-reclaim (which then left two
  live writers on one data dir). Process management is the real single-writer
  guard on single-host, so the lock was pure harm there.
- **Readiness probe checks the terminal server over its Unix socket in prod**
  (remote-dev-i85i): `GET /api/readyz` previously always probed
  `http://127.0.0.1:$TERMINAL_PORT/health`, but production runs the terminal
  server on a Unix socket (`TERMINAL_SOCKET`), so the check always failed and
  `/readyz` falsely returned 503 even when the terminal server was healthy. It
  now reaches `/health` over the Unix socket when `TERMINAL_SOCKET` is set
  (via `node:http`, matching `scheduler-client.ts`), falling back to the TCP
  port in dev. Same 1s timeout and `{ ok, error }` result shape.
- **Production deploy/restart resilience** (remote-dev-i85i): auto-deploy
  restarts could wedge with "Terminal socket not ready" and were
  undiagnosable because all child stdio was discarded. Three fixes: (1)
  `rdv.ts` now redirects the prod terminal + Next.js child stdout/stderr to
  append-only `~/.remote-dev/logs/{terminal,nextjs}.log` (with a per-restart
  banner; falls back to inherited stdio if the log can't be opened, and dev
  mode is unchanged); (2) the terminal server's graceful shutdown is now
  bounded (7s) and consolidated into a single authority in
  `src/server/index.ts` — `terminal.ts` no longer self-exits or traps signals
  — so SIGTERM always exits cleanly within the deploy's 10s window, releasing
  the instance lock instead of being SIGKILLed; (3) `deploy.ts`'s stop phase
  now clears a stale instance lock (ownership-checked: only same-host,
  dead-holder locks are removed; a live owner is preserved).
- **Mobile release CI**: Android `:app:signReleaseBundle` no longer crashes
  with `Tag number over 30 is not supported`. The Gradle signing config
  now sets `storeType = "PKCS12"` by default (matching `keytool`'s modern
  default since JDK 9), with optional override via
  `RDV_ANDROID_KEYSTORE_TYPE` for legacy JKS keystores. The release
  workflow decodes the keystore to `/tmp/remote-dev-release.p12` and
  passes the type override through (closes remote-dev-vvnw).
- **Mobile app**: terminal font size now respects user preferences in
  the Flutter-hosted `/m/session/[id]` view. The embed bundle was
  rendering at the xterm.js default (~15px, "too large" on a phone)
  because `PreferencesProvider` wasn't mounted on the /m/session route
  — it now reads `currentPreferences.fontSize` and `.fontFamily` and
  feeds them into `TerminalWithKeyboard`, the same way `MobileSessionView`
  already did for the PWA path (closes remote-dev-doqi).
- **Mobile app**: Android keyboard now triggers a tmux window resize.
  The Dart `SessionViewScreen` layout previously held the WebView at a
  fixed height regardless of `MediaQuery.viewInsets.bottom`, so opening
  the keyboard never produced a visualViewport resize and `tmux` never
  reflowed. The WebView height now subtracts `keyboardInset` so xterm.js's
  existing `visualViewport` + `ResizeObserver` handlers refit the grid
  and the terminal server reflows tmux (closes remote-dev-zjsc /
  remote-dev-btph).
- **Mobile app**: single-finger scrolling and tap-to-focus on the
  terminal. The Dart `PinchZoomWrapper`'s `ScaleGestureRecognizer` won
  the gesture arena ahead of the WebView and ate every touch — scroll,
  tap, AND pinch all dropped. Removed the wrapper so the WebView
  receives gestures directly; xterm.js's existing touch handlers now
  drive scrolling and focus (closes remote-dev-6tos).

### Changed

- **Mobile app**: pinch-to-zoom is now routed through the embed bridge
  (`window.rdvBridge.setFontSize`) instead of native Flutter. The bridge
  handler clamps to `[9, 22]` px and persists via `PATCH /api/preferences`
  so the new size flows back through `PreferencesContext` and lands on
  the terminal — a single canonical source of truth instead of a
  parallel Dart-side font scale. A JS-side touch-event pinch detector
  will land in a follow-up (closes remote-dev-d76d).
- **Documentation overhaul**: slimmed the root `CLAUDE.md` (~909 → ~230 lines)
  to agent-init essentials plus pointers into `docs/`. Refreshed
  `docs/ARCHITECTURE.md` (corrected dev ports to 6001/6002, `middleware.ts` →
  `proxy.ts`, full 54-service and 59-table coverage). Regenerated `docs/API.md`
  and `docs/openapi.yaml` to the full current surface (246 operations). Rewrote
  the root `README.md` and `docs/ENHANCEMENTS.md`.

## [0.3.18] - 2026-05-13

### Fixed

- **Mobile (Flutter)**: CF Access JWT expiry no longer surfaces as a
  `FormatException: Unexpected /api/sessions response shape` with the
  user stuck behind a "Failed to load sessions" error until force-quit.
  `CfAuthInterceptor` now disables Dio's redirect-following, detects CF
  Access intervention (401/403, 3xx → `cloudflareaccess.com`, or 200
  `text/html`), and silently refreshes credentials via the system-browser
  `/auth/mobile-callback` flow before transparently replaying the
  original request. Concurrent failures dedupe to a single browser
  launch, a retry sentinel guards against infinite loops, and the full
  `/reauth` screen only kicks in when refresh genuinely fails
  (closes remote-dev-arua).

## [0.3.17] - 2026-05-13

### Fixed

- **Mobile (Flutter)**: Push notifications were silently broken end-to-end
  in the new app at `mobile/` (worked in the archived `archive/mobile-flutter/`).
  Six independent bugs all combined to break the flow: (1) `PushTokenRegistrar`
  POSTed to `/api/push-tokens` instead of `/api/notifications/push-token` and
  the DELETE shape didn't match the server route; (2) `PushTokenRegistrar.start()`
  was never called, so the FCM token never reached any server; (3)
  `mobile/android/settings.gradle.kts` + `mobile/android/app/build.gradle.kts`
  were missing the `com.google.gms.google-services` plugin, so
  `Firebase.initializeApp()` failed on Android; (4) AndroidManifest.xml was
  missing the FCM meta-data block (default notification icon/color and the
  `rdv_notifications` channel id the server's `FcmPushGateway` targets) plus
  the `INTERNET` permission; (5) the `ic_notification` drawables and
  `notification_accent` color resource were absent; (6) `main.dart` never
  registered `firebaseMessagingBackgroundHandler` and `FcmPushService.initialize()`
  called `Firebase.initializeApp()` a second time, hitting `[core/duplicate-app]`
  and permanently latching `_initFailed = true`. `_initFailed` no longer latches
  on transient permission denial — only missing-config failures are permanent
  (closes remote-dev-ohfl).
- **Mobile (Flutter)**: Firebase configs swapped to the real per-platform
  values. The previous `mobile/android/app/google-services.json` only had a
  client entry for the legacy `com.remotedev.remote_dev` package, which no
  longer matches the actual Android `applicationId` (`com.remotedev.app`), so
  FCM token registration silently failed on the shipping APK. The new file
  has both clients (`com.remotedev.app` primary, `com.remotedev.remote_dev`
  legacy). A proper `mobile/ios/Runner/GoogleService-Info.plist` was added
  for the first time. `mobile/lib/firebase_options.dart` was corrected: the
  iOS section had been initialized with the Android `appId`/`apiKey` and a
  non-existent bundle ID `com.remotedev.remoteDev`; it now uses the iOS app
  values (`AIzaSyC…UYY` / `1:324706718241:ios:5a91afb31297b027d88960`,
  `com.remotedev.app`). The Android `appId` was also pointed at the new
  `com.remotedev.app` client.

### Versioning

- **Mobile (Flutter)**: Bumped `mobile/pubspec.yaml` from `0.1.1+1` to
  `0.3.17+1` so the Flutter app version tracks the repo release version
  instead of its own independent line.

## [0.3.16] - 2026-05-12

### Changed

- **Mobile (Flutter)**: Diagnostic logging added for mobile WebView load/console;
  blank-screen root cause still pending on-device repro. `WebViewFactory.build`
  now forwards `onConsoleMessage`, and the session view wires `onLoadStop`,
  `onProgressChanged`, and a JS console logger plus an `onTerminalReady` trace
  to `flutter logs` (closes remote-dev-l4q6 Bug 4).
- **Mobile (Flutter)**: Agent default-pick hoisted out of `build` — picking
  `agent` in the new-session sheet now resolves the default provider via a
  one-shot side effect from the Type-dropdown `onChanged` instead of
  `addPostFrameCallback` inside `_AgentProviderField.build` (codex review).

### Fixed

- **Mobile (Flutter)**: Sessions tab — removed the per-row pause IconButton
  and long-press-to-suspend on the ListTile; swipe-to-close is unchanged
  (remote-dev-l4q6 Bug 1).
- **Mobile (Flutter)**: New-session sheet — project is now required (not
  optional), the picker displays the chosen project's name instead of its
  UUID, and an Agent dropdown appears when `type == agent` listing
  installed CLIs from `/api/agent-cli/status` (defaults to Claude Code
  when available); the API call now passes `agentProvider` +
  `autoLaunchAgent` for agent sessions (remote-dev-l4q6 Bug 2).
- **Mobile (Flutter)**: Session view — smart-key strip moved into the
  floating chrome block above the input bar so the smart keys remain
  visible above the keyboard instead of being hidden behind it. WebView
  height stays fixed to avoid xterm.js SIGWINCH reflow
  (remote-dev-l4q6 Bug 3).
- **Mobile (Flutter, Android)**: Biometric lock — added
  `USE_BIOMETRIC` manifest permission and changed `MainActivity` to
  extend `FlutterFragmentActivity` (required by `local_auth`'s
  BiometricPrompt). The settings switch now gates enable on
  `isAvailable()` plus a successful auth challenge, surfacing
  user-visible SnackBar messages for both failure modes; disabling is
  free (remote-dev-l4q6 Bug 5).
- **Mobile (Flutter)**: Biometric auth failures on the lock screen now
  render inline as red text on the lock overlay itself. Previously a
  `ScaffoldMessenger.maybeOf(...).showSnackBar(...)` rendered behind
  the opaque lock `Material`, so the failure was invisible (codex
  review follow-up to Bug 5).
- **Mobile (Flutter)**: Root-level projects (server `groupId: null`)
  now appear in the new-session picker as a flat section above the
  group ExpansionTiles. Before, `Project.groupId` was non-nullable and
  the picker only rendered grouped projects — combined with the new
  "project required" gate, users whose only projects were root-level
  could be hard-blocked from creating sessions (codex review).

## [0.3.15] - 2026-05-12

### Added

- **Mobile**: Clear all notifications action with confirmation dialog.

### Changed

- **Web**: Clear all notifications now requires confirmation via dialog.
- **Scripts**: Removed dead `startServers()` from `scripts/deploy.ts`
  (and its only-orphaned helper `getServerEnv()`) — the live deploy
  path goes through `restartViaRdvAsync()`, which re-execs `rdv.ts`
  under a login shell to recover the full locale/PATH environment.
  Also dropped unused locals from `scripts/standalone-server.js`
  (module-level `internalPort = 0` shadowed by the block-scoped one
  inside `main()`; unused `const nextServer =` binding around
  `startServer()`; unused `head` positional arg on the proxy upgrade
  handler).

### Fixed

- **Dev**: Resolved three pre-existing ship-it blockers — `packages/mobile`
  tsconfig load failure (inlined `expo/tsconfig.base`), 10 ESLint errors
  → 0 (`react-hooks/use-memo` + `react-hooks/refs`), and `handleTouchEnd`
  tap-qualify axis asymmetry vs `handleTouchMove` (closes remote-dev-8v3i).
- **Terminal**: stale glyphs during scrolling in long-running sessions
  caused by xterm.js WebGL atlas page-merge — clear atlas via
  `onRemoveTextureAtlasCanvas` on next animation frame; replaces
  less-precise 2s-throttled scroll-up clear and 5000-line-feed
  threshold clear (closes remote-dev-xjje, follow-up to
  remote-dev-ofqf).
- **Web**: BeadsSidebar no longer triggers a React hydration mismatch.
  Three `useState` initializers (`collapsed`, `width`, `activeTab`) read
  `localStorage` via `typeof window !== "undefined"` — the exact
  anti-pattern the hydration error message warns about. Server rendered
  the collapsed `w-12` strip while the client first render returned the
  expanded sidebar with `style={{width:294}}`, producing "Hydration
  failed because the server rendered HTML didn't match the client" and
  a full tree regeneration on every load. State is now seeded from DB
  defaults so SSR and first client render agree, and `localStorage` is
  read in a mount-only `useEffect` with plain setters (not `setStoredX`,
  which dispatch a `CustomEvent` the component subscribes to).
- **Web**: BeadsSidebar no longer clobbers the user's `localStorage`
  sidebar preferences when `userSettings` finishes loading after mount.
  The previous DB-sync `useEffect`s used `collapsedSyncMounted` /
  `widthSyncMounted` refs that only skipped the very first render, so
  when `userSettings` arrived asynchronously and `dbCollapsed` /
  `dbWidth` flipped from the hardcoded defaults to real DB values, the
  sync effect fired and wrote the DB value into `localStorage` (plus
  broadcast a cross-tab `CustomEvent` other tabs reacted to). A new
  `userSettingsLoaded` boolean is plumbed through `BeadsContext` and the
  sync effects gate on it, skipping the first run AFTER load (the load
  transition itself) and propagating every subsequent change — so the
  Settings-page-edit flow still works (closes remote-dev-8y2n).
- **Mobile/Terminal**: PWA tap-to-click now reliably reaches xterm.js
  mouse-mode TUIs (Claude Code clickable buttons, vim, less, lazygit,
  tmux mouse). The previous implementation dispatched synthesized
  mousedown/mouseup on `.xterm-screen` and relied on bubbling up to
  `terminal.element` (where xterm binds its mousedown listener). On
  installed PWAs (iOS Safari standalone) that bubble did not reliably
  reach the parent listener, so mouse-mode TUI buttons silently dropped
  clicks (pinch-zoom and scroll still worked since they bypass xterm's
  mouse pipeline). Synthesized events now dispatch on `terminal.element`
  directly, with mouseup routed through `document` so xterm's
  document-level mouseup listener catches the UP report. Added
  `detail: 1` and `composed: true` for SelectionService click-count and
  shadow-DOM crossing. Added an integration test mounting a real
  `@xterm/xterm` Terminal that verifies the full tap → SGR mouse report
  pipeline (`useTouchInteractions.realXterm.test.ts`).
  (remote-dev-e07i)
- **Mobile**: FCM notification taps now navigate to the right session
  (or channel) and sync read-state with the server. `NotificationTapHandler`
  was defined after the refactor from `archive/mobile-flutter/` but never
  wired up — `FirebaseMessaging.onMessageOpenedApp` and `getInitialMessage`
  had no subscribers, so taps were silently dropped. Wired the handler
  eagerly from `main.dart` via a new `notificationTapHandlerProvider`, and
  restored the legacy mark-read-on-tap behavior so the web client sees the
  tap as a read event.
- **Mobile (Flutter) – Sessions tab**: list now matches the PWA
  mobile-web reference and shows only `active` and `suspended` sessions.
  `SessionsApi.list()` previously only filtered `trashed`, leaking
  `closed` (terminal-state) sessions into the picker — these belong to
  surfaces the mobile app doesn't expose.
- **Mobile (Flutter) – Channels tab**: the tab is now project-scoped
  to match the PWA mobile-web reference. Previously it fetched
  `/api/channels` with no scope (the server rejects this with a 400)
  and rendered an unrelated "No channels yet" state. The tab now
  reads the user's pinned-or-active node via `GET /api/preferences`,
  passes it as `?nodeId=&nodeType=` when listing channels, and shows
  a "Pick a project to load channels" empty state with a project
  picker button when nothing is selected. A folder-icon app-bar
  action lets users switch projects without leaving the tab.
  Selections persist server-side via `POST /api/preferences/active-node`.
- **Mobile (Flutter) – Notifications Mentions filter**: the "Mentions"
  chip now actually filters. The Flutter app used to pass
  `?filter=mentions` to the API, which the server ignored — so
  "Mentions" returned the full list, identical to "All". Aligned with
  the PWA mobile-web tab: fetch all notifications once, then filter
  client-side using an `isMention` heuristic that respects
  `agent_waiting` / `agent_error` / `agent_complete` / `agent_exited`
  types and the `@<sid:UUID>` / `@name` token patterns. The
  `AppNotification` domain model gained an optional `type` field
  sourced from the server's `notification_event.type` column.
- **Scripts**: `rdv` and the blue/green deploy webhook no longer leak
  server processes on stop/restart. `Bun.spawn("bun", "run", "tsx",
  "src/server/index.ts", ...)` produces a 3-deep process tree (bun
  wrapper → node tsx → node loader), and the previous `process.kill(pid,
  SIGTERM)` only signalled the outer wrapper — leaving the actual
  terminal/Next.js server re-parented to init on every stop. ~29
  orphaned `bun run tsx` processes accumulated over 11 days (~2–3 per
  deploy). Servers are now spawned `detached: true` so each is its own
  session/pgid leader, and shutdown uses `kill(-pid, signal)` to take
  down the whole group. Also added explicit `SIGHUP` handlers to the
  terminal server (`src/server/index.ts`) and standalone Next.js wrapper
  (`scripts/standalone-server.js`) so they exit cleanly on tty hangup.

## [0.3.14] - 2026-05-12

### Fixed

- **Mobile**: Session list crashed with
  `'trashed' is not a valid value for SessionStatus` after the user
  added their first server and the sessions tab fetched
  `GET /api/sessions`. The server returns sessions in the `trashed`
  soft-delete state alongside `active` / `suspended` / `closed`, but
  the mobile `SessionStatus` enum only knew three of the four.
  Added the `trashed` variant (with `@JsonValue('trashed')`) and
  taught `SessionsApi.list()` to filter trashed sessions out of the
  returned list — same pattern the web client uses at render time.
- **Mobile**: Notification dismiss button 404'd on the server. The
  mobile client was calling `DELETE /api/notifications/:id`, but the
  server only exposes a bulk-DELETE at `/api/notifications` accepting
  `{ids: [...]}` or `{all: true}` in the body. Extended
  `ApiClientPort.delete()` to accept an optional JSON body, and
  rewrote `NotificationsApi.dismiss(id)` to call the bulk endpoint
  with `{ids: [id]}`. No server change required.
- **Mobile**: Notification filter chips (`All` / `Unread` / `Mentions`)
  were silently ignored because the mobile client sent
  `?filter=unread`, but the server expects `?unreadOnly=true`.
  `NotificationsApi.list()` now translates the enum value
  to the right query param. (`Mentions` still has no server-side
  concept; it currently falls back to listing all notifications.)

## [0.3.13] - 2026-05-12

### Fixed

- **Mobile**: v0.3.12 hotfix actually broke server-add. The
  `redirect: → /servers` callback absorbed the GoException but
  *navigated GoRouter to `/servers`*, which unmounted the in-flight
  `AddServerScreen`. The launcher's `await _runCallbackLogin()` still
  resolved (broadcast stream survived), but the post-await
  `if (!mounted) return;` guard in `_save()` aborted before the server
  record was upserted — so CF Access succeeded yet no server appeared
  in the picker. Replaced with a `_lastGoodLocation` tracker: the
  redirect now returns the most recently matched location, which
  go_router treats as a no-op (Page stays mounted). AddServer's State
  survives the deep-link round-trip, the credentials persist + server
  upsert complete, and `widget.onSaved` drives the post-save nav as
  designed. Same single-file change in
  `mobile/lib/presentation/router/app_router.dart`. `flutter analyze`
  clean.

## [0.3.12] - 2026-05-12

### Fixed

- **Mobile**: System-browser CF Access login (introduced in v0.3.11 /
  PR #289) crashed with
  `GoException: no routes for location: remotedev://auth/callback?…`
  after the OS browser deep-linked back to the app. The Flutter engine
  routes the callback URI through `MaterialApp.router`'s route
  information provider before `MobileCallbackLoginLauncher`'s parallel
  `deepLinkStreamProvider` subscription consumes it, so the URI hit
  GoRouter as an unmatched location. Added a `redirect:` callback on
  `AppRouter` that absorbs the callback (and a stray bare `/` URI the
  Android engine re-fires when returning from a Chrome Custom Tab) by
  bouncing to `/servers` — the launcher's `onSaved` / `onSuccess`
  continuation then drives the real navigation. Single-file fix in
  `mobile/lib/presentation/router/app_router.dart` (45 lines added).
  `flutter analyze` clean; `flutter test` not gated on this iteration
  due to an unrelated macOS Gatekeeper hang on `flutter_tester`.

## [0.3.11] - 2026-05-11

### Added

- **Mobile**: System-browser CF Access login flow. The Add Server flow now
  hands the CF challenge off to the OS browser via `url_launcher` and uses
  an `app://` deep link to return the harvested `CF_Authorization` cookie.
  Fixes prior CF login failures in the embedded WebView on devices where
  CF redirected to provider SSO (Google/Microsoft/Okta) (PR #289,
  remote-dev-jch1).
- **Mobile**: Restored the legacy terminal-window launcher icon + splash
  logo on Android + iOS (PR #288).

### Fixed

- **Mobile**: Shrank the Android 12+ splash logo to fit the 768px safe
  zone — prevents the launcher logo from being clipped on devices with
  Android 12 SplashScreen API (PR #290, follow-up on #288).

## [0.3.10] - 2026-05-11

### Fixed

- **Build**: `terminal:build` no longer fails on `chromium-bidi`. The
  bundler was following the dynamic `import("playwright")` in
  `browser-service.ts` and choking on chromium-bidi's package.json
  `exports` map. Marked `playwright`, `playwright-core`, and
  `chromium-bidi` as `--external` so they resolve from `node_modules`
  at runtime. Unblocks desktop release artifacts for the first time
  since v0.3.7.

### Added

- **Agents**: "Pick Agent ▸" submenu in the sidebar `+` dropdown and
  project context menu, mirroring the existing "New SSH ▸" pattern.
  Lists all four installed agent providers (Claude Code, OpenAI Codex,
  Gemini CLI, OpenCode) with install status pulled from
  `/api/agent-cli/status`; uninstalled providers appear disabled with
  a "Configure agents…" footer that opens Settings → Agents. Top-level
  "New Agent" item launches the user's default agent in one click
  (remote-dev-d2w1).
- **Agents**: User-level default agent dropdown in Settings → Agents
  (`user_settings.default_agent_provider`). Falls back to "claude" when
  unset. Project-level `defaultAgentProvider` (already on
  `node_preferences`) still overrides per project; the
  `ProjectPreferencesView` free-text input is now a `<Select>` with an
  "(inherit)" option.
- **Agents**: Per-provider default flags (`extraFlags`,
  `allowDangerous`) persisted in
  `user_settings.agent_provider_settings` and
  `node_preferences.agent_provider_settings` JSON columns. Settings →
  Agents and Project Preferences both expose collapsible per-provider
  cards (`AgentProviderConfigCard`) with a Bypass-permissions toggle
  and Extra-flags textarea. `SessionService` merges these into the
  resolved agent command at session-create time (project replaces user
  for a given provider; explicit `input.agentFlags` accumulates, explicit
  `agentProvider` and `allowDangerousFlags` override outright).
  Dangerous-flag filter is now applied uniformly in both the agent
  plugin path and the `autoLaunchAgent` fallback path.
- **Agents**: `CreateSessionInput.allowDangerousFlags` per-session
  override now honored by the agent plugin.

### Removed

- **Preferences**: Removed the `startupCommand` field from user
  settings and node preferences. The feature was a brittle string
  wrapper that frequently overrode an explicitly chosen agent
  provider (e.g., picking Codex from "Pick Agent ▸" silently ran
  `claude` if the project had `startupCommand: "claude"` saved).
  Use `agentFlags` for one-shot per-session flags (e.g.,
  `--resume xyz`) and shell aliases for wrapper scripts. The DB
  columns (`user_settings.startup_command`,
  `node_preferences.startup_command`) are retained as nullable
  orphans for now and will be dropped in a future migration. The
  related `CreateSessionInput.startupCommand` /
  `startupCommandOverride` fields are gone, along with
  `Preferences.startupCommand` /
  `FolderPreferences.startupCommand` /
  `UserSettings.startupCommand` types, the per-provider HOME
  override (`resolveEffectiveHome`) sniffer, and the UI inputs in
  Settings → Terminal, Project Preferences, and Group Preferences.
- **NewSessionWizard**: Dropped the "Custom Command" agent preset —
  it was the only consumer of the deleted string-level command
  transport. The feature session flow now requires one of the four
  supported agent providers; configure extra CLI flags in
  Settings → Agents instead.
- **SaveTemplateModal**: Removed the Startup Command input. The
  `SessionTemplate.startupCommand` DB field is preserved (templates
  saved before this release will keep their stored value) but is no
  longer applied when creating a session from a template — future
  template UI will translate it into `agentFlags` if needed.
- **ResumeClaudeSession**: Rewrote the resume flow to use
  `agentFlags: ["--resume", id]` instead of building a startup-command
  string against the folder's deleted `startupCommand` preference.
  Resume now always launches `claude --resume <id>` (per-provider
  extra flags from preferences are still merged in by
  `SessionService`).

## [0.3.9] - 2026-05-10

### Changed

- **Secrets**: Collapsed secrets provider surface area to Phase only —
  removed unused type members, config interfaces, and factory branches
  for `vault`, `aws-secrets-manager`, and `1password`. The UI was
  already restricted in commit 39e5c23; this removes the corresponding
  dead backend surface so the type system reflects what actually works.
  `SUPPORTED_SECRETS_PROVIDERS` alias dropped; callers now import
  `SECRETS_PROVIDERS` directly. Closes #175.

### Added (Phase 9 — mobile final follow-ups)

- **Mobile**: Live unread count refresh on the Channels tab via 30 s
  polling (`_kChannelPollInterval`). `ChannelsTabScreen` is now a
  `WidgetsBindingObserver`; a `Timer.periodic` invalidates
  `channelsListProvider` while the tab is mounted and the app is
  foregrounded. Lifecycle handler stops polling on
  `paused/hidden/detached` and restarts (with an immediate refresh) on
  `resumed`. Trade-off: `IndexedStack` keeps the screen mounted across
  tab switches, so the timer fires on inactive tabs too — accepted as
  a cheap GET. Server SSE/websocket would need cross-team backend
  work; polling is the realistic mobile-only shippable
  (remote-dev-ph5b).
- **Mobile**: WebView page-load progress indicator. `WebViewFactory`
  exposes optional `onProgressChanged: ValueChanged<int>?`;
  `RecordingScreen` and `ChannelScreen` render a 2 px Tokyo Night
  `#7AA2F7` `LinearProgressIndicator` in the AppBar `bottom:` until
  the embed reports complete. `SessionViewScreen` skipped — xterm.js
  loads via WebSocket, not the page-progress mechanism. Bonus:
  `WebViewFactory.build(...)` return type widened from
  `InAppWebView` to `Widget` so test fakes can return
  `SizedBox.shrink()` without tripping the platform plugin
  (remote-dev-72dh).

### Added (Phase 8 — mobile bridge + scoping follow-ups)

- **Mobile**: `BridgeController.setFontScale(double)` and
  `setCursorBlink(bool)` plumb the Phase 7 Appearance settings into the
  embedded PWA. `RdvBridgeAdapter` extended with matching surface;
  `EmbeddedSessionView` / `EmbeddedChannelView` / `EmbeddedRecordingView`
  apply font scale by writing `--rdv-font-scale` on `<html>`. Only the
  session embed mutates xterm.js's `cursorBlink` option; other embeds
  treat the call as a no-op. Each WebView host (`SessionViewScreen`,
  `ChannelScreen`, `RecordingScreen`) `ref.listen<AppearanceSettings>`
  on change and pushes the initial value in `onTerminalReady`
  (remote-dev-3pfc, remote-dev-z3p9).
- **Mobile**: Per-screen WebView path scope. `NavigationPolicy` accepts
  optional `allowedPathPrefixes` that narrows the same-origin `/m/*`
  allow list. `RecordingScreen` pins to `/m/recording/`, `ChannelScreen`
  to `/m/channel/`, `SessionViewScreen` + `SessionRouteHost` to
  `/m/session/`. A same-origin redirect to a sister surface is now
  intercepted instead of silently navigating in-place. Login flow
  (`NavigationPolicy.forLogin`) keeps broad access (remote-dev-bvlw).
- **Mobile**: `ChannelScreen.bridgeFactoryOverride` constructor seam
  mirrors the existing `cfLoginLauncherOverride` pattern in
  `ReauthScreen`, letting widget tests drive `_handleBack` against a
  mocked `BridgeController` without a live `InAppWebView`. Two new
  smoke tests verify `bridge.back() == true` keeps the route mounted
  and `bridge.back() == false` produces a `didPop` (remote-dev-83as).

### Added (Phase 7 — mobile follow-ups)

- **Mobile**: Appearance profile screen — replaces the Phase 5 stub. Three
  device-local prefs (font scale 0.85x–1.30x slider, reduce motion switch,
  cursor blink switch) persisted via `shared_preferences` with keys
  `appearance.fontScale` / `appearance.reduceMotion` / `appearance.cursorBlink`.
  Hydrate-race guard via `_userTouched` flag so user changes before async
  hydrate aren't clobbered. Quantizes font scale to 2 decimals on persist.
  `MaterialApp.builder` reads the provider and applies
  `MediaQuery.copyWith(disableAnimations:, textScaler: TextScaler.linear(...))`
  so settings actually affect the chrome (remote-dev-czsf). Two follow-ups
  filed for WebView-side wiring: `remote-dev-3pfc` (fontScale → CSS via
  bridge) and `remote-dev-z3p9` (cursorBlink → xterm config).
- **Mobile**: GitHub Accounts profile screen — replaces the Phase 5 stub.
  Lists linked accounts (avatar + login + default badge) with tap → set
  default and long-press → unlink confirmation. Empty-state CTA opens
  in-app `flutter_inappwebview` at `<server>/api/auth/github/link`. OAuth
  callback detection uses strict `Uri.tryParse` + scheme/host/port/path
  validation to reject substring traps and cross-origin redirects.
  Server's PATCH uses `{action: "set-default"}` discriminator.
  `GitHubAccount.fromJson` accepts both `id` and `providerAccountId`
  field names + wrapped/bare list shapes for response tolerance
  (remote-dev-csb7).
- **Mobile**: About screen — replaces hardcoded "Version 0.1.0" with
  dynamic info from `package_info_plus`. Shows `appName`, `version`,
  `buildNumber`, and `packageName` via a `FutureProvider.autoDispose`
  with explicit loading/error fallbacks (remote-dev-d2f5).

### Changed (Phase 7)

- **Bridge**: `RdvBridgeAdapter.back()` contract changes from
  `() => void` to `() => boolean`. PWA-side back handlers now return
  `true` when they consume the gesture (e.g.
  `EmbeddedChannelView.back()` returns `true` after `closeThread()`).
  Native `BridgeController.back()` returns `Future<bool>`, evaluated in
  an async IIFE that awaits Promise returns to defeat the
  `!!Promise === true` race if the contract widens later. Native
  callers (`RecordingScreen._handleBack`, `ChannelScreen._handleBack`)
  await the result and only invoke `Navigator.maybePop()` when
  unhandled — fixes the prior double-pop where closing a thread would
  also pop the route. Backward-compatible: undefined/sync-false
  returns coerce to `false`, preserving today's behavior for any
  bridge build still on the old contract (remote-dev-cx0w).
- **Mobile**: Soften WebView cookie-sharing docstring on
  `RecordingScreen` to document iOS non-persistent / Android incognito
  / cold-start session-cookie caveats; the prior copy overstated
  automatic availability across `InAppWebView` instances
  (remote-dev-q37o).

### Added (Phase 6 — mobile redesign — backfilled)

- **Mobile**: Account profile screen — replaces the Phase 5 stub. Loads via
  `accountFutureProvider` against `/api/auth/session`, gates on
  `activeServerProvider.when()` so loading/error don't conflate with
  no-active-server, and provides a sign-out flow that scopes cookie
  deletion to the active server's origin via
  `CookieManager.deleteCookies(url:)` (no longer wipes other servers'
  cookies). `Account.fromJson` distinguishes wrapped (`containsKey('user')`)
  from bare payloads with a `FormatException` for malformed wrapped shapes
  (remote-dev-raen).
- **Mobile**: Branded RemoteDev launcher icon — `RD.` monogram in Tokyo
  Night palette (`#1A1B26` bg, `#C0CAF5` letterforms, `#7AA2F7` prompt-cursor
  accent). Generated via `flutter_launcher_icons` across 5 Android mipmap
  densities + iOS `Assets.xcassets/AppIcon.appiconset`. Adaptive icon for
  Android with `#1A1B26` background + transparent foreground PNG.
  `remove_alpha_ios: true` for App Store compliance (remote-dev-jav9).
- **Mobile**: Branded splash screen — RemoteDev logo + "RemoteDev" wordmark
  on `#1A1B26` background via `flutter_native_splash`. Bottom branding has
  per-platform padding (`branding_bottom_padding_ios: 34`,
  `branding_bottom_padding_android: 24`) so the wordmark clears iOS home
  indicator and Android gesture nav. Android 12 splash uses an 800×320
  branding asset per Material You docs (remote-dev-9rdc).
- **Mobile**: Cloudflare Access WebView login flow during Add Server.
  After URL probe success, a full-screen WebView opens at the server URL
  and lets the user complete the CF Access challenge inline. The WebView
  allows CF Access challenges and well-known SSO providers
  (Google, Microsoft, Okta) and any path on the server origin. On success,
  harvests `CF_Authorization` cookie via `CookieManager.getCookies()` and
  persists it to secure storage at `server.<id>.cf_authorization` before
  saving the server config (remote-dev-hgrq).
- **Mobile**: Dio cookie injection for CF_Authorization. New
  `CfAuthInterceptor` reads the active server's stored cookie from secure
  storage and injects `Cookie: CF_Authorization=<value>` on every outbound
  request. On 401/403, calls `onReauthNeeded` → bumps
  `reauthSignalProvider` → `RemoteDevApp.ref.listen` routes to `/reauth`.
  Case-insensitive Cookie header merge (Dio normalizes to lowercase)
  (remote-dev-cpti).
- **Mobile**: Reauth flow embeds the CF Access WebView. When the
  interceptor receives 401/403, the user lands on `/reauth` which mounts
  `CfLoginWebViewScreen` directly. On success, persists the fresh cookie,
  invalidates `activeServerProvider`, and routes to `/home`
  (remote-dev-d9st).

### Changed

- **Mobile**: User-facing app name renamed from `remote_dev` (snake_case)
  to **RemoteDev**. Android `android:label`, iOS `CFBundleName`, and iOS
  `CFBundleDisplayName` all updated. Pubspec name remains `remote_dev`
  (Dart package convention); bundle id `com.remotedev.app` unchanged
  (remote-dev-mx6y).
- **Mobile**: Sub-route navigation uses `context.push()` instead of
  `context.go()` so go_router builds a back stack. Profile sub-screens
  (Account, GitHub, Appearance, Servers, Security, About), session/channel
  drill-downs, and `/servers/add` & `/spike` all push. Top-level
  navigation (servers ↔ home, reauth, FCM cold-start) stays with `go`
  (remote-dev-xmbh).
- **Mobile**: Android system back gesture on a non-default tab now
  switches to the Sessions tab and consumes the pop, instead of exiting
  the app. Implemented via `PopScope` (Flutter 3.41+) wrapped around
  `HomeShell.Scaffold` (remote-dev-5q6p).
- **Mobile**: AppBar back buttons render correctly on Tokyo Night dark
  background — added `iconTheme: IconThemeData(color: Colors.white)` to
  AppBars on biometric, add_server, edit_server, bridge_spike screens.
  `SessionViewScreen`'s custom `SessionStatusBar` extended with a leading
  back-arrow `IconButton` (preserves the 44px row height per spec §4)
  (remote-dev-q029).
- **Mobile**: `/notifications` deep-link route opens HomeShell with
  Notifications tab pre-selected (was a placeholder screen). `HomeShell`
  accepts an optional `initialTab` constructor param. Push-tap deep-links
  via `NotificationTapHandler` now land on the live notifications tab
  with bottom nav visible (remote-dev-0jfw).
- **Mobile**: Channels tab AppBar resolves `#<channel-name>` from cached
  `channelsListProvider` via an extracted `_ChannelTitle` ConsumerWidget,
  so list refreshes rebuild only the title — not the WebView subtree
  (remote-dev-xbes).
- **Mobile**: Profile sub-screen audit. Servers wraps existing
  `ServerPickerScreen` (with `canPop`/fallback navigation); About uses
  real version copy. Account, GitHub Accounts, Appearance stubs filed as
  follow-ups (remote-dev-w5f5).
- **Mobile**: Recording screen exposes `webViewFactory` test seam
  matching `CfLoginWebViewScreen` precedent; smoke test verifies URL
  matches `<server>/m/recording/<id>` and that the strict
  `NavigationPolicy` is used (remote-dev-4g38).

### Fixed

- **Mobile**: Bottom navigation bar no longer occluded by tab page content.
  Each tab's primary scrollable (`SessionsTabScreen`, `ChannelsTabScreen`,
  `NotificationsTabScreen`, `ProfileTabScreen`) now reserves trailing
  padding via a centralized `tabContentBottomPadding(context)` helper
  (`kTabContentBottomPad = 16` + system bottom inset) so the last row
  clears the host shell's `AdaptiveBottomBar` even on Android
  edge-to-edge devices. The system inset is captured *above*
  `HomeShell.Scaffold` and passed via a private `_ShellChromeInsets`
  InheritedWidget — Scaffolds with `bottomNavigationBar` strip the
  bottom padding from the body MediaQuery, so reading it inside the
  body returns 0 (remote-dev-5vkq).
- **Mobile (critical)**: WebView navigation policy actually runs in
  production. `webview_factory.dart` was missing
  `useShouldOverrideUrlLoading: true`, which `flutter_inappwebview` 6.1.5
  defaults to `false` on both platforms — so `shouldOverrideUrlLoading`
  was never invoked and the navigation policy was unenforced across every
  WebView in the app (CF login, recording, channels, session view, bridge
  spike). Single-line fix in `InAppWebViewSettings` (remote-dev-4g38
  follow-up).
- **Mobile**: Bridge-spike entry point (bug icon on Server Picker) wrapped
  in `kDebugMode`, so it's tree-shaken from release builds. The
  non-interactive Cloudflare challenge page that previously confused
  users in production no longer renders (remote-dev-474v).

## [0.3.8] - 2026-05-09

### Added

- **New Flutter mobile app** (`mobile/`) — hybrid native + WebView shell that
  replaces the deprecated `archive/mobile-flutter/`. Native widgets handle the
  tab bar, server picker, biometric lock, smart-keys / native input bar, deep
  links, and notification taps; WebView hosts the terminal canvas, channel
  view, and recording playback against the existing `/m/*` PWA routes.
  Multi-server (Cloudflare Access) login, FCM push with multi-server token
  fan-out, three-state ModifierLatch smart keys, pinch-to-zoom, biometric lock
  via `local_auth`, and `remotedev://` + `https://<server>/m/*` deep-link
  routing all ship in this release. Bundle id `com.remotedev.app` preserved
  from the deprecated app. Phase 0 PWA-side embed routes (`/m/session/<id>`,
  `/m/channel/<id>`, `/m/recording/<id>`) added in `src/components/mobile/embed/`.
  Tag-driven release workflow at `.github/workflows/mobile-release.yml` builds
  signed Android App Bundle + iOS IPA on `mobile-v*` tags. Spec at
  `docs/superpowers/specs/2026-05-08-flutter-app-redesign-design.md`; phase
  plans under `docs/superpowers/plans/2026-05-08-flutter-app-phase-*.md`.

### Removed

- Archived the Flutter mobile app to `archive/mobile-flutter/` pending mobile
  redesign (`remote-dev-jt22`). Removed the Flutter Android APK build from CI
  (`build-android` job in `.github/workflows/release.yml`) and dropped the
  `tests/mobile/android-release-signing.test.ts` gradle-signing test that only
  asserted the archived app's config. The `RDV_ANDROID_KEYSTORE_PATH`,
  `RDV_ANDROID_KEYSTORE_PASSWORD`, `RDV_ANDROID_KEY_ALIAS`, and
  `RDV_ANDROID_KEY_PASSWORD` env var contract is preserved so the redesign can
  reuse existing CI secrets without re-provisioning. The unrelated
  `packages/mobile/` (React Native / Expo) and `src/components/mobile/` (web
  mobile UI) trees are untouched.
- **`legacy_folder_id` bridge columns + unique indexes** on `project_group` /
  `project` tables (`remote-dev-lylj`). The transitional bridge from the
  pre-refactor `folders` schema was retained for back-compat through the
  previous release; the columns, the `project_group_legacy_user_idx` /
  `project_legacy_user_idx` unique indexes, and the
  `translateFolderIdToProjectId` helper are now dropped. Migration:
  `drizzle/0018_drop_legacy_folder_id_bridge.sql`.

### Fixed

- Bottom rows of the terminal no longer clipped on unfolded foldables (`remote-dev-6ot7`)
- **Mobile `/` Lighthouse perf — SSR-paint mobile shell** (`remote-dev-ruh0`).
  After `c9aq` (provider deferral) capped mobile `/` at perf **86–87**, the
  remaining 3-point gap was structural LCP (~4.0 s) — `MobileApp` rendered
  `MobileLockScreen` ("Loading…") during SSR + first paint, gated on
  `useFirstRun()` returning `null` until a `useEffect` consulted
  `localStorage`. Lighthouse can't credit a spinner placeholder as the LCP
  candidate, so LCP only fired when the post-hydration content (welcome
  heading) painted. Switched `useFirstRun()` to `useSyncExternalStore` so
  the flag resolves synchronously: `getServerSnapshot()` returns `true`
  (assume first-run), so SSR paints the real `MobileWelcomeScreen` with
  its `<p text-[22px]>Welcome to Remote Dev.</p>` LCP-eligible heading at
  FCP time. Removed the `firstRun.isFirstRun === null` lock-screen branch
  in `MobileApp` (lock screen is still used for the
  no-`initialUser`/CF-Access-pending paths). Mobile Lighthouse on `/`:
  performance **0.87 → 0.90–0.92**, simulated LCP **4.0 s → 3.3–3.6 s**
  (observed LCP **73 ms**, dropped from 122 ms element-render-delay to
  56 ms), FCP/TBT/CLS unchanged. The simulated-LCP-vs-2.5 s gap is
  Lantern's network-throttling model rather than a real paint problem;
  the LCP element is now in the SSR'd HTML stream. Reports under
  `docs/reports/2026-05-08-lighthouse-mobile-ruh0/`.
- **`/login` mobile Lighthouse perf** (`remote-dev-tx71`). The login route
  was shipping the same heavy client tree as `/` — NextAuth `SessionProvider`,
  `AppearanceProvider`, sonner `Toaster`, and `ServiceWorkerRegistration` were
  all hoisted into the root layout, dragging a 224 KB shared chunk onto a
  page that's just an email + password form. Moved the page into a new
  `(auth)` route group, extracted the heavy providers into a lazy-loaded
  `<AppShell>` client component, and conditionally render it from the root
  layout based on a new `x-pathname` header set by `proxy.ts`. Mobile
  Lighthouse on `/login`: performance **0.82 → 0.97**, LCP **5.0 s → 2.6 s**,
  Time to Interactive **5.0 s → 2.9 s**. FCP/TBT/CLS unchanged. End-to-end
  credentials login + redirect verified. Reports under
  `docs/reports/2026-05-08-lighthouse-login-tx71/`.

### Added

- **Lighthouse mobile perf baseline** (`remote-dev-k583`). Captured a
  production Lighthouse run for `/` (mobile + desktop) and `/login` (mobile)
  against `bun run build` + `bun run start`. Mobile `/` scores 72-73, desktop
  `/` 64, `/login` 82 — all sub-90. Dominant opportunity on every route is
  `unused-javascript` (~1.95 s simulated savings on `/`); a single 470 KB
  bundle is 72 % unused on mobile because `MobileViewportSwitch` ships both
  branches in the same client component tree. FCP 1.1 s, Speed Index 1.1 s,
  CLS ≈ 0, TBT 220–260 ms — only LCP (6.6–7.2 s on `/`) is red, and is
  bottlenecked on JS parse, not network or paint. Filed `remote-dev-gj45` to
  code-split the desktop branch out of the mobile critical path and
  `remote-dev-tx71` for the same trim on `/login`. Raw reports + writeup
  under `docs/reports/2026-05-07-lighthouse-mobile/`.
- **`scripts/worktree-warm.sh`** (`remote-dev-unpj`). Bootstraps a fresh agent
  worktree by cloning the main checkout's `node_modules/` into the worktree
  using APFS `cp -cR` (copy-on-write clonefile), with rsync and `bun install`
  fallbacks. Resolves the Turbopack 16 build failure caused by symlinking
  `node_modules` outside the worktree filesystem root, and replaces the 9+
  minute cold `bun install`. End-to-end cold start to a successful `bun run
  build`: ~45 seconds. Documented in CLAUDE.md under "Worktree Setup".
- **SSH terminal type** (`remote-dev-i13k`). New `ssh` terminal type opens a
  tmux-backed pane that runs `ssh` (or `sshpass ssh` for password auth) as
  the shell process; when SSH disconnects, the agent-style exit screen
  surfaces with a Reconnect button. Saved connections live in a new
  user-level `ssh_connection` table with optional project pinning and
  support four auth methods: `key` (paste / upload / generate ed25519),
  `agent` (forwarding via `-A`), `password` (encrypted at rest, requires
  `sshpass`), and `system` (defers to `~/.ssh/config`). Per-connection
  assets (private key 0600, public key 0644, `known_hosts`) are stored in
  `~/.remote-dev/ssh/{id}/` with a 0700 directory mode. Passphrases are
  intentionally never stored — OpenSSH prompts in the terminal at connect
  time. Configure connections in **Settings → SSH** and pick one from the
  New Session wizard's **SSH** card.
- **Mobile two-stage swipe to close sessions** (`remote-dev-7o72`). Swipe-left
  on an active session row now reveals "Suspend" (stage 0, 72px) and switches
  to "Close" with a destructive label (stage 1, 180px), matching iOS Mail.
  Suspended rows get a single-stage swipe that commits Close. The behind-layer
  affordance label and tone update mid-drag so the user sees which action will
  fire on release. Closed/trashed rows remain non-swipable.
- **Clear all notifications** (`remote-dev-7o72`). The mobile Notifications
  tab gains a "Clear all" header button that opens an `AlertDialog`
  confirmation; on confirm it calls `deleteAllNotifications` and shows a
  toast with the count. The button is hidden when the list is empty and is
  disabled while the request is in flight.

### Security

- **Sign-out hardening**: `/api/auth/signout` no longer exports a GET handler
  (removed CSRF logout vector — third-party `<img src>` could trigger
  sign-out). The POST handler additionally rejects cross-origin requests via
  an Origin/Referer same-origin check. Removed the `joyfulhouse` placeholder
  default for `CF_ACCESS_TEAM` from both the signout route and
  `src/lib/cloudflare-access.ts`: an unset team no longer silently redirects
  users to a foreign Cloudflare tenant or attempts JWKS fetches against one.
  `MobileLockScreen` now shows generic "Loading" copy while the NextAuth
  client session is resolving, and only switches to "Authenticating via
  Cloudflare Access" once the session is confirmed unauthenticated, so
  credentials/localhost users no longer see misleading CF copy.

### Fixed

- **Mobile terminal disappears on Pixel Fold unfold** (`remote-dev-9rvt`). `MobileShell` now wraps its pass-through path in a bounded-height `h-[100dvh]` container so `MobileSessionView`'s `h-full` keeps a parent to fill when the viewport crosses 768px on a UA-mobile foldable; previously the terminal viewport collapsed to 0px and only the status/input bars rendered.
- **Terminal focus signal fires per-pane** (`remote-dev-mbup`). Added native
  `focus` / `blur` listeners on xterm's input textarea so primary-client
  election triggers when the user clicks between panels or terminal tabs in
  an already-focused window — previously only window-level focus and tab
  visibility changes sent the signal.
- **Mobile critical path: defer desktop-only context providers**
  (`remote-dev-c9aq`). Closes the perf gap left by `gj45`: even after the
  viewport switch was code-split, `app/page.tsx` was still wrapping both
  branches in 18 React context providers, so a mobile viewport
  downloaded (and ran the mount-time `useEffect` side effects of) the
  desktop-only context code — Template, Recording, Trash, Schedule,
  Secrets, LiteLLM, Profile, GitHubAccount, GitHubStats, GitHubIssues,
  Port, SessionMCP, Beads. Those 13 providers moved into a new
  `DesktopProviders` component that's mounted *inside* the dynamically
  imported `DesktopApp` chunk, so they are no longer part of mobile's
  initial bundle and their WebSocket connects, polls, etc. no longer
  fire on mobile. Six providers stay at the top level (Preferences,
  ProjectTree, Session, Channel, Notification, PeerChat) because the
  mobile tree consumes them directly. Mobile's `NewSessionSheet` —
  which embeds the shared `NewSessionWizard` and pulls in
  `ProfileContext` + `TemplateContext` transitively — is now
  `dynamic(ssr: false)` from `SessionsTab` and re-mounts those two
  providers locally, so the providers' WebSocket connects + initial
  fetches only fire when the user taps "+ New". Server-side bootstrap
  data (`isGitHubConnected`, `initialHasGitHubAccounts`) is threaded
  through `MobileViewportSwitch` → `DesktopApp` → `DesktopProviders`
  props instead of via top-level provider props, so the desktop SSR
  HTML is unchanged.
- **Mobile critical path: code-split `MobileViewportSwitch` branches**
  (`remote-dev-gj45`). Both `MobileApp` and `DesktopApp` now load via
  `next/dynamic`, so a mobile viewport never downloads the desktop
  `SessionManager` dependency graph (xterm, codemirror, sidebars, modals)
  and a desktop viewport never downloads the mobile shell. `app/page.tsx`
  does a server-side UA sniff and forwards an `initialIsMobile` hint so
  the chosen branch is SSR-rendered with no skeleton flash; the
  `useSyncExternalStore`-backed `useIsMobileViewport()` hook still
  corrects any UA miss or window resize on the client. The desktop tree
  was extracted into `src/components/desktop/DesktopApp.tsx` so it can
  be the dynamic target. Lighthouse home `/`: mobile perf 72-73 → 84-87
  (LCP 6.6–7.2 s → 4.2–4.5 s), desktop perf 64 → 92, mobile
  `unused-javascript` savings 366 KB → 99 KB (well below the 100 KB
  acceptance threshold), CLS unchanged on mobile (0 → 0). Mobile target
  of ≥90 not yet hit because the simulated LCP is now bottlenecked on
  the `~1.18 MB` of provider/context bundle that wraps the page (16
  nested context providers, plus mobile's own xterm-backed
  `MobileSessionView`); follow-up work will need to defer those
  providers, not the viewport switch itself. Reports under
  `docs/reports/2026-05-07-lighthouse-mobile-gj45/`.
- **Terminal WebGL glyph corruption** (`remote-dev-ljnc`). Long-running sessions
  could show torn/duplicated glyphs that only cleared when the window was
  resized. `Terminal.tsx` now clears the WebGL texture atlas on
  `visibilitychange` (tab restored from background) and device-pixel-ratio
  changes (window moved between displays), and recovers from a single WebGL
  context loss by reloading the addon instead of permanently falling back to
  the DOM renderer.
- **Terminal WebGL glyph corruption — scroll/volume triggers**
  (`remote-dev-ofqf`). The earlier `visibilitychange`/DPR fix didn't help users
  whose tab stays foregrounded for hours: the texture atlas still overflows
  once a session accumulates enough distinct glyphs/colors, and artifacts
  appear when scrolling back through history. `Terminal.tsx` now also clears
  the atlas while the user is scrolled up in the buffer (throttled to once
  every 2 s) and after every 5,000 line feeds, so corruption clears itself
  without requiring a window resize.
- **Mobile `MobileViewportSwitch` hydration mismatch warning**
  (`remote-dev-m2lg`). Reimplemented `useIsMobileViewport()` on top of
  `useSyncExternalStore` (matching the existing `useMobile` and
  `usePrefersReducedMotion` pattern in the same file) so the server snapshot
  is always `false` (desktop) while the first client render returns the live
  `matchMedia` result. React 19 treats this controlled mismatch from
  `useSyncExternalStore` as expected and no longer emits a dev-mode hydration
  warning at the switch — and as a bonus, mobile users now see the mobile
  composition on the very first paint with no flash of desktop layout.
- **Mobile smart-key strip a11y** (`remote-dev-1jym`). Aligned accessible
  names with visible text on smart-key strip and mobile keyboard mode toggle
  buttons to satisfy Lighthouse `label-content-name-mismatch` (WCAG 2.5.3):
  text-label keys (Esc, Tab, punctuation) now use their visible text as the
  accessible name; modifier latches (Ctrl/Alt/Shift) and the NAV/KEYS toggle
  prefix the visible text in `aria-label` before the contextual suffix.
- **Channels list returns empty (200) for stale active-node id**
  (`remote-dev-d6jk`). `GET /api/channels?projectId=` previously returned 404
  when the id referenced a deleted/inaccessible project, and the route had
  silently dropped support for the legacy `?folderId=` alias used by older
  clients — both surfaced as a persistent error toast in `ChannelContext` when
  the persisted active-node id went stale (e.g. after a project delete).
  The route now treats unknown ids (projectId, legacy folderId, or nodeId) as
  empty result sets and returns `{ groups: [] }` with a 200, matching how
  list-scoped-to-X endpoints typically handle a missing X. Validation errors
  (e.g. malformed `nodeType`) still return 400 with a typed `INVALID_NODE_TYPE`
  code so genuine client bugs aren't masked.
- **Mobile redesign Phase 7 audit + polish** (`remote-dev-0hx8`). Surgical
  pass against the DESIGN.md bar:
  - **A11y** — Mobile session rows now announce status to screen readers
    (`Open session foo, waiting for input` etc.) so the colour-only pip
    isn't the only signal channel. The bottom tab bar's unread badge is
    folded into the tab's `aria-label` (e.g. `Channels, 3 unread`); the
    visual badge stays `aria-hidden` so SRs hear it once, not twice.
  - **Contrast** — `MobileNotificationRow` metadata (sessionName +
    timestamp) moved off `text-muted-foreground/60` and `/40` (failed AA at
    10px) onto solid `text-muted-foreground` with a middle-dot separator.
    `ProjectTreeSheet`'s `auto` chip moved off `/70` for the same reason.
  - **Reduced motion** — `.agent-breathing` (used on desktop sidebar +
    peer tab bar pips) now gates on `prefers-reduced-motion` consistently
    with `.notification-ring`; the pulsing-opacity animation is suppressed
    rather than running through the user's preference.
  - Adversarial-review polish: pin `.agent-breathing` opacity in
    reduced-motion; quiet idle-state SR announcement on mobile session
    rows; match visual `99+` in tab-bar SR label; sr-only comma between
    notification metadata fields.
- **Mobile terminal touch interactions: adversarial-review bugs**
  (`remote-dev-ub9k`). Four bugs in the touch-selection state machine fixed:
    - Selection rows now use buffer-absolute coordinates (`viewportRow +
      terminal.buffer.active.viewportY`) so a long-press in scrolled-back
      history highlights the cell under the finger instead of a row at the
      top of the buffer.
    - `reset()` (touchcancel, destroy, multi-touch handoff) now calls
      `terminal.clearSelection()` when a selection was active, so a stale
      highlight no longer lingers after the gesture is forcibly cleared.
    - `handleTouchEnd` now gates the full state reset on
      `e.touches.length === 0`. When one finger lifts but another remains,
      we abandon any active selection but stay out of `idle`, so the
      remaining finger isn't blocked from continuing the gesture.
    - Replaced a false-positive multi-touch test in
      `Terminal.touch-scroll.test.ts` that constructed an event but never
      invoked the handler — it now actually drives `handleTouchMove` and
      asserts the bail-out contract.
- **Mobile terminal touch interactions follow-ups** (`remote-dev-zigy`).
  Three regressions from PR #227's tap-to-click + long-press-to-select layer
  are now resolved:
    - Selection drag no longer fights the scroll handler. Both
      `useTouchInteractions` and `touch-scroll` now share a `TouchModeRef`,
      and the scroll handler skips activation while the interactions handler
      is in `selection` mode. Belt-and-suspenders: the interactions touchmove
      listener is now `passive: false` and calls `preventDefault()` on
      touchmove during selection so even handler-order quirks can't scroll
      the viewport from under the user's selection.
    - Tap now reliably triggers `terminal.scrollToBottom()` regardless of
      mouse mode (matches the universal "tap to jump to latest" mobile
      pattern), and dispatches the synthetic mouse pair on the
      `.xterm-screen` element directly (the stable mouse-listener host in
      xterm v6) rather than the fragile inner canvas.
    - Tap on an active selection clears the selection without firing a click
      or scroll, matching standard text-selection UX.
- **Desktop terminal initial fontSize/fontFamily race**
  (`remote-dev-3gtr`). The xterm.js terminal stayed at the default font size
  (14px) on first mount when `PreferencesContext` resolved during the async
  init window (xterm/addon imports + WebGL load). The font-update effect
  re-fired with the new values but bailed because `xtermRef.current` was
  still null, and no later effect re-applied them. Switching to another
  session and back masked the bug because the second mount saw the loaded
  preferences synchronously. Fixed by reconciling
  `terminal.options.fontSize`/`fontFamily` against the synchronized refs
  immediately after `xtermRef.current = terminal`, closing the race window.
- **Phase 3 mobile session view: adversarial-review fixes** (PR #220). Replaced
  the saturated `text-green-400 bg-green-400/20` long-press indicator on
  `MobileInputBar` with the token-based `--color-signal-running` to honor the
  DESIGN.md achromatic-default rule. The bottom tab bar now auto-collapses
  3.5s after a swipe-up reveal so the session view returns to full-bleed
  without the user having to dismiss it manually. The terminal viewport
  declares `touch-action: pan-y` to suppress iOS Safari's native pinch-to-zoom
  while preserving vertical scroll, eliminating the double-zoom on font
  resize. Persisted font size is now read via `useSyncExternalStore` to
  prevent a hydration mismatch under React 19 / Next.js 16. Extracted the
  shared `AnsiStripper` to `src/lib/terminal/ansi-stripper.ts` so
  `MobileTerminalView` and the new `MobileSessionView` can't drift apart.

### Added

- **Mobile redesign Phase 6: Auth flow + Profile tab** (remote-dev-lud6).
  Polishes the post-Cloudflare-Access landing into a calm, two-step flow:
  a `MobileLockScreen` interstitial ("Authenticating via Cloudflare Access")
  while the session resolves, then a one-time `MobileWelcomeScreen` with a
  signed-in-as line, an optional Connect-GitHub CTA, and a Skip-for-now
  button. First-run state is persisted via a localStorage flag
  (`remote-dev:mobile:welcome-seen:v1`) so subsequent visits jump straight
  to Sessions. The GitHub OAuth callback's `?github=connected` query param
  now surfaces a one-shot success toast on the Sessions tab and is stripped
  from the URL on read. The Profile tab ships as a pushed-row stack
  (Account, GitHub accounts, Projects, Agent profiles, Secrets, Ports,
  Trash, Settings, About, Sign out) with a tab-local navigation stack —
  no modals for routine settings, every row pushes a sub-screen, and Sign
  out confirms via an `ActionSheet` (not a dialog). Sub-screens beyond
  About are intentionally stubbed in this build with a TODO note pointing
  at the desktop component to port; the navigation chrome and primary
  flows are real.
- **Mobile redesign Phase 4: Notifications tab** (remote-dev-qvpf). The
  mobile Notifications tab preserves the existing notification model and
  the canonical attention-blue halo end-to-end. Filter chips (All / Unread
  / Mentions) sticky to top, count pills on Unread / Mentions. Each row
  uses a leading 12px (6px-radius) dot in `--color-signal-attention-solid`
  for unread state instead of a colored side-stripe (DESIGN.md "No
  Side-Stripe Rule"); the `notification-ring-pulse` halo renders on
  `agent_waiting` rows and is suppressed under `prefers-reduced-motion`.
  Swipe-left = delete with 5s undo toast (sonner); swipe-right = toggle
  read; long-press opens an ActionSheet with Jump to session, Mark
  read/unread, Mute project, and Dismiss. Tapping a row inline-expands the
  body (no push navigation) and marks unread items read. Pull-to-refresh
  uses the canonical absolutely-positioned indicator pattern. Empty state
  copy is "Inbox zero" for the All filter; filter-specific empties for
  Unread and Mentions. New files under
  `src/components/mobile/notifications/` (`NotificationsTab`,
  `MobileNotificationRow`, `NotificationFilterChips`,
  `useNotificationSwipe`). Wired into `MobileApp.tsx`.
- **Mobile redesign Phase 2: Sessions tab** (remote-dev-l9qg). The mobile
  home is now the Sessions tab. A header strip with a project switcher chip,
  a `+ New` pill, and a recent-projects rail sits above a session list with
  a 6px state pip per row, weight-driven hierarchy on the title, and a
  foreground line-segment indicator for the active row (no colored side
  stripes). Long-press opens an action sheet (Suspend / Resume / Rename /
  Move / View recordings / Close session). Swipe-left dispatches suspend
  with a 5s undo toast. Pull-to-refresh, attention-blue halo for waiting
  sessions, and reduced-motion respect everywhere. New `BottomSheet` and
  `ActionSheet` primitives, `usePullToRefresh` hook, and a project-tree
  bottom sheet with search complete the surface. Built on top of the Phase 1
  shell from remote-dev-3ozu.

### Security

- **Sign-out hardening**: `/api/auth/signout` no longer exports a GET handler
  (removed CSRF logout vector — third-party `<img src>` could trigger
  sign-out). The POST handler additionally rejects cross-origin requests via
  an Origin/Referer same-origin check. Removed the `joyfulhouse` placeholder
  default for `CF_ACCESS_TEAM` from both the signout route and
  `src/lib/cloudflare-access.ts`: an unset team no longer silently redirects
  users to a foreign Cloudflare tenant or attempts JWKS fetches against one.
  `MobileLockScreen` now shows generic "Loading" copy while the NextAuth
  client session is resolving, and only switches to "Authenticating via
  Cloudflare Access" once the session is confirmed unauthenticated, so
  credentials/localhost users no longer see misleading CF copy.

### Fixed

- **Mobile terminal touch interactions follow-ups** (`remote-dev-zigy`).
  Three regressions from PR #227's tap-to-click + long-press-to-select layer
  are now resolved:
    - Selection drag no longer fights the scroll handler. Both
      `useTouchInteractions` and `touch-scroll` now share a `TouchModeRef`,
      and the scroll handler skips activation while the interactions handler
      is in `selection` mode. Belt-and-suspenders: the interactions touchmove
      listener is now `passive: false` and calls `preventDefault()` on
      touchmove during selection so even handler-order quirks can't scroll
      the viewport from under the user's selection.
    - Tap now reliably triggers `terminal.scrollToBottom()` regardless of
      mouse mode (matches the universal "tap to jump to latest" mobile
      pattern), and dispatches the synthetic mouse pair on the
      `.xterm-screen` element directly (the stable mouse-listener host in
      xterm v6) rather than the fragile inner canvas.
    - Tap on an active selection clears the selection without firing a click
      or scroll, matching standard text-selection UX.
- **Multi-client tmux resize stuck after switching windows**
  (`remote-dev-nlfm`). The terminal server now elects the primary connection
  (the one allowed to call `tmux resize-window`) by most-recently-focused
  client instead of newest connection. The browser sends `client_focus` /
  `client_blur` on `visibilitychange`, `window.focus`, and `window.blur`; a
  1-second per-session cooldown prevents ping-pong between two side-by-side
  windows. When the primary disconnects the server picks the most recently
  focused remaining (visible) client and re-applies its size to tmux. A small
  "Another window is in control · click to claim" pill appears on
  non-primary clients and force-promotes when clicked. Clients that don't
  send focus signals continue to work via the existing newest-on-connect
  rule.
- **Desktop terminal initial fontSize/fontFamily race**
  (`remote-dev-3gtr`). The xterm.js terminal stayed at the default font size
  (14px) on first mount when `PreferencesContext` resolved during the async
  init window (xterm/addon imports + WebGL load). The font-update effect
  re-fired with the new values but bailed because `xtermRef.current` was
  still null, and no later effect re-applied them. Switching to another
  session and back masked the bug because the second mount saw the loaded
  preferences synchronously. Fixed by reconciling
  `terminal.options.fontSize`/`fontFamily` against the synchronized refs
  immediately after `xtermRef.current = terminal`, closing the race window.
- **Phase 3 mobile session view: adversarial-review fixes** (PR #220). Replaced
  the saturated `text-green-400 bg-green-400/20` long-press indicator on
  `MobileInputBar` with the token-based `--color-signal-running` to honor the
  DESIGN.md achromatic-default rule. The bottom tab bar now auto-collapses
  3.5s after a swipe-up reveal so the session view returns to full-bleed
  without the user having to dismiss it manually. The terminal viewport
  declares `touch-action: pan-y` to suppress iOS Safari's native pinch-to-zoom
  while preserving vertical scroll, eliminating the double-zoom on font
  resize. Persisted font size is now read via `useSyncExternalStore` to
  prevent a hydration mismatch under React 19 / Next.js 16. Extracted the
  shared `AnsiStripper` to `src/lib/terminal/ansi-stripper.ts` so
  `MobileTerminalView` and the new `MobileSessionView` can't drift apart.

## [0.3.7] - 2026-04-30

Pre-mobile-redesign baseline. Captures all changes since v0.3.6 as a rollback
point ahead of the gesture-first PWA redesign.

### Removed

- **Legacy `IssueDetailModal` dialog**: The Dialog-based issue detail view is
  gone. The issues terminal-type plugin already owns an in-pane
  `IssueDetailPanel` (selection persists via `selectedIssueNumber` in
  `typeMetadata`), and the stale modal wiring in `TaskSidebar` was the last
  caller. Issue clicks now stay within the issues tab layout. Closes
  bd remote-dev-1ebu.7.

### Fixed

- **Mobile web terminal: swipe now actually scrolls Claude Code / vim / less
  / lazygit chat history** (GH#178, remote-dev-61c1, follow-up to PR #210):
  PR #210 sent arrow keys (`ESC[A`/`ESC[B`) to alt-buffer apps, which TUIs
  with mouse-wheel reporting interpret as cursor movement, not scroll —
  visible regression in Claude Code, vim with `mouse=a`, less -m, lazygit,
  tmux mouse mode. Fixed by detecting `terminal.modes.mouseTrackingMode` and
  routing accordingly: when the app negotiated wheel reporting (vt200, drag,
  any), emit SGR mouse-wheel reports (`CSI < 64;1;1 M` back, `CSI < 65;1;1
  M` forward) per cell-height of finger travel — the same bytes desktop
  wheel produces. Falls through to scrollback (normal buffer) or arrow
  keys (alt buffer with no mouse mode, rare) when the app doesn't accept
  wheel reports. Buffer type, mouse mode, and DECCKM are re-read on
  every flush so DECSET 1049 transitions and vim mode toggles mid-swipe
  behave correctly. (Earlier PR #209 also fixed the latent "Latest" pill
  always-hidden bug and the wrong-element cell-height read; those remain.)
  iOS Safari pan preemption hardened by moving `e.preventDefault()` to the
  top of `touchmove`.
- **Non-tmux session resume no longer returns 410 / auto-deletes singleton
  tabs** (remote-dev-nv4e): `ResumeSessionUseCase` now consults the server
  plugin registry's `useTmux` flag and skips the `tmuxGateway.sessionExists()`
  probe for plugins that declare `useTmux: false` (settings, recordings,
  profiles, prefs, secrets, trash, port-manager, issues, prs, file, browser,
  …). Previously any click on a non-tmux singleton tab after navigating away
  issued `POST /api/sessions/:id/resume`, which returned 410 (tmux session
  missing — because there never was one), and `SessionContext.resumeSession`
  blindly treated every 410 as "tmux gone, auto-close" and DELETEd the
  session. The client is also hardened as defense-in-depth: 410 now only
  triggers auto-delete for tmux-backed terminal types
  (`isTmuxBackedTerminalType`); non-tmux sessions surface the error and keep
  the tab. Includes 19 new `ResumeSessionUseCase` unit tests and 10 new
  `SessionContext` client tests covering both the server fast-path and the
  client 410-branch fork.
- **Singleton terminal tabs survive re-open**: Clicking the gear / Recordings /
  Profiles button while the corresponding singleton tab was already open (in
  the background after switching to another session) could previously appear
  to close the tab in some state configurations. `openSettingsSession`,
  `openRecordingsSession`, and `openProfilesSession` now short-circuit to a
  pure client-side `setActiveSession` + `setActiveView("terminal")` when a
  non-terminal singleton for the requested scope already exists in local
  state. The server-side `POST /api/sessions` round-trip is only taken when
  no local singleton exists, eliminating any race between create/suspend/
  dedup that could leave the tab in an unexpected status.

### Changed

- **Sidebar Global section for singleton terminal tabs**: Sessions with
  `terminalType` in `GLOBAL_TERMINAL_TYPES` (`settings`, `recordings`,
  `profiles`) now render in a dedicated, collapsible "Global" section at the
  top of the project-tree sidebar regardless of the session's `project_id`.
  Previously these singleton tabs were anchored to whichever project was
  active when they were created, and a follow-up fix rewrote the stored
  `project_id` on scope-key dedup to keep the tab under the caller's current
  project. That re-anchor is now removed — the carrier `project_id` is an
  implementation detail of the NOT NULL schema constraint and is ignored by
  the tree renderer for these types. Closes remote-dev-cvtz.3.

### Added

- **Modals as terminal types**: Five content-rich Dialog modals (Issues, PRs,
  Recordings, Profiles, UserSettings) are now first-class **terminal type**
  session tabs that render in the full workspace. Resolves the Radix
  `ScrollArea` horizontal-overflow bug and gives each view proper room to
  breathe (recordings xterm finally renders at workspace dimensions; profile
  3-level nav has space for its sub-tabs).
- **Terminal-type plugin system overhaul**: Split `TerminalTypePlugin` into
  `TerminalTypeServerPlugin` (lifecycle config, no React) and
  `TerminalTypeClientPlugin` (component + icon + deriveTitle). Two separate
  registries; `session-service.ts` imports only the server registry so client
  modules stay out of the server bundle. `SessionService.createSession` now
  delegates `useTmux` / `shellCommand` / initial `typeMetadata` to the plugin.
  `SessionManager` dispatches via `clientRegistry.get(type).component`;
  unknown types render `UnsupportedSessionFallback` instead of silently
  coercing to `shell`. `SessionRow` icons and tab titles come from
  `plugin.icon` + `plugin.deriveTitle`.
- **`scope_key` column + server-side dedup** on `terminal_session`. When a
  caller passes a `scopeKey`, `createSession` reuses the existing non-closed
  session matching `(userId, terminalType, scope_key)` and returns
  `_reused: true` so the client upserts instead of duplicating. A partial
  UNIQUE index prevents races. Singleton tabs (settings/recordings/profiles)
  re-anchor their `projectId` on reuse so the tab follows the active project.
- **`typeMetadataPatch`** field on `UpdateSessionInput` for persistent plugin
  navigation state (selected issue, active tab, active profile). Shallow-merge
  semantics with `null`-deletes-key on both client and server; client
  reconciles optimistic state with the server response body.
- Targeted `GET /api/github/repositories/:id/issues/:number` endpoint so the
  PR detail view fetches a single issue's body instead of paging the full
  repo issue list.

### Removed

- `IssuesModal`, `PRsModal`, `RecordingsModal`, `ProfilesModal`, and
  `UserSettingsModal` are deleted (~2500 lines). Their content now lives in
  the corresponding terminal-type plugins.
- `activeView === "settings"` branch in `SessionManager` retired; Settings is
  reached through a regular `terminalType: "settings"` session.

- **Sidebar context menu updates**: Root-space context menu (right-click empty
  tree) and header `+` dropdown now offer **New Group** and **New Project**.
  Previously there was no UI entry point to create a top-level group. Root
  projects are now supported (`projects.group_id` is nullable) alongside root
  groups. **Move to Group…** submenu on group and project rows lets users
  reparent via the menu without dragging. Collapse/Expand items added to
  group and project menus. Footer Trash button gains a right-click
  "Empty Permanently" action that actually empties all trash (not just
  expired items, which was the prior behavior of `POST /api/trash`).

### Changed

- **Sidebar row stat layout**: Right-side badges now render in fixed
  vertical-column slots (PR / Issues / Sessions) with a terminal icon on
  session counts, so numbers line up across rows regardless of which badges
  are populated. The uncommitted-changes dot moves from the stat cluster to
  sit directly beside the group/project name. Hover-only action buttons use
  `display: none` when idle so they don't push the stat cluster sideways.
  Session rows regain the `SessionMetadataBar` (branch name with ahead/behind
  arrows, linked PR chip, allocated ports) beneath the session name.
- `projects.group_id` is now nullable with `ON DELETE SET NULL`; deleting a
  group demotes its child projects to root instead of destroying them.
  Force-deleting a group (via the confirmation dialog) now explicitly removes
  descendant projects + sessions, honoring the dialog's promise.
- **Project tree sidebar (Phases A–G)**: Replaced the legacy folder-based
  sidebar tree with a new group/project-aware `ProjectTreeSidebar`, dropping
  ~1900 lines of duplicated rendering in `Sidebar.tsx` while preserving
  drag/drop, context menus, repo stats rollup, inline editing, active-node
  selection, and mobile touch gestures. Adds mobile-only long-press touch drag
  for groups/projects and swipe-to-close on sessions that did not exist in the
  legacy tree.

### Added

- `terminal_session.project_id` is now `NOT NULL` with `onDelete: "cascade"`.
  Historical orphan sessions are backfilled by a one-time migration script
  (`bun run db:migrate-session-project-id`); new sessions must declare their
  project or the API rejects them with `PROJECT_ID_REQUIRED`.

### Removed

- Legacy `SessionFolder` / `FolderNode` type surface in `Sidebar.tsx` and the
  folder-tree rendering block. `FolderContext` and `PreferencesContext`
  folder-keyed state remain as temporary shims (tracked by `remote-dev-w1ed`)
  until all consumers migrate to node-keyed APIs.
- **Project/folder refactor Phase 6 (cleanup)**: legacy `session_folder`,
  `folder_preferences`, `folder_secrets_config`, `folder_github_account_link`,
  `folder_profile_link`, and `folder_repository` tables; `folder_id` columns
  on every dependent table (terminal sessions, templates, tasks, channels,
  channel groups, agent peer messages, agent configs, MCP servers, session
  memory, GitHub stats preferences, port registry); `user_settings.active_folder_id`
  and `pinned_folder_id`. Container, services, repositories, mappers, and
  use-cases for the legacy folder domain (`FolderService`, `folder-scope-util`,
  `DrizzleFolderRepository`, `Folder` entity, etc.). `FolderContext` is now a
  thin compat shim over `ProjectTreeContext`. `FolderPreferencesModal` is gone
  (replaced by `GroupPreferencesModal` + `ProjectPreferencesModal`). API
  routes `/api/folders/*`, `/api/preferences/folders/*`, and
  `/api/preferences/active-folder` removed. `rdv folder` subcommand removed —
  use `rdv group` and `rdv project` instead.
- Split pane feature (split groups, split pane layouts, split API endpoints, keyboard shortcuts)

### Changed

- **Project/folder refactor Phase 6 (schema tightening)**: `Session.folderId`
  is now `Session.projectId` throughout the domain and infrastructure layers.
  `project_id` is `NOT NULL` on the main dependent tables (`project_task`,
  `channel_groups`, `channels`, `agent_peer_message`); other bridged tables
  keep nullable `project_id` because user-scoped rows legitimately have no
  project. Coverage was verified pre-drop via the audit script archived in
  `scripts/archive/`.

### Added

- `rdv project` subcommand for managing projects (list/create/update/move/delete).
- `rdv group` subcommand for managing project groups (list/create/update/move/delete).
- Domain entities `ProjectGroup` and `Project` with hierarchy invariants (Phase 2 of project/folder refactor).
- Value objects `NodeRef` and `NodePreferences` (polymorphic container for group/project settings).
- Use cases for project/group CRUD + `ResolveProjectScope` (backs groups-can-be-active aggregation).
- **Project/folder refactor Phase 3 (services + API)**: Drizzle repositories for `ProjectGroup`, `Project`, and `NodePreferences` (with recursive-CTE descendant walks that stay within SQLite bind limits). New API routes `/api/groups`, `/api/projects`, `/api/node-preferences/:ownerType/:ownerId`, and `/api/preferences/active-node`. `/api/sessions` now accepts an optional `projectId` alongside `folderId`.
- **Dual-write to the projects bridge**: `SessionService`, `TemplateService`, `TaskService`, `ChannelService`, `PeerService`, `AgentConfigService`, `MCPRegistryService`, `PortRegistryService`, `WorktreeTrashService`, and `GitHubStatsService` now populate `projectId` on every insert into a bridged table (translating via `projects.legacyFolderId` when only `folderId` is supplied). Phase 4 readers can rely on `projectId` without waiting for a backfill.
- **Project-first reads**: `SecretsService.getConfigByProjectOrFolder` checks `project_secrets_config` before falling back to `folder_secrets_config`. `AgentProfileService.getFolderProfile` consults `project_profile_link` first, and `linkFolderToProfile`/`unlinkFolderFromProfile` mirror into the project link table. New `getProjectProfile` for direct project-node reads.
- **Task rollup across groups**: `TaskService.listTasksByNode(node, userId)` walks the group descendant tree via a recursive CTE and rolls up `project_task` rows through the `projects` bridge, filtering entirely in SQL.
- **`buildNodeAncestry(node, userId)` helper** in `src/lib/preferences.ts` — server-only, returns the node-preferences fields chain in ancestor-first order for a project or group node, laying the groundwork for the Phase 4 preferences resolver.
- **Project/folder refactor Phase 4 (UI switchover)**: New `ProjectTreeContext` exposes groups, projects, and a single `activeNode` (`{id, type: "group" | "project"}`) with optimistic CRUD (`createGroup`/`updateGroup`/`deleteGroup` and their project counterparts) and `setActiveNode` persisted via `/api/preferences/active-node`. `ProjectTreeSidebar` + `ProjectTreeRow` render groups and projects with hover-revealed settings gears; the legacy folder tree remains rendered below until Phase 6.
- **Group/Project preferences modals**: New `GroupPreferencesModal` (shared fields only) and `ProjectPreferencesModal` (shared + project-only fields like repo link, default agent provider, pinned files) write through `/api/node-preferences/:ownerType/:ownerId`. Gear icons on ProjectTree rows open the matching modal.
- **Active-node-aware Task & Channel sidebars**: `TaskContext` and `ChannelContext` now listen for `ProjectTreeContext.activeNode` and prefer node-scoped API endpoints (`/api/tasks?nodeId=&nodeType=`, `/api/channels?nodeId=&nodeType=`), which roll up data across descendant projects when a group is active. Both fall back to the legacy folder-scoped queries when no node is active or when a project lacks a `legacyFolderId` bridge.
- **`ChannelService.listChannelGroupsForNode`**: server-side recursive-CTE descendant resolver (`resolveFolderIdsForNode`) plus aggregator that concatenates `listChannelGroups` across each descendant project's bridged folder.
- **`SaveTemplateModal` project picker**: save-as-template now writes `projectId` (falling back to the session's `projectId`, then its `folderId` mapped via `projects.legacyFolderId`, then the active project node). `folderId` continues to be populated for legacy consumers.
- **`SessionContext` project-first create**: new sessions auto-inherit the active project's `projectId`, and `folderId` is derived from `projects.legacyFolderId` when missing, keeping dual-write consistent across the tree-driven flow.
- **`ActiveNodeIndicator`**: small sidebar chip that shows the active node name, with a `(rolled up)` suffix when a group is active, so users can tell when data is being aggregated across descendants.
- **Real-time sidebar sync**: Session and folder lists now update automatically across tabs and systems without page refresh — visibility-based refresh on tab focus + WebSocket broadcast on mutations
- "Open Folder" context menu: right-click a folder to open its working directory in the OS file manager
- Chat channels and groups: Slack/Discord-style channel organization for peer chat
- Channel groups: "Channels" (default) and "Direct Messages" organizational containers
- Default `#general` channel auto-created per project folder
- Users and agents can create new channels via UI, rdv CLI, and MCP tools
- Slack-style thread support: inline reply counts, slide-in thread panel
- Full GFM markdown rendering in chat messages (headers, code blocks, links, tables)
- Channel sidebar replaces task sidebar when chat view is active
- DB-backed per-user unread tracking with `channel_read_state` table
- New rdv CLI commands: `rdv channel list`, `rdv channel create`, `rdv channel send`, `rdv channel messages`
- New MCP tools: `list_channels`, `create_channel`, `send_to_channel`, `read_channel`
- Permanent message persistence (removed 24h TTL)
- Channel migration script: `bun run db:migrate-channels`
- **RDV skill documentation**: Comprehensive rewrite of `skills/rdv/SKILL.md` covering all CLI commands — teams orchestration, terminal I/O (`send`, `screen`), session UI (`set-status`, `set-progress`, `log`), system management, and tmux compatibility layer. Organized into 13 categories with practical workflow examples.
- **Auto-inject RDV context into agent profiles**: All agent config files (CLAUDE.md, AGENTS.md, GEMINI.md, OPENCODE.md) now include an RDV quick-reference section with environment variables, a 16-command reference table, and a pointer to `rdv --help`. Agents spawned by Remote Dev immediately know about rdv capabilities without manual setup or plugin installation.
- **Intelligent agent session titles**: Agent sessions are now auto-titled with a 2-3 word summary derived from the first user message in the Claude Code `.jsonl` session file. Titles are applied once via `rdv` hooks and broadcast to all connected clients in real-time. Manual rename locks the title. The stable Claude session UUID is stored in `typeMetadata` and surfaced in peer discovery for richer agent-to-agent context.
- **Agent peer communication**: Folder-scoped inter-agent messaging via MCP server (`rdv-peers`). Agents in the same project folder can discover each other (`list_peers`), exchange messages (`send_message`/`check_messages`), and share work summaries (`set_summary`). Auto-registered in each agent's settings.json at session creation. Messages delivered via PreToolUse hook. Also available via `rdv peer` CLI for non-MCP agents.
- **Peer chat room UI**: Visual chat room interface for viewing and participating in inter-agent communication. Features a `FolderTabBar` with Terminal/Chat Room toggle and per-agent session tabs with activity status dots (running/waiting/compacting/error/idle). User can broadcast messages to all agents. Real-time message delivery via WebSocket with optimistic updates. Unread badge on Chat Room tab. Auto-scrolling message list with scroll-to-bottom button.
- **SessionEnd hook**: Agent sessions now install a `SessionEnd` hook that reports "ended" status when the session closes, enabling learning analysis triggers
- **Mobile toolbar backspace button**: ⌫ (DEL) button in both Keys and Nav toolbar modes for deleting characters in the terminal. Supports ALT+⌫ for delete-word.
- **Mobile type/send mode toggle**: Long-press the send button to switch between Send mode (text + `\r`) and Type mode (text only, no `\r`). Enables building up terminal input piece by piece before executing.
- **Auto-refresh expired CF tokens**: When the Cloudflare Access token expires, the mobile app automatically opens the browser for re-authentication and retries the failed request, instead of silently showing empty sessions.
- **Mobile scroll-to-bottom button**: Floating "Latest" pill button appears when the terminal is scrolled up into history on mobile. Tapping it scrolls back to the latest output.
- **`rdv session title` command**: Agents can set meaningful kebab-case session titles (3-5 words) for peer identification via `rdv session title <kebab-title>`
- **Auto-broadcast on git push**: Pushing to main/master automatically broadcasts a rebase alert to the peer chatroom so other agents know to pull latest changes
- **Auto-broadcast on session lifecycle**: Session start and stop events are automatically broadcast to the peer chatroom for situational awareness
- **Session title history**: Title changes are tracked in `typeMetadata` for context when titles are updated

### Changed

- `rdv agent start` now accepts `--project-id`; the old `--folder-id` alias stays until Phase 6.
- `rdv context` reports `projectId`/`projectName`/`groupId`/`groupName` alongside legacy `folderId`/`folderName` for the transition window.
- `rdv` hook, peer, and channel commands now include `projectId` in payloads (read from `RDV_PROJECT_ID` env or the session's project) while continuing to send `folderId` for server-side compatibility.
- **MCP server renamed from `rdv-peers` to `rdv` (v2.0.0)**: Slimmed tool set from 8 to 3 response-only tools (`send_message`, `send_to_channel`, `set_summary`). Read operations moved to rdv CLI. Stale `rdv-peers` entries auto-cleaned from settings.json and .mcp.json.
- **Real-time MCP push notifications**: Agents receive peer messages, channel messages, and @mentions instantly via Unix socket push from the terminal server, relayed through `sendLoggingMessage()`. PreToolUse hook remains as reliable fallback with dedup via sentinel file.
- Peer messages now scoped to channels (existing messages migrated to #general)
- Right sidebar dynamically swaps between task tracker and channel list based on active view
- Agent session auto-titles now use kebab-case format (e.g., "fix-login-bug" instead of "fix login bug")
- Auto-title stop-word stripping produces more meaningful titles (e.g., "fix-login-bug" instead of "fix-the-login")
- PreToolUse hook now shows full peer status digest (agent names, activity status, work summaries) alongside new messages
- Stop hook now clears peer summary and broadcasts "finished work" to peer chatroom

### Deprecated

- `rdv folder` prints a deprecation warning on every invocation. The alias will be removed in Phase 6 once all callers migrate to `rdv project` / `rdv group`.

### Fixed

- **Race hardening on `updateSession({ typeMetadataPatch })`**: `SessionContext` now serializes PATCH writes per session id via a single-flight promise chain, so rapid consecutive calls (e.g. the Issues plugin persisting `selectedIssueNumber` while the user clicks fast between issues) land on the server in call order. Optimistic local merges still run synchronously for responsive UI; stale server-response reconciliations are skipped when a newer patch is still queued.
- Terminal rows no longer shrink by a few lines after a browser window resize. The resize path now waits for layout to settle and re-fits across reflow (scrollbar/atlas), matching the robustness of the initial-spawn path.
- **Mobile terminal scrollback**: Fixed touch scrollback by using `terminal.scrollLines()` API instead of direct `scrollTop` manipulation, which xterm.js v6's internal VS Code ScrollableElement silently overwrites. Added pixel-to-line delta accumulation, `touchcancel` handling, and improved momentum physics.
- **Mobile terminal CSS touch handling**: Added `touch-action: none` and `overscroll-behavior: contain` to xterm viewport and container to prevent browser interference (pull-to-refresh, rubber-band bounce) with terminal scrolling
- **Multi-client session support**: Web and mobile can now connect to the same terminal session simultaneously without triggering a reconnection loop. Each client gets its own PTY attached to the same tmux session. Newest connection controls terminal resize.
- **Stop hook silent failure on DB error**: `/internal/agent-stop-check` now returns a descriptive error message when the task database is unavailable, instead of silently allowing the agent to stop without checking tasks
- **Internal endpoint security**: Consolidated all `/internal/*` endpoint localhost restrictions into a single guard, covering previously unprotected `/agent-status`, `/agent-exit`, and `/notify` endpoints
- **Stop hook retry on network failure**: `rdv hook stop` now retries the task check once after 500ms on connection-level errors (refused, reset, timeout) before falling back to the error message
- **Hook validation visibility**: When agent hook validation fails and auto-repair also fails, a user-visible notification is now created instead of only logging server-side
- **Hook marker matching specificity**: Hook deduplication now inspects only the `command` field of hook entries, preventing false matches on user hooks that contain marker substrings in descriptions
- **stableId hash collisions**: Replaced 32-bit djb2 hash with dual-pass FNV-1a/Murmur (~52-bit) for task dedup keys, reducing collision risk for similar task subjects
- **Plugin hook naming**: Renamed misleading `session-start` PreToolUse hook command to `active` (same handler, clearer intent)
- **App-level error and 404 pages**: Added `error.tsx` and `not-found.tsx` with Tokyo Night glassmorphism styling, replacing raw Next.js error pages
- **Login page metadata**: Added page title and description via login layout for SEO and browser tab clarity
- **Stale APK download URL**: Changed hardcoded v0.3.0 APK link to version-independent releases page
- **Login error accessibility**: Added `role="alert"` to login error message for screen reader announcement
- **Server-side logger compliance**: Replaced `console.error/warn` with structured logger in `preferences.ts` and `environment.ts`
- **Port registry uniqueness**: Added unique index on `(userId, port, variableName)` to prevent duplicate port registrations
- **Tmux session name validation**: Tightened terminal server validation from permissive alphanumeric pattern to strict `rdv-{uuid}` format matching the domain layer
- **Schedule state sync after execution**: Schedules no longer show "Overdue" after firing — `executeNow()` now refreshes client state immediately
- **Auth timeout detection**: Expired sessions redirect to login instead of showing a blank/frozen page. All API calls in SessionContext detect 401 responses and redirect automatically. SessionProvider revalidates every 5 minutes and on tab focus.

## [0.3.6] - 2026-03-22

### Added

- **Mobile voice dictation**: Native text input bar in the Flutter app replaces xterm.dart's internal keyboard handler, enabling Android/iOS voice dictation, autocorrect, and predictive text. Autocorrect is enabled only for agent sessions (disabled for shell to preserve command case sensitivity)
- **Long-press send to type without executing**: Long-press the send button in both Flutter and PWA mobile input bars to insert text into the terminal without appending `\r`, enabling tab-completion workflows (type partial command, long-press, then TAB to autocomplete)
- **"ended" agent activity status**: Sessions whose Claude Code session ends now show "ended" status instead of falling through to "idle". Supported across web sidebar, loop status bar, mobile home screen, and browser notifications
- **Mobile session close**: Swipe-to-close gesture on session tiles in the Flutter drawer sidebar, matching the web app's swipe-to-close pattern. Agent exit overlay "Close" button now actually closes the session server-side (kills tmux) instead of just navigating away
- **Git credential suppression**: Automatically configure `gh` as the git credential helper in all terminal sessions, preventing macOS Keychain GUI prompts when agents run `git push/pull/fetch`. Profile sessions get `[credential]` in their `.gitconfig`; non-profile sessions get a session-scoped gitconfig with cleanup on close
- **Folder git identity override**: Per-folder pseudonymous git name/email in folder preferences, injected as `GIT_AUTHOR_NAME/EMAIL` and `GIT_COMMITTER_NAME/EMAIL` into session environment. Identity inherits child-first through folder hierarchy
- **Sensitive folder protection**: Mark folders as "sensitive" to require pseudonymous identity for commits and pushes. `isSensitive` flag propagates from any ancestor folder. Git guard API (`POST /api/folders/[id]/git-guard`) evaluates identity risk with `none/warn/block` levels
- **Git identity guard hook**: rdv CLI `PreToolUse` hook intercepts `git commit` and `git push` Bash commands, calls the git-guard API, and blocks tool use (exit 2) when identity would leak in a sensitive folder
- **Profile gitconfig migration**: `bun run db:migrate-profile-gitconfigs` adds `[credential]` section to existing profile `.gitconfig` files with idempotency checks
- **Two-mode mobile keyboard**: Switchable Keys/Nav modes in the mobile terminal toolbar — Keys mode has ESC, TAB, ^C, ^D, CTRL/ALT/SHIFT sticky modifiers; Nav mode has arrow keys, HOME/END, PGUP/PGDN, ENTER, SHIFT+ENTER
- **Sticky modifier keys**: CTRL/ALT/SHIFT toggles in the toolbar intercept the next keystroke typed in the text input, enabling Ctrl+C, Alt+key, and other combos on mobile
- **`useMobileModifiers` hook**: Shared modifier state between MobileKeyboard and MobileInputBar with IME composition guard and double-consumption protection
- **Light mode app icon**: New `icon-light.svg` variant for light mode contexts
- **Mobile folder filtering**: FolderTree integrated into the Flutter app's session drawer with collapsible hierarchy, session counts, and descendant folder filtering
- **Mobile image upload**: Camera/gallery button in keyboard toolbar uploads images via `image_picker` and pastes the server path into the terminal
- **Enriched session tiles**: Mobile drawer session tiles now show project path, git branch, agent provider, activity status colors, and suspended indicator
- **Folder subtree helper**: `Folder.subtreeIds()` static method for reusable folder hierarchy traversal

### Fixed

- **False agent exit detection on reconnect**: Race condition where old PTY async `onExit` handlers could fire after WebSocket reconnection, destroying the new session and showing a false "Agent completed" exit screen. Added PTY/WS identity guards and proper pre-cleanup on reconnect
- **Stale error status after session resume**: Resuming a suspended agent/loop session now resets `agentExitState`, `agentExitCode`, and `agentActivityStatus` so stale error indicators don't persist
- **Mobile session selection deadlock**: Tapping a session in the Flutter app drawer now correctly loads the terminal instead of showing "No active session"
- **Mobile sticky keys in NAV mode**: CTRL/ALT/SHIFT modifiers and ESC/^C/^D quick keys now appear in both keyboard modes, fixing sticky modifiers being inaccessible in NAV mode
- **Mobile nav button alignment**: Reorganize nav mode arrow keys into a d-pad cluster (↑ centered above ← ↓ →) with pure CSS flex layout, separate from other navigation keys
- **Mobile drawer close**: Replace `Navigator.maybePop()` with `closeDrawer()` for reliable drawer dismissal inside GoRouter ShellRoute
- **Mobile nested Scaffold**: Remove inner Scaffold/AppBar from TerminalScreen to fix double safe-area insets and status pill overlap
- **Mobile back navigation**: Add PopScope to clear active session on hardware back button / swipe-back
- **Mobile WebSocket lifecycle**: Add `_disposed` guard to prevent post-dispose crashes in `_doConnect`, `_onMessage`, `_onError`, `_onDone`, and `_scheduleReconnect`
- **Mobile terminal focus**: Add explicit FocusNode management to prevent keyboard dismiss when tapping toolbar keys
- **Mobile modifier state**: Clear modifiers on mode switch and app background to prevent stuck state
- **Folder session count reactivity**: Pass watched provider values as parameters instead of calling `ref.watch` inside helper methods
- **Folder filter descendants**: `filteredSessionsProvider` now includes sessions from child folders, matching the count badges in FolderTree
- **App icon corner artifacts**: Fix title bar bleeding into border stroke by using clipPath inset by stroke half-width instead of overlapping rounded rects
- **App icon consistency**: Regenerate all icon formats (PWA, favicon, electron) from corrected source SVG
- **Mobile IME composition**: Use `nativeEvent.isComposing` instead of synthetic event property for reliable CJK input on mobile browsers
- **Empty input submit**: Send button now works without text, sending bare `\r` to confirm terminal prompts
- **Ctrl+non-alpha keys**: CTRL modifier now correctly handles Ctrl+[ (ESC), Ctrl+\ (SIGQUIT), and other non-letter control codes
- **Mobile terminal screen**: Use server-scoped storage providers (`activeServerConfigProvider`, `serverScopedStorageProvider`) instead of legacy flat-key providers for multi-server compatibility
- **Mobile add server**: Omit port from server URL for Cloudflare Access and standard ports (443/80), preventing connection failures behind CF proxy
- **Mobile add server**: Store credentials before persisting server config in manual setup flow, preventing orphaned configs if credential storage fails

### Removed

- **Dead mobile code**: Delete orphaned `HomeScreen`, `AdaptiveScaffold`, `SessionSidebar`, `SessionListScreen`, and `_QuickActionsPanel` (~660 lines)

## [0.3.5] - 2026-03-21

### Added

- **Mobile app multi-server support**: Save and switch between multiple remote-dev server instances with per-server credential isolation via `ServerScopedStorage`
- **QR code server onboarding**: Scan a QR code from the web dashboard for zero-typing server setup using `mobile_scanner`
- **Edge drawer navigation**: Swipe from left edge for instant session switching (1 gesture vs 2-3 taps), with floating status pill and quick actions panel
- **Glassmorphism UI**: `GlassmorphicContainer` widget with frosted glass `BackdropFilter` surfaces on drawer, bottom sheets, and dialogs
- **Smart input widgets**: Port stepper `[-][6001][+]`, protocol dropdown (http/https), host input with recent history autocomplete
- **Credential auto-migration**: Existing single-server credentials automatically migrated to multi-server format on first launch

### Changed

- **Mobile terminal rendering**: Replaced ANSI-to-HTML renderer (`MobileTerminalView`) with xterm.js + native input overlay. xterm.js handles all rendering (colors, cursor, tmux, scrollback) while `MobileInputBar` provides native text input with autocorrect, voice dictation, and predictive text. Special keys toolbar (ESC, TAB, CTRL, arrows) renders below the input bar.
- **GoRouter**: Migrated to `ShellRoute` with `refreshListenable` for stable navigation (no more router recreation on state changes)
- **Theme**: Transparent drawer/dialog/sheet backgrounds for glassmorphism, replaced manual color mixing with `Color.lerp`

## [0.3.1] - 2026-03-21

### Added

- **Loop agent session type**: Chat-first, mobile-first UI for long-running AI agent sessions with loop scheduling
  - New `"loop"` terminal type plugin with conversational and monitoring modes
  - Stream-JSON output parsing for Claude Code (`--output-format stream-json`) with ANSI text fallback
  - `useLoopScheduler` hook for interval-based prompt re-fire in monitoring mode
  - Chat components: `LoopChatPane`, `LoopMessageBubble`, `LoopChatInput`, `LoopStatusBar`
  - `TerminalDrawer` for toggling raw terminal view (full-screen mobile, resizable desktop)
  - Session wizard integration with loop config form (type, interval, prompt, agent, profile)
  - Sidebar `MessageCircle` icon with activity status indicators
  - 2000-message cap prevents unbounded memory growth in long-running sessions
- **FCM push notifications for mobile app**: End-to-end push notification delivery from agent hooks to the Flutter mobile app via Firebase Cloud Messaging
  - Server: `PushNotificationGateway` port + `FcmPushGateway` (FCM HTTP v1 API) with `NullPushGateway` graceful degradation
  - New `push_token` DB table and `DrizzlePushTokenRepository` for device token storage
  - `POST/DELETE /api/notifications/push-token` endpoints for token registration
  - Push dispatch integrated into `NotificationService.createNotification()` (fire-and-forget)
  - Cross-channel notification sync: `/internal/notification-dismissed` WebSocket broadcast
  - Flutter: `PushNotificationService` with FCM lifecycle, token refresh, and deep link to session on tap
  - Android notification channel via `AndroidManifest.xml` metadata
- **Mobile-optimized terminal with native text input**: On mobile devices, replaces xterm.js canvas with a native text input bar and ANSI-to-HTML output panel
  - `MobileTerminalView`: scrollable output panel with theme-aware ANSI color rendering
  - `MobileInputBar`: native `<textarea>` with autocorrect, predictive text, and voice dictation
  - `useTerminalWebSocket`: shared WebSocket hook with auth, reconnect, and message dispatch
  - All session types (shell, agent) get native text input on mobile; desktop path unchanged
- **Mobile worktree creation**: Create git worktrees from the Flutter mobile app's session creation sheet
  - Worktree type picker (feature/fix/chore/refactor/docs/release)
  - Branch name auto-suggestion from session name
  - Async base branch picker fetched from server
  - New Clean Architecture ports: GitGateway, FolderPreferencesGateway

### Fixed

- **Android notification icon**: Added monochrome `ic_notification` drawable so push notifications show the `>_` prompt silhouette instead of a white square
- **App icon redesign**: Replaced plain `>_` square icon with the full terminal window design matching `favicon.svg` (rounded corners, title bar with traffic lights, output lines)
- **Android adaptive icon**: Added `ic_launcher_foreground` and adaptive icon XML so the launcher applies proper rounded/squircle masking
- **PWA icons**: Regenerated all PWA icon sizes with the updated terminal window design

## [0.3.0] - 2026-03-20

### Added

- **Flutter mobile app foundation**: Native Android/iOS terminal client using Flutter + xterm.dart with Clean Architecture
  - 4-layer architecture: Domain, Application, Infrastructure, Presentation
  - WebSocket terminal protocol with typed Dart sealed classes, exponential backoff reconnection, and token refresh
  - OKLCH color conversion ported from TypeScript for full theme parity (12 color schemes)
  - 22 Nerd Fonts bundled as TTF assets for terminal rendering
  - CF Access + API key dual authentication flow
  - Adaptive phone/tablet layout with split pane support
  - Mobile keyboard toolbar (ESC, CTRL, ALT, TAB, arrows, symbols)
- **Poll-based auto-update system**: Multi-server deployment support replacing GitHub webhook dependency
  - Each server independently polls GitHub Releases for pre-built artifacts
  - AutoUpdateOrchestrator coordinates lifecycle: detect → schedule → drain → apply → restart
  - Graceful session draining with configurable timeout (broadcasts `update_pending` to connected clients)
  - Durable deployment state persisted to SQLite, recovers pending timers on restart
  - New domain objects: `DeploymentStage`, `UpdatePolicy`, `UpdateDeployment` entity
  - New use cases: `ScheduleAutoUpdateUseCase`, `DrainSessionsUseCase`
  - New API actions: `POST /api/system/update { action: "cancel" }` to cancel pending updates
  - `GET /api/system/update` now includes deployment lifecycle stage info
  - Configurable via `AUTO_UPDATE_ENABLED`, `AUTO_UPDATE_DELAY_MINUTES`, `AUTO_UPDATE_DRAIN_TIMEOUT_SECONDS`

### Deprecated

- **Webhook deploy endpoint**: `POST /api/deploy` returns 410 when `AUTO_UPDATE_ENABLED=true`, guiding migration to poll-based updates
- **Worktree cleanup**: New `rdv worktree cleanup` command for agents to trigger full worktree lifecycle cleanup from inside a worktree
  - Merge verification: requires branch is merged into main/master before removal (use `--force` to skip)
  - Removes worktree directory via server-side git commands (solves the CWD-inside-worktree problem)
  - Deletes local and remote branches after merge verification
  - Closes the session automatically
- **Worktree service functions**: `getDefaultBranch()`, `isBranchMerged()`, `deleteBranch()`, `cleanupWorktree()` for reusable git branch lifecycle operations
- **Session cleanup mode**: `DELETE /api/sessions/:id?cleanup=true&force=false` for full worktree cleanup via API

### Fixed

- **rdv worktree remove**: Fixed broken field names (`repoPath`/`branch` → `projectPath`/`worktreePath`) that caused 400 errors when calling the API
- **Structured Logging System**: Complete logging overhaul replacing all `console.*` calls with structured, leveled logging
  - 5 log levels: error, warn, info, debug, trace (controlled via `LOG_LEVEL` env var)
  - Separate SQLite database at `~/.remote-dev/logs/logs.db` for log persistence
  - Clean architecture: `LogLevel` value object, `LogRepository` port, `BetterSqliteLogRepository`, `QueryLogsUseCase`, `PruneLogsUseCase`
  - `createLogger(namespace)` factory for namespaced loggers with structured data support
  - Both Next.js and terminal server write to the same log database via WAL mode
  - 7-day automatic log retention
- **Log Viewer UI**: New "Logs" tab in Settings modal
  - Filter by level, source (Next.js/terminal), namespace, and free-text search
  - Auto-refresh mode (3s polling) for live log monitoring
  - Expandable JSON data viewer for structured log data
  - Pagination with "Load more" for historical browsing
  - Clear all logs with confirmation dialog
  - Color-coded level badges and source indicators
- **API endpoints**: `GET /api/system/logs` (query with filters), `DELETE /api/system/logs` (clear), `GET /api/system/logs/namespaces` (distinct namespaces)
- **CLAUDE.md**: Added logging as a non-negotiable convention

### Changed

- Consolidated all lifecycle hook commands under `rdv hook` namespace (`pre-tool-use`, `post-tool-use`, `pre-compact`, `notification`, `validate`)
- Updated `ClaudeCodeHooks` type to include all hook event types (PreCompact, Notification, Stop, SessionStart, SessionEnd)
- Hook editor UI now supports all Claude Code hook types
- **Full console.* migration**: All ~236 `console.log/error/warn` calls across 76 server-side files migrated to structured logger with appropriate levels and namespaces
  - Noisy connection lifecycle logs downgraded from stdout to `debug` level
  - Plugin init/registration messages corrected from `console.error` to `log.info`/`log.debug`
  - Error objects consistently passed as structured data instead of string interpolation

### Fixed

- **Task list stale after sleep/tab switch**: Task list now automatically refreshes when the page regains visibility (e.g. returning from sleep, switching tabs) instead of requiring a manual reload. Also added fetch cancellation via AbortController to prevent race conditions from concurrent refreshes.
- **Task session scoping**: Tasks sidebar now shows only the active session's tasks instead of all folder tasks, matching the schedule scoping pattern. New tasks and linked GitHub issues are automatically associated with the active session.
- **Schedule session scoping**: Schedules sidebar now shows only the active session's schedules instead of all schedules, and schedule creation auto-detects the active session instead of showing a session picker

### Added

- `rdv hook validate` command for checking hook server connectivity
- Automatic hook validation on agent session creation with auto-repair
- Hook deduplication now detects both wrapped and direct `rdv hook` commands

### Fixed
- Hooks no longer reference nonexistent rdv subcommands (consolidated under `rdv hook` namespace)

- **Background Service Installation**: Production service management via systemd (Linux) and launchd (macOS)
  - `scripts/install-service.sh` installs and enables user-level service units
  - `scripts/uninstall-service.sh` stops and removes service units
  - systemd: two-unit design (Next.js + terminal server) with `PartOf=` lifecycle binding
  - launchd: two plist agents with `KeepAlive` and stdout/stderr logging
  - Service config templates in `scripts/service-config/` with placeholder substitution
- **Self-Update Mechanism**: Check for and apply updates from GitHub Releases
  - `CheckForUpdatesUseCase`: polls GitHub API with 1-hour cache, compares semver versions
  - `ApplyUpdateUseCase`: downloads tarball, verifies SHA-256 checksum, extracts to versioned directory, atomically switches `current` symlink, and triggers service restart
  - `TarballInstallerImpl`: atomic release installation with staging directory, old release cleanup (keeps last 3)
  - `GitHubReleaseGateway`: unauthenticated GitHub API client for release metadata and checksum fetching
  - `UpdateScheduler`: configurable periodic update checks (default 6 hours)
  - `ServiceRestarterImpl`: PID-based service restart via `kill -USR2` or process re-exec
  - Settings UI: System > Updates page showing current version, update state, and manual check/apply controls
  - API endpoints: `GET/POST /api/system/update` with `withApiAuth` for CLI and UI access
  - `rdv system update [check|apply]`: CLI commands for update management
- **CI/CD Release Pipeline**: GitHub Actions workflow for building platform release tarballs
  - Matrix builds for linux-x64, linux-arm64 (native runner), darwin-x64, darwin-arm64
  - Produces `remote-dev-{version}-{platform}.tar.gz` with SHA-256 checksums
  - Triggered on version tags (`v*`)
  - `scripts/pack-release.sh`: builds Next.js, terminal server, and Rust CLI, then packages into distributable tarball
- **rdv Hook Commands**: `rdv hook stop|notify|session-end` for Claude Code lifecycle hook integration (stop reporting, lifecycle notifications, session-end handling).
- **POST /api/notifications**: New endpoint to create notifications programmatically via API.
- **Local CLI Credentials**: Auto-provisioned API key at `~/.remote-dev/rdv/.local-key` so `rdv` CLI authenticates without manual `RDV_API_KEY` setup. Key is created at server startup with 0600 permissions.
- **rdv Dual-Server Routing**: CLI now routes `/api/*` to Next.js and `/internal/*` to the terminal server, with Unix socket and TCP support for both.
- **rdv Browser Commands**: `rdv browser navigate|screenshot|snapshot|click|type|evaluate|back|forward` for headless browser automation.
- **rdv Notification Commands**: `rdv notification list|read|delete` for notification management.
- **rdv Session Commands**: `rdv session children|spawn|git-status` for child session management and git status.
- **Schedule Sidebar**: Moved schedule management from standalone modal to the right sidebar under GitHub issues, with inline enable/disable toggles, run-now buttons, and delete confirmation.
- **Schedule Session Picker**: `CreateScheduleModal` now includes a session dropdown for creating schedules from the sidebar without a pre-selected session.

### Changed

- **Schedule Management Location**: Schedule viewing and creation moved from left sidebar footer button + `SchedulesModal` to the right `TaskSidebar`.

### Removed

- **SchedulesModal**: Removed standalone schedule management modal (replaced by right sidebar section).
- **Schedules Footer Button**: Removed "Schedules" button from the left sidebar footer.

### Fixed

- **Port fallback**: Agent sessions now correctly fall back to terminal port 6002 (was 3001).
- **API key cleanup**: Agent-session API keys are revoked on session close and deduplicated on create/resume, preventing unbounded accumulation.
- **Static imports**: Replaced unnecessary dynamic imports in session-service with static imports.

- **Toast Notifications**: Real-time toast notifications for agent events (waiting, error, complete, exited) via sonner, positioned bottom-center with glassmorphism styling. Toasts are clickable to jump directly to the related session.
- **Clear Notifications**: Per-item dismiss (X button on hover) and "Clear all" button in notification panel header. Hard deletes notifications from the database.
- **Notification Panel Glassmorphism**: Upgraded notification panel to frosted glass style (`bg-popover/95 backdrop-blur-xl`) matching the rest of the app's modal/panel aesthetic.
- **Enhanced agent task sync**: Full Task system support capturing all TaskCreate/TaskUpdate fields (metadata, description, dependencies, owner, priority) with stable `agentTaskKey` dedup
- **Task dependencies**: `task_dependency` junction table for blockedBy relationships between tasks
- **TaskEditor**: Inline expandable task editor with subtasks, dependencies, metadata, and instructions editing
- **Internal task endpoints**: POST/PATCH endpoints on terminal server for rdv CLI task creation and updates
- **Bulk task archival**: `cancelOpenAgentTasks` for efficient session close cleanup
- **Clear all tasks**: Bulk delete tasks from the right sidebar with "Clear completed" and "Clear all" options, available for both Tasks and Agent Tasks sections
- **rdv CLI (Rust)**: New CLI at `crates/rdv/` for agent interaction with the terminal server
  - Commands: session, worktree, agent, task, folder, status, context
  - Auto-discovery via `RDV_SESSION_ID`, `RDV_TERMINAL_SOCKET`, `RDV_TERMINAL_PORT` env vars
  - JSON output by default, `--human` flag for table output
  - Auto-installed on server startup if cargo is available

- **Claude Code Plugin**: Plugin structure for marketplace distribution
  - `skills/rdv/SKILL.md` — teaches agents to use rdv CLI
  - `commands/rdv-status.md` — /rdv-status slash command
  - `agents/rdv-orchestrator.md` — multi-agent orchestrator subagent
  - `hooks/hooks.json` — hook config for agent status/task sync

- **Stop hook checks all tasks**: Stop hook now checks both agent-created and user-assigned tasks for a session, with source labels in output

- **Mobile Header**: Compact header bar on mobile/PWA with GitHub status, secrets, appearance toggle, tasks, user menu, and sign-out
- **Sidebar Worktree Shortcut**: "New Worktree" option in the sidebar + dropdown menu (enabled when active folder has a linked repository)

### Changed

- **Stop hook TaskCreate instructions**: Stop hook now returns structured instructions telling the agent to use TaskCreate for each incomplete task (manual, agent-owned, post-tasks), replacing the plain text listing
- **Agent hooks use rdv CLI**: Hooks now prefer `rdv` CLI commands over curl, with automatic curl fallback when rdv is not installed

### Removed

- **MCP server backend**: Removed `src/mcp/` directory (18 files), MCP registration code from agent-profile-service, and `bun run mcp` script. Agents now use rdv CLI instead of MCP protocol. UI components that display MCP servers are retained.

### Security

- **Browser API session ownership**: All 8 browser API routes (`back`, `click`, `evaluate`, `forward`, `navigate`, `screenshot`, `snapshot`, `type`) now verify session ownership before allowing operations
- **Browser frame localhost restriction**: `/internal/browser-frame` endpoint restricted to localhost callers only
- **Invalid URL rejection**: `createBrowserSession` now throws on invalid URLs instead of silently creating `about:blank` sessions
- **URL param encoding**: rdv CLI now uses proper query parameter encoding via `post_empty_with_query` instead of string interpolation

### Fixed

- **Notification limit validation**: `limit` query param on notifications API now validates for NaN and clamps to [1, 200]
- **React concurrent-mode safety**: `markReadRef.current` assignment moved to `useEffect` to avoid ref mutation during render
- **Shared markdown components**: `IssueDetailPanel` now uses shared `MARKDOWN_COMPONENTS` module, fixing visual inconsistency with PR detail views
- **TaskSidebar dead code**: Removed unused `hydrated` state variable
- **rdv CLI output**: Fixed `print!` to `println!` for consistent terminal output termination
- **Mobile Long-Press Glitch**: Disabled folder touch-drag handlers on mobile to prevent orphaned clone elements when context menu intercepts touch events
- **Drag Clone Cleanup**: Added unmount cleanup for drag clones to prevent visual artifacts persisting after navigation

- **Agent Status Notifications**: Browser notifications when AI agent sessions change state (idle, waiting for input, error, compacting context)
  - Click notification to focus window and switch to the relevant session
  - Notifications only fire when the browser window is not focused
  - Configurable via "Agent notifications" toggle in User Settings > Project tab
  - Browser notification permission requested on first enable
  - Extracted shared `useNotificationPermission` hook with `useSyncExternalStore` for consistent permission state across components

- **Mobile Screenshot Upload**: Camera button in the mobile quick-key toolbar allows uploading screenshots/images from camera roll or camera, equivalent to desktop drag-and-drop

- **Issue-to-Worktree Flow**: Click a GitHub issue to view details and start working with one click
  - Issue detail panel with markdown body rendering, metadata, labels, and suggested branch name
  - "Start Working" button creates a git worktree and launches an agent session with issue context as prompt
  - Auto-detects branch type (fix/feature/docs/chore) from issue labels
  - Branch naming follows `{type}/issue-{number}-{description}` pattern

- **Issue Comments**: Fetch and display issue comments in the detail panel via GitHub API

- **Folder Default Agent Preference**: Set a default AI agent provider per folder in Folder Preferences
  - New `default_agent_provider` column on `folder_preferences` table
  - Inherits through folder hierarchy like other preferences
  - Used automatically when creating agent sessions from issues

- **Issue Detail UX**: Loading state on Start Working button; Escape key navigates back to issue list

- **Issue/PR Icon Differentiation**: Issues and pull requests now display distinct icons (CircleDot/CircleCheck for issues, GitPullRequest/GitMerge for PRs) across all views
- **`isPullRequest` Field**: Added `is_pull_request` column to `githubIssues` table to distinguish PRs from issues fetched via the GitHub API

### Changed

- **Mobile Sidebar UX**: Sidebar now uses inline push layout instead of floating overlay
  - Sidebar stays open when selecting a session, allowing free browsing
  - Sidebar pushes terminal content over instead of overlaying with backdrop
  - Session row styling matches desktop (transparent backgrounds for unselected items)

### Fixed

- **Mobile Quick Key Detection**: Quick-key toolbar now uses touch/UA-based mobile detection (`useMobile()`) instead of CSS breakpoint (`md:hidden`), correctly appearing on touch devices like iPads regardless of viewport width
- **Worktree Icon Priority**: Fix missing worktree icon for agent+worktree sessions in expanded sidebar and tooltip by checking `worktreeBranch` before `terminalType`
- **Agent Hooks with HOME Override**: Fix agent activity hooks not firing when startup command overrides HOME (e.g., `jclaude` alias with `HOME=/Users/joyfulhouse`). Server now resolves the effective HOME from inline assignments and shell aliases, installing hooks at both the profile config dir and the agent's actual HOME.
- **Session Type Fixes**: Fix missing `worktreeType` and `agentActivityStatus` fields in server-side session mapping and API presenter
- **CodeMirror Deduplication**: Add overrides to resolve duplicate `@codemirror/language` versions causing build type errors
- **Agent Tasks Per Session**: Agent tasks in the Task Sidebar are now scoped to the active session instead of showing all agent tasks for the folder
  - Each agent session displays only its own tasks; manual tasks remain folder-scoped
  - Task count badge correctly excludes agent tasks from other sessions

### Added

- **Voice Mode**: Hold mic button to stream browser audio to Claude Code's built-in voice pipeline via FIFO-based sox shim, enabling voice input for remote agent sessions
- **Worktree Type Selection**: Allow selecting worktree type (feature/fix/chore/refactor/docs/release) when creating a Feature Session
  - Inline branch prefix dropdown replaces hardcoded `feature/` prefix
  - New `worktree_type` column on `terminal_session` persists the selected type
  - Backend and use case use dynamic prefix for branch name generation

- **Agent Task Sync**: Mirror Claude Code's task list into the Task Sidebar in real-time
  - PostToolUse hook on `TaskCreate|TaskUpdate|TodoWrite` syncs tasks to `project_task` table
  - Supports Claude Code v2.1.69+ individual TaskCreate/TaskUpdate calls and legacy TodoWrite batch format
  - Upsert semantics: existing tasks are updated when status/title changes
  - O(1) dedup via marker map instead of linear scans
  - WebSocket broadcast notifies all clients of task changes for live sidebar updates
  - Auto-archives open/in-progress agent tasks when session closes
  - New `sessionId` column on `project_task` links agent tasks to originating sessions

- **Rendered Markdown View**: Markdown files (.md/.mdx) now open in a rendered view by default with GitHub-style prose styling
  - Pencil/eye toggle in the toolbar switches between rendered and CodeMirror editor modes
  - Syntax highlighting for fenced code blocks using rehype-highlight
  - GFM support: tables, task lists, strikethrough, autolinks
  - XSS protection: allowlist-based URL sanitization blocks unsafe URI schemes

- **Resume Claude Session**: Discover and resume previous Claude Code conversations from the folder context menu
  - Scans `~/.claude/projects/<encoded-path>/` (or profile-isolated equivalent) for `.jsonl` session files
  - Modal shows recent sessions sorted by last activity with branch, timestamp, and first message preview
  - Resumes via `claude --resume <session-id>`, appended to the folder's configured startup command
  - New `GET /api/agent/claude-sessions` endpoint for session discovery
  - Configurable session limit (default 20, max 50)
- **Auto-register MCP server on agent creation**: Automatically configures the Remote Dev MCP server in agent config files (Claude, Gemini, Codex) during session creation and resume, giving agents immediate access to session management, git, and folder tools
- **Mobile PWA Optimization**: Automatic detection and optimization for mobile devices and installed PWA mode
  - `useMobile` hook: detects mobile devices via user-agent and touch capability (replaces viewport-based detection)
  - `usePWA` hook: detects standalone PWA display mode via `matchMedia("(display-mode: standalone)")` and `navigator.standalone`
  - Swipe-to-close on sidebar sessions: swipe left to reveal a close button (like iOS mail), preventing accidental taps
  - Hidden invisible close button on mobile — previously `opacity-0` but still tappable, causing accidental session closes
  - Safe-area inset CSS utilities for iPhone notch and home indicator support (`pt-safe-top`, `pb-safe-bottom`, `pl-safe-left`, `pr-safe-right`)
  - Safe-area padding applied to sidebar, mobile header bar, terminal container, and mobile keyboard toolbar
  - PWA-aware top padding when running as installed app without browser chrome
- **Multi-GitHub Account Support**: Link multiple GitHub accounts (personal, work, etc.) with per-folder binding
  - New "Accounts" tab in GitHub Maintenance modal to manage linked accounts (add, set default, unlink)
  - Per-folder GitHub account binding in folder preferences — sessions in a folder automatically get that account's credentials
  - Full `gh` CLI auth: each account gets an isolated `GH_CONFIG_DIR` with `hosts.yml` provisioned at link time
  - Environment injection pipeline: sessions receive `GH_TOKEN`, `GH_CONFIG_DIR`, and `GITHUB_USER` based on folder binding or default account
  - Explicit default account — user must designate one account as the default; first account linked is auto-default
  - Clean Architecture implementation: `GitHubAccount` domain entity, 6 use cases, repository port, gh CLI config gateway
  - New DB tables: `github_account_metadata`, `folder_github_account_link`
  - Migration script for existing users: `bun run db:migrate-github-accounts`
- **Files Section in Sidebar**: New collapsible "Files" section above MCP Servers showing default project files (.env, .env.local, CLAUDE.md, README.md) and pinned files
  - Automatically detects which default files exist on disk for the active folder's project directory
  - Pinned files moved from inline folder tree to this dedicated section, reducing clutter
  - Active file highlighting matches the current editor session
  - Pin icon indicator distinguishes user-pinned files from auto-discovered defaults
  - Collapsed sidebar shows file count badge
  - New `/api/files/exists` batch endpoint for lightweight file existence checks
- **Pin Session**: Pin sessions to the top of their folder via right-click context menu
  - Pinned sessions render above subfolders within their folder
  - Pinned root sessions appear above all folders in sidebar
  - Pin icon indicator shown on pinned sessions
  - Drag-and-drop constrained within same pin partition
- **Project Task Tracker Sidebar**: Collapsible right sidebar for project-scoped task management
  - Three sections: Manual Tasks, Agent Tasks, and GitHub Issues
  - Tasks support 4-level priority (Critical/High/Medium/Low), custom labels, subtasks, and due dates
  - Agent tasks created automatically via MCP tools or REST API (5 new MCP tools: task_list, task_create, task_update, task_complete, task_delete)
  - GitHub issues displayed from linked repos with "Link to task" action
  - Folder-scoped: tasks track with each project folder independently
  - Collapsible to 48px icon strip with open task count badge
  - Resizable via drag handle (240-500px)
  - Toggle via Cmd+. keyboard shortcut or header button
  - Consistent glassmorphism design with existing UI patterns
- **Agent Activity Status Indicators**: Real-time agent activity shown in sidebar via colored Sparkles icons
  - Green breathing animation when agent is running (tool use in progress)
  - Yellow breathing animation when agent is waiting for user input
  - Solid red when agent exited with error
  - Gray when idle or no recent activity
  - Uses Claude Code hooks (PreToolUse/Stop) to report status back to terminal server
  - Hooks are automatically installed and merged with existing settings at session creation
  - Status broadcast via WebSocket to all connected clients for cross-tab visibility

### Changed

- Pinned files now scoped to the active folder in the Files section (previously visible inline across all folders simultaneously)

### Removed

- **MarkdownEditor component**: Consolidated into CodeMirrorEditor with rendered markdown support
- Drag-to-reorder for pinned files in the sidebar (use folder settings to reorder)

### Fixed

- Worktree sessions now show GitBranch icon instead of generic terminal icon in sidebar

## [0.2.1] - 2026-02-10

### Added

- **MCP Tool Discovery for Agent Sessions**: Agents can now discover and use MCP tools within sessions
- **MCP Agent Sessions**: Profile management support for MCP-based agent sessions
- **Mobile Touch Scrolling**: Touch scrolling support for terminal on mobile devices
- **Pinned File Editor**: CodeMirror 6-powered file editor for pinned files
- **Terminal Type Plugin System**: Extensible plugin architecture for different session types
- **Separate Agent Creation**: Distinct New Terminal and New Agent session creation flows
- **Clean Architecture Tmux Environment & Profile Refactor**: Domain-driven tmux environment management and profile handling

### Changed

- Code simplification and linting fixes across the codebase
- Simplified codebase with extracted helpers and reduced duplication
- Session numbering now finds next available number instead of always incrementing
- Bot icon shown for agent sessions in sidebar

### Fixed

- Prevent rapid reconnection that can exhaust PTY resources
- Skip trashed sessions in status sync and improve auth resilience
- Pass terminalType correctly to API for agent sessions
- Address code review findings in PortMonitor and RestartAgentUseCase
- Prevent browser caching on GitHub API fetch requests
- Filter out framework internal env vars from child processes

## [0.2.0] - 2026-01-09

### Added

- **Clean Architecture**: Domain layer with entities, value objects, use cases, and repository pattern for better testability and maintainability
- **Multi-Agent CLI Support**: Unified management for Claude Code, OpenAI Codex, Gemini CLI, and OpenCode with:
  - CLI installation status detection and version checking
  - Per-agent configuration editors (CLAUDE.md, AGENTS.md, GEMINI.md, OPENCODE.md)
  - Profile isolation with separate directories per agent
  - Environment variable injection from secrets providers
- **Theme System**: Comprehensive appearance system with:
  - 8 color schemes (Tokyo Night, Dracula, Nord, Solarized Dark/Light, One Dark, GitHub Dark/Light)
  - Light/Dark/System mode toggle
  - Terminal theme integration with xterm.js
  - Per-profile appearance settings
  - Semantic colors for consistent UI
- **Profile Management**:
  - Quick-switch between profiles
  - Profile templates for reusable configurations
  - Export/import profiles for backup and sharing
  - Per-profile theming and appearance
- **GitHub Issues Viewer**: View and create issues directly from the sidebar
- **Enhanced GitHub Features**: Filtering, search, PR counts, and issue creation
- **Test Infrastructure**: Vitest setup with domain layer and use case tests
- **Tmux Session Management**: UI in settings modal to view and manage orphaned tmux sessions
- **GitHub Maintenance Modal**: Repository management with local repo operations
- **Init Script**: Guided setup experience (`./scripts/init.sh`)
- **Window Dragging**: Enable window dragging on sidebar and header empty areas for PWA
- **Long-press Delay**: Mobile-friendly folder drag with long-press activation
- **Roll-up Stats**: Collapsed folders show aggregated session counts
- **Active Schedules Counter**: Sidebar footer shows count of scheduled commands

### Changed

- Migrated to Clean Architecture pattern for session and folder management
- Terminal colors optimized for both light and dark themes
- Improved semantic color system throughout the UI
- Better mobile support with autocorrect/autocapitalize attributes

### Fixed

- Terminal theme manipulation now reliable for CLI colors
- Bright terminal colors readable in all light themes
- Content overflow in ProfilesModal
- Scrolling issues in ProfileConfigTab
- Glass opacity applied to terminal background correctly
- Database path handling for production mode

## [0.1.2] - 2025-12-26

### Added

- **Agent Profiles System**: Database schema and API for managing AI agent configurations
- **Profiles UI**: Full UI for creating, editing, and managing agent profiles
- **Port Manager Modal**: Framework detection and port conflict management
- **File Browser**: SSH key path selection with unsaved changes warnings
- **Active Schedules Counter**: Visual indicator in sidebar footer

### Changed

- Upgraded xterm.js to v6.0.0 with improved text selection
- Unified font sizes in profiles modal to text-xs

### Fixed

- Terminal copy (Cmd+C) now works correctly
- Mobile autocomplete duplication mitigated
- Text paste handler for complete clipboard support
- Folder ownership validation for profile-folder linking
- Input sanitization and validation for agent profiles (security)
- Environment variables now injected at session creation, not WebSocket connect
- FolderId passed correctly when creating session via keyboard shortcut

## [0.1.1] - 2025-12-25

### Added

- **MCP Server**: Model Context Protocol server for AI agent integration with 24 tools, 6 resources, and 5 workflow prompts
- **Secrets Management**: Phase provider integration for secure credential management
- **Electron Desktop App**: Infrastructure for desktop application (Phases 1-7)
- **Directory Browser**: Visual filesystem navigation for project folder selection
- **Repository Picker**: Enhanced with click-to-clone, filtering, and sorting
- **Sidebar Tree Lines**: Visual hierarchy indicators with .trash directory filtering
- **Date Time Picker**: Redesigned with MUI-style clock face and analog clock hands
- **Context Menus**: Repository and Secrets options in folder context menus
- **Scheduled Commands**: One-time scheduled command execution with UI prioritization

### Changed

- DateTimePicker redesigned with side-by-side layout and interactive controls
- Modal consistency improved with smaller fonts and transparent backgrounds
- Folder browser modal no longer flashes or resizes

### Fixed

- Secrets API response type and state synchronization
- MCP server issues from code review
- Favicon styling improvements
- Text search filter in repository picker

## [0.1.0] - 2025-12-22

### Added

- **Terminal Interface**: Web-based xterm.js terminal with WebSocket communication
- **Persistent Sessions**: tmux integration for sessions that survive disconnects
- **Session Management**: Create, suspend, resume, and close terminal sessions
- **Folder Organization**: Hierarchical folder structure for organizing sessions
- **GitHub Integration**: OAuth integration with repository browsing and cloning
- **Git Worktrees**: Branch isolation with automatic worktree management
- **Session Recording**: Record and playback terminal sessions
- **Session Templates**: Save and reuse session configurations
- **Split Panes**: Multiple terminals in a single view
- **PWA Support**: Installable progressive web app with mobile sidebar
- **Keyboard Shortcuts**: macOS-style navigation and editing shortcuts
- **Command Palette**: Quick access to commands with search
- **Git Branch Indicator**: Show current branch in session tabs
- **Nested Folders**: Deep folder hierarchy support
- **Drag and Drop**: Reorder sessions and move between folders
- **Image Paste**: Paste images directly into terminal
- **Nerd Fonts**: 22 self-hosted fonts in mobile-optimized WOFF2 format
- **Cloudflare Access**: JWT authentication for tunnel access
- **API Keys**: Programmatic access for agents and automation

### Security

- Credentials auth restricted to localhost only
- Input validation and sanitization throughout
- Shell command injection prevention with execFile

---

[0.2.1]: https://github.com/btli/remote-dev/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/btli/remote-dev/compare/v0.1.2...v0.2.0
[0.1.2]: https://github.com/btli/remote-dev/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/btli/remote-dev/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/btli/remote-dev/releases/tag/v0.1.0
