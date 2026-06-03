# Port Proxy for k3s Instances + Port-Management Completion

> **Status:** Plan — awaiting review (no code yet)
> **Date:** 2026-06-03
> **Related epic:** `remote-dev-jvcx` (k3s Supervisor platform) — this is a data-plane feature on top of it
> **Author:** Claude (feature-dev session)

## 1. Goal

Two related deliverables:

1. **Complete the half-built port-management subsystem** so it becomes a real
   discovery/control plane: which ports exist, which are listening, which session
   owns them — per instance.
2. **Add HTTP+WebSocket port proxying** so a user can visit
   `https://rdv.joyful.house/dev/proxy/6000/…` (slug `dev`, port `6000`) and be
   served whatever is listening on port `6000` inside that instance's pod.

The control plane feeds the data plane: detected/claimed ports drive an **"Open"**
action that points the browser at the proxy URL, and define the proxyable-port
allowlist.

## 2. Decisions (locked)

| Decision | Choice | Rationale |
|---|---|---|
| URL scheme | **Path-based** `/<slug>/proxy/<port>/…` | Matches the requested URL; no wildcard DNS/TLS/CF-Access work. (Subdomain is the robust long-term upgrade — see §8.) |
| Where the proxy runs | **Hybrid in-pod** | HTTP via the instance app → `127.0.0.1:port`; WS via one router rule + an in-pod terminal-server bridge. |
| Port-management scope | **Full completion** | Wire up `PortMonitor`, runtime claims, live status, interactive UI, mobile screen. |
| Access control | **Allowlist + owner-scoped** | Block `6001/6002`/privileged; proxyable = listening ∪ claimed; owner-scope via the instance's existing auth. |
| Protocol | **HTTP + WebSocket** | Dev-server HMR/live-reload works. |
| Open UX | **New browser tab** | `window.open`; avoids `X-Frame-Options`/CSP frame-blocking that breaks iframes for many dev servers. |

## 3. Why in-pod (not router-centric)

The router already forwards `/<slug>/*` to the instance Next.js app (`:6001`)
**unchanged**, except exactly `/<slug>/ws` upgrades (→ terminal server `:6002`).
So an HTTP proxy that lives **in the instance app** needs **zero router change**.

| Concern | Router → pod-IP:port | In-pod (instance → `127.0.0.1:port`) |
|---|---|---|
| localhost-bound dev servers (Vite default) | Silent 502 (pod IP can't reach `127.0.0.1` binds) | Always works (loopback→loopback) |
| Owner-scoping | Router must verify CF JWTs itself (new JWKS/crypto dep) | Falls out of the instance's existing auth |
| Single-host parity (`dev.bryanli.net`) | Feature absent (no router there) | Same route works |
| Redirect/cookie/base rewriting | Split across processes | One process owns it |

The only router change in the whole feature is **one rule** to route
`/<slug>/proxy/<port>` **WebSocket upgrades** to the terminal server.

## 4. Architecture

### 4.1 HTTP request flow

```
Browser
  GET https://rdv.joyful.house/dev/proxy/6000/api/data
   → Cloudflare tunnel  (enforces CF Access; adds CF_Authorization + Cf-Access-Jwt-Assertion)
   → Router  decideRoute("/dev/proxy/6000/api/data", upgrade=false)
        slug=dev in allowlist, not /ws  → proxy-http to http://rdv.rdv-dev.svc.cluster.local:6001
        (path forwarded UNCHANGED — NO router change)
   → Instance Next.js (:6001, basePath=/dev)  Next strips basePath → handler sees /proxy/6000/api/data
        route: src/app/proxy/[port]/[...path]/route.ts
          withAuth → getCurrentUser()  (owner-scoped: only this instance's authorized users)
          isPortProxyable(6000)  (block 6001/6002/privileged)
          fetch("http://127.0.0.1:6000/api/data")   ← in-pod loopback, bind-agnostic
          stream body back; rewrite Location / Set-Cookie Path; inject <base> for HTML
```

### 4.2 WebSocket (HMR) flow

```
Browser  WSS https://rdv.joyful.house/dev/proxy/6000/_hmr  (upgrade)
   → Router  decideRoute(upgrade=true)
        NEW RULE: /^\/<slug>\/proxy\/\d+/ + upgrade → proxy-ws to ws://rdv.rdv-dev.svc.cluster.local:6002
   → Terminal server (:6002)  NEW upgrade handler matches PROXY_WS_PATH_PATTERN
        validateWsToken(?token=…)   (reuse existing ws-token HMAC)
        isPortProxyable(6000)
        bridge client WS ↔ ws://127.0.0.1:6000/_hmr   (adapt router's openWsBridge to Node `ws`)
```

### 4.3 Control-plane data model

`portRegistry` (existing, **declarative**) stays as-is — env-var-declared ports +
cross-project conflict detection. A new **runtime** table `portClaims` records
ports actively held by running sessions. lsof scanning (`port-monitoring-service`)
remains the live "is it listening?" signal. The three are complementary:

| Layer | Source | Answers |
|---|---|---|
| `portRegistry` | env-var save | "which ports does this project declare?" |
| `portClaims` | session create/close | "which running session holds this port?" |
| lsof scan | on-demand | "is this port actually listening right now?" |

## 5. Track A — Control plane (foundation)

Ships independently; defines the **seam** the proxy consumes.

### A1 — `portClaims` table + service
- **Create** `portClaims` table in `src/db/schema.ts` (after `portRegistry`):
  `(id, sessionId→terminalSessions cascade, userId, projectId nullable, port,
  variableName, isListening bool?, pid?, expiresAt ts, claimedAt, updatedAt)`;
  indexes on session/user/port + unique `(sessionId, port)`. `db:push`.
- **Create** `src/services/port-claims-service.ts`: `claimPortsForSession`,
  `releasePortsForSession`, `getActiveClaimsForUser`, `getActiveClaimsForInstance`,
  `pruneExpiredClaims`, `updateListeningStatus`. Unit tests.
- `expiresAt = now + 24h` gives crash-resilience; prune on startup.

### A2 — Wire `PortMonitor` into DI
- **Create** 3 adapters in `src/infrastructure/adapters/`:
  `PortRegistryAdapterImpl` (over `port-registry-service`), `SessionAdapterImpl`
  (over the session repo, filtered to active/suspended), `TmuxAdapterImpl` (over
  `TmuxGatewayImpl`, `.toRecord()`).
- **Modify** `src/infrastructure/container.ts`: instantiate + export `portMonitor`;
  call `pruneExpiredClaims()` on startup.

### A3 — Session-lifecycle claims
- **Modify** `src/services/session-service.ts`: after tmux create, claim the
  project's registered ports for the session; in `closeSession` (~line 1386),
  `releasePortsForSession`. (Defensive duplicate in the port-manager plugin's
  `onSessionClose`.) Dynamic imports to dodge cycles.

### A4 — API surface + runtime conflict-on-save
- **Modify** `src/app/api/ports/route.ts` (`GET`): one lsof scan + claims merge so
  `isActive`/`isListening`/`pid`/`sessionId`/`sessionName` are returned inline
  (kills the hardcoded `isActive:false`).
- **Create** `GET /api/ports/active` → `portMonitor.getActivePorts(userId)`
  (tmux-env scan — catches ports not in the registry).
- **Create** `GET /api/ports/proxyable` → **the seam**: `(listening ∪ claims)`
  minus `6001/6002`/privileged, returns `ProxyablePort[]`. `withApiAuth` (dual
  session/API-key).
- **Modify** `src/services/preferences-service.ts` (~line 327): swap `validatePorts`
  → `validatePortsRuntime` (already written, currently dead).

### A5 — UI completion
- **Modify** `src/components/session/SessionMetadataBar.tsx`: inert chips →
  interactive buttons with an `onOpenPort?(port)` seam; show live active/idle.
- **Modify** `src/components/ports/PortAllocationsTab.tsx`: split the mislabeled
  `ExternalLink` — `ExternalLink` = open port (when listening), `FolderOpen` =
  edit prefs.
- **Modify** `src/contexts/PortContext.tsx` + `src/types/port.ts`: add
  `livePorts`, `getProxyUrl(port): string | null` (stub returns null until Track B),
  and the `ProxyablePort` type; extend `PortAllocationWithFolder`.
- **Implement** `src/components/mobile/profile/screens/PortsScreen.tsx` against
  `PortContext` (currently a stub).

### Seam contract (frozen after Track A)
1. `GET /api/ports/proxyable` → `ProxyablePort[]` (`{port, isListening, pid,
   process, sessionId, sessionName, projectId, variableName, source}`).
2. `PortContextValue.getProxyUrl(port) => string | null`.
3. `SessionMetadataBar.onOpenPort?(port)` / `PortAllocationsTab.onOpenPort?(port)`.

## 6. Track B — Data plane (proxy)

Depends on the Track A seam.

### B1 — HTTP proxy route
- **Create** `src/lib/proxy-port-utils.ts`: `HARD_BLOCKED` set (6001/6002/privileged),
  `isPortProxyable`, `rewriteLocationHeader`, `rewriteCookiePath`, `injectBaseTag`.
- **Create** `src/app/proxy/[port]/[...path]/route.ts` (all methods): `withAuth`
  (owner-scoped) → validate port → fetch `http://127.0.0.1:<port>` → stream →
  header/body rewrites. **Verify undici vs Bun Content-Encoding behavior
  empirically** (Node may not auto-decompress; only strip if it does).
- Unit tests for the utils (boundaries, rewrites, base-tag injection edge cases).

### B2 — "Open" wiring
- **Implement** `getProxyUrl(port)` = `prefixPath('/proxy/<port>/')` (client base
  path from `NEXT_PUBLIC_*` / first path segment).
- Chips + allocation rows `onOpenPort` → `window.open(getProxyUrl(port), '_blank',
  'noopener,noreferrer')`. Mobile: `launchUrl`/`Linking.openURL`.

### B3 — WebSocket proxy
- **Modify** `apps/supervisor-router/src/lib/router-core.ts`: add a `proxy-ws` rule
  for `/^\/<slug>\/proxy\/\d+/` upgrades **before** the `/ws` exact match → instance
  `:6002`. Unit tests in `router-core.test.ts`.
- **Modify** `src/server/terminal.ts`: extend the upgrade gate with
  `PROXY_WS_PATH_PATTERN`; add `handleProxyWsUpgrade` bridging client WS ↔
  `ws://127.0.0.1:<port>` (adapt router's `openWsBridge`); auth via
  `validateWsToken(?token=…)` (reuse the session's existing ws-token; consider a
  longer TTL or `kind:"proxy"` for the >5-min-idle case).

### B4 — Hardening + docs
- Friendly 502 (distinguish connection-refused from DNS / not-ready).
- Document the path-based limitation (absolute-URL/JS-WS apps) + the `--base`
  workaround; document the feature in `docs/` (API.md, SUPERVISOR_DEPLOY.md).
- Confirm `lsof`/`ss` present in the instance image; confirm no NetworkPolicy
  needed (in-pod loopback needs none).

## 7. Security model

- **Auth**: every proxy request passes the instance's normal CF-Access/session gate
  (`src/proxy.ts` + `withAuth`/`getCurrentUser`). The instance DB only contains
  users provisioned onto that instance → **owner-scoped** by construction. Optional
  hardening: strict requesting-email == instance-owner check.
- **Allowlist**: `isPortProxyable` hard-blocks `6001` (instance HTTP), `6002`
  (terminal/internal API), and privileged `<1024`. Proxyable set is `listening ∪
  claimed` — no arbitrary fan-out.
- **WS auth**: HMAC ws-token validated in-pod by the terminal server.

## 8. Known limitations

- **Path-based rewriting**: `<base>` fixes relative assets; apps that hardcode
  absolute paths in JS (`fetch('/api/x')`) or build WS URLs from `location` may
  render wrong. Inherent to path-based proxying. Clean fix = the deferred
  **subdomain scheme** (`6000-dev.joyful.house`) — design the registry/allowlist so
  a subdomain front end can be added without rework.
- **5-min ws-token TTL**: opening an HMR socket >5 min after page load may 401;
  mitigate with a longer proxy-token TTL.

## 9. Testing strategy

- Unit: `port-claims-service`, `proxy-port-utils` (rewrites/base/blocklist),
  `decideRoute` proxy-ws cases, adapters.
- Integration (in a real pod): `curl https://rdv.joyful.house/dev/proxy/<port>/`
  against a live dev server; Vite HMR reconnect end-to-end through the WS bridge.
- Gates: `bun run lint && typecheck && test:run`; flutter + supervisor gates per
  the `/ship` convention.

## 10. PR sequencing

```
A1 ─┬─ A2 ── A3 ─┬─ A4 ── A5 ───┐
    │             │              ├─ B2 ── (B3 ∥) ── B4
    └─────────────┘         B1 ──┘
```

- Track A first (A1→A2→A3→A4→A5). A4 (seam) + A5 unblock Track B's "Open".
- B1 (HTTP route) can start in parallel with A4/A5 (only needs `proxy-port-utils`).
- B2 needs the seam (A4/A5) + B1. B3 (WS) is largely independent (router+terminal).
- B4 last.

~8–9 PRs total. Each PR: worktree subagent → quality gates → `/ship`.

## 11. bd issues

Epic **`remote-dev-x1ve`** with 9 children:

| ID | PR | Depends on |
|---|---|---|
| `remote-dev-aumy` | A1 portClaims table + service | — (ready) |
| `remote-dev-33ov` | A2 PortMonitor DI wiring | A1 |
| `remote-dev-2zhb` | A3 session-lifecycle claims | A2 |
| `remote-dev-uc8p` | A4 ports API + proxyable seam | A1, A2 |
| `remote-dev-dk42` | A5 UI completion + mobile | A4 |
| `remote-dev-pql2` | B1 in-pod HTTP proxy + utils | — (ready) |
| `remote-dev-kmrx` | B2 Open-in-new-tab wiring | A4, A5, B1 |
| `remote-dev-4oyg` | B3 WebSocket proxy | B1 |
| `remote-dev-uqkk` | B4 hardening + docs | B1, B2, B3 |

Ready to start now: **A1** (`remote-dev-aumy`) and **B1** (`remote-dev-pql2`).
