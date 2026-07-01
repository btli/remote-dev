# Multi-Instance Hosting via `RDV_BASE_PATH` — Spec & Build Sheet

**Status:** Ready to implement
**Type:** Feature spec + implementation requirements
**Last updated:** 2026-05-19
**Implementing agent:** Read this top-to-bottom; everything you need is here.
**Project conventions:** Per `CLAUDE.md`, do this work in a git worktree
spawned via subagent, track tasks via `bd`, and don't push until quality
gates pass.

---

## 0. TL;DR

Allow a single domain (e.g. `dev.example.com`) to host multiple
independent `remote-dev` instances addressable by path prefix —
`dev.example.com/alpha/`, `dev.example.com/beta/`, etc. — so a fleet of
containerized pods can sit behind one Cloudflare tunnel + one TLS cert
+ one Cloudflare Access policy.

The change is mostly a Next.js `basePath`, an analogous prefix on the
terminal-server WebSocket route, and matching client-side URL
construction. SQLite, tmux, and `RDV_DATA_DIR` remain single-tenant per
instance — this is a **routing**-layer change, not a multi-tenant
rewrite.

---

## 1. Acceptance Criteria

The feature is done when **all** of the following are true:

- [ ] AC-1: With `RDV_BASE_PATH=""` (unset/empty), behavior is byte-identical to the current app. All existing tests pass.
- [ ] AC-2: With `RDV_BASE_PATH=/alpha`, `GET https://host/alpha/login` returns the login page (200, valid HTML).
- [ ] AC-3: With `RDV_BASE_PATH=/alpha`, `GET https://host/login` returns 404 (the bare prefix is the instance's *only* root).
- [ ] AC-4: With `RDV_BASE_PATH=/alpha`, the browser successfully connects a terminal WebSocket to `wss://host/alpha/ws` (not `wss://host/ws`).
- [ ] AC-5: Session/state/pkce/nonce/callback cookies issued at `/alpha` are sent with `Path=/alpha` and are **not** sent when the browser requests `/beta/...`. The CSRF cookie (`__Host-`) sits at `Path=/` per RFC 6265bis (the `__Host-` prefix mandates it) but is name-differentiated per instance; the functional isolation between `/alpha` and `/beta` instead comes from each pod having its own `AUTH_SECRET` (see §6.1), so a CSRF token minted under one secret cannot validate against the other.
- [ ] AC-6: Two pods running on the same host with `RDV_BASE_PATH=/alpha` and `RDV_BASE_PATH=/beta`, each with their own `RDV_DATA_DIR`, do not interfere with each other (independent sign-in state, independent sessions, independent tmux namespaces).
- [ ] AC-7: NextAuth GitHub OAuth callback URL respects the prefix: `https://host/alpha/api/auth/callback/github` works when registered with GitHub.
- [ ] AC-8: Cloudflare Access JWT validation works under a prefix; `CF_ACCESS_TEAM` + `CF_ACCESS_AUD` remain the only auth env vars needed.
- [ ] AC-9: The `rdv` Rust CLI (`crates/rdv/`) requires no changes — it connects to local Unix sockets, not through the prefixed HTTP URL.
- [ ] AC-10: `bun run lint`, `bun run typecheck`, `bun run test:run` all pass.

---

## 2. Definition of Done — Executable Verification

The implementing agent must run **all** of these and capture passing output before marking complete.

```bash
# Quality gates
bun run lint
bun run typecheck
bun run test:run

# Unit-level: basePath helper
bun test src/lib/__tests__/base-path.test.ts

# Smoke: with no basePath, server boots and serves
RDV_BASE_PATH="" PORT=6101 TERMINAL_PORT=6102 \
  AUTH_SECRET="$(openssl rand -base64 32)" \
  AUTH_URL="http://localhost:6101" \
  bun run rdv:prod
curl -fsS http://localhost:6101/login | grep -q '<html'
bun run rdv:stop

# Smoke: with basePath, login is at /alpha/login and bare /login 404s
RDV_BASE_PATH="/alpha" RDV_INSTANCE_SLUG="alpha" PORT=6101 TERMINAL_PORT=6102 \
  AUTH_SECRET="$(openssl rand -base64 32)" \
  AUTH_URL="http://localhost:6101/alpha" \
  bun run rdv:prod
curl -fsS http://localhost:6101/alpha/login | grep -q '<html'      # 200, HTML
curl -fsS -o /dev/null -w '%{http_code}' http://localhost:6101/login \
  | grep -qE '^(404|308)$'                                          # bare path 404 or redirect
bun run rdv:stop

# Cookie scoping (manual or via integration test in §8)
```

If any of these fails, the work is not done.

---

## 3. Background

`remote-dev` is already deployable as a single-tenant service. The
two-process model (Next.js on `$PORT` + terminal server on
`$TERMINAL_PORT`) and the `RDV_DATA_DIR` override make per-instance
isolation clean: each pod has its own database, its own tmux
namespace, its own NFS PVC.

What's missing is **URL multiplexing**. Today the app assumes it owns
the domain root: `/api/...`, `/login`, `/ws`, `/_next/...`. Two
instances on the same domain collide.

Subdomains can solve this but force wildcard DNS / cert / per-policy
ceremony. For a homelab fleet of 5–20 ephemeral coding sandboxes,
path-based routing is meaningfully nicer: **one URL, one bookmark, one
CF Access policy**.

---

## 4. Goals & Non-Goals

### Goals

1. One URL fronts many instances. `https://dev.example.com/{slug}/` reaches instance `{slug}` without per-instance DNS / cert / CF rule changes.
2. Zero new state. No new tables, no new tenancy model. Each pod still owns its `~/.remote-dev` and its tmux sessions exclusively.
3. WebSockets work transparently with no sticky-session hackery.
4. No regressions for single-instance deployments — with `RDV_BASE_PATH` unset, behavior is identical.

### Non-Goals

- **Cross-instance features.** Peer messaging, session sharing, etc., remain scoped to one instance.
- **In-process multi-tenancy.** Each rdv instance is still one process tree with one SQLite DB.
- **Path-based routing within an instance.** Once inside instance `alpha`, the app behaves as if the root is `/alpha/`.
- **Dynamic basePath at runtime.** `RDV_BASE_PATH` is read once at startup. Changing it requires a restart.

---

## 5. Requirements

### Functional

- **F-1** A new environment variable `RDV_BASE_PATH` controls the URL prefix this instance owns. Default empty string. Must start with `/`, must not end with `/`, must not contain `//`, must match `^(/[a-z0-9][a-z0-9-]*)+$` (single or nested path segments).
- **F-2** A new environment variable `RDV_INSTANCE_SLUG` (optional) — human-readable instance name used in UI title, log namespace, and the `X-RDV-Instance` response header. Defaults to the last segment of `RDV_BASE_PATH` (e.g. `/alpha` → `alpha`); empty when `RDV_BASE_PATH` is empty.
- **F-3** Next.js routes all serve under the prefix: `/{prefix}/login`, `/{prefix}/api/...`, `/{prefix}/_next/...`, etc.
- **F-4** The terminal WebSocket server upgrades only on `/{prefix}/ws/...`. Connections to `/ws/...` when a prefix is set are rejected with `404`.
- **F-5** NextAuth callbacks resolve under the prefix: `AUTH_URL=https://host/{prefix}` is honored end-to-end.
- **F-6** Auth cookies (`__Secure-rdv-session`, etc.) are issued with `Path={prefix or "/"}`.
- **F-7** Client code that constructs absolute URLs uses the prefix (in particular `src/lib/terminal-ws-url.ts`).
- **F-8** A new debug endpoint `GET /{prefix}/api/config` returns `{ basePath, instanceSlug, version }` for external tooling sanity checks.

### Non-functional

- **NF-1** Backward compatibility: `RDV_BASE_PATH=""` produces byte-identical behavior to current main branch.
- **NF-2** No new runtime dependencies.
- **NF-3** No change to the `rdv` Rust CLI surface.
- **NF-4** Build artifact (`.next/standalone/`) does **not** bake the basePath in. The same image must serve any slug at runtime.

### Security

- **S-1** Cookies must be path-scoped to the basePath. A request to `/alpha/...` must never include cookies set by `/beta/...`.
- **S-2** CSRF tokens must be path-scoped (NextAuth handles this when cookies are correctly scoped).
- **S-3** No new endpoints leak `RDV_BASE_PATH` to unauthenticated callers beyond the existing `/login` page surface (which already encodes the path in `<Link>` URLs).
- **S-4** WebSocket auth tokens (`src/lib/ws-token.ts`) remain unchanged in algorithm; they are still validated by the terminal server regardless of which path the upgrade arrived on.

---

## 6. Design

### 6.1 The new env vars

| Variable | Required | Default | Validation |
|----------|----------|---------|------------|
| `RDV_BASE_PATH` | no | `""` | `^$\|^(/[a-z0-9][a-z0-9-]*)+$` |
| `RDV_INSTANCE_SLUG` | no | last segment of basePath, or `""` | `^[a-z0-9][a-z0-9-]*$` |

If validation fails at startup, the server must log a fatal error and exit non-zero.

**`AUTH_SECRET` MUST be unique per instance.** Two pods that share an
`AUTH_SECRET` on the same host can decrypt each other's JWTs: a session
token captured from `/alpha` is replayable verbatim against `/beta`,
defeating both the path-scoped cookies (still served by the browser to
the right host but trivially copyable by a malicious script) and the
per-slug name differentiation. Provision each pod's `AUTH_SECRET`
independently (e.g. as separate Kubernetes Secrets) and rotate them
independently. Same rule for `AUTH_SECRET_1` / `_2` / `_3` rotation
keys — never share them across instances. This is the actual isolation
boundary for the CSRF cookie, which is forced to `Path=/` by the
`__Host-` prefix.

The `AUTH_URL` for each instance must include the basePath
(e.g. `https://host/alpha`). `src/auth.ts` pins AuthJS's internal
`basePath` to the full external path (`${RDV_BASE_PATH}/api/auth`,
e.g. `/alpha/api/auth`) so the OAuth callback URL handed to GitHub and
the URLs surfaced in `/api/auth/providers` include the prefix. The
route handler at `src/app/api/auth/[...nextauth]/route.ts` rewrites the
inbound request to add `RDV_BASE_PATH` back to the pathname before
AuthJS sees it — Next.js strips the deployment prefix before route
handlers run, so without that rewrite AuthJS's
`parseActionAndProviderId` would throw `UnknownAction` and every
`/api/auth/*` request would 500. See the comments in those two files
for the full trace.

### 6.2 Architecture diagram (logical)

```
Browser
  │
  ▼
Cloudflare edge (TLS, Access)
  │
  ▼
Cloudflare tunnel → Traefik (cluster ingress)
  │
  ├── Host header dev.example.com
  │     │
  │     ├── path /alpha/ws   → terminal-server-alpha:6002  (WebSocket)
  │     ├── path /alpha/*    → next-server-alpha:6001      (HTTP)
  │     ├── path /beta/ws    → terminal-server-beta:6002
  │     ├── path /beta/*     → next-server-beta:6001
  │     └── path /           → landing page
  │
  └── ...

Each /{slug}/ pod has its own pod, its own ~/.remote-dev PVC, its
own tmux namespace, its own SQLite. They share nothing.
```

### 6.3 Where the prefix flows

```
RDV_BASE_PATH (env)
   │
   ├── next.config.ts → Next.js basePath (handles /_next/*, pages, API routes)
   │
   ├── src/server/index.ts → terminal-server WS path prefix
   │     └── src/server/terminal.ts → upgrade-path matching
   │
   ├── src/auth.ts → NextAuth.cookies.{sessionToken,callbackUrl,csrfToken}.options.path
   │
   ├── src/app/layout.tsx → SSR-embed window.__RDV_BASE_PATH__
   │
   └── src/lib/terminal-ws-url.ts (and src/hooks/useTerminalWsUrl.ts)
         └── reads window.__RDV_BASE_PATH__ to build wss://host/{prefix}/ws
```

---

## 7. File-by-File Changes

For each file: **current state** (what's there now) and **target state**
(what it must look like after). Where possible, the diff is shown as
explicit BEFORE/AFTER. Where the change is broader (audit + multiple
edits), the requirement is stated and the agent is expected to find
the call sites.

A small new helper module hosts the parsing/validation logic so it can
be imported by both server entry points and by tests without circular
dependencies.

### 7.1 NEW — `src/lib/base-path.ts`

Create this module. The entire codebase reads basePath through these
functions; no other file should parse `process.env.RDV_BASE_PATH`
directly.

```ts
/**
 * RDV_BASE_PATH helpers — single source of truth for URL prefix handling.
 *
 * Read once at module load. Setting RDV_BASE_PATH at runtime has no effect.
 */

const RAW = process.env.RDV_BASE_PATH ?? "";

function validateBasePath(input: string): string {
  if (input === "") return "";
  if (!/^(\/[a-z0-9][a-z0-9-]*)+$/.test(input)) {
    throw new Error(
      `Invalid RDV_BASE_PATH: ${JSON.stringify(input)}. ` +
      `Must be empty or match /[a-z0-9][a-z0-9-]*(/[a-z0-9][a-z0-9-]*)*`
    );
  }
  return input;
}

export const BASE_PATH: string = validateBasePath(RAW);

export const INSTANCE_SLUG: string =
  process.env.RDV_INSTANCE_SLUG ??
  (BASE_PATH ? BASE_PATH.replace(/^\//, "").split("/").pop()! : "");

/** Cookie path: must be "/" when no prefix, else the prefix itself. */
export const COOKIE_PATH: string = BASE_PATH || "/";

/** Terminal-server WS upgrade path, e.g. "/alpha/ws" or "/ws". */
export const WS_PATH_PREFIX: string = `${BASE_PATH}/ws`;

/** Prepend basePath to an absolute URL path. Returns `input` unchanged when no prefix. */
export function prefixPath(input: string): string {
  if (!input.startsWith("/")) return input;
  if (BASE_PATH === "") return input;
  if (input === "/") return BASE_PATH;
  return BASE_PATH + input;
}
```

Companion test file `src/lib/__tests__/base-path.test.ts`:

```ts
import { describe, expect, it } from "vitest";

describe("base-path module", () => {
  it("rejects malformed prefixes", () => {
    process.env.RDV_BASE_PATH = "alpha"; // missing leading /
    expect(() => require("../base-path")).toThrow(/Invalid RDV_BASE_PATH/);
  });

  // Note: the module evaluates env at load. Use vitest's `vi.resetModules()`
  // + dynamic import to test multiple env states cleanly. See existing
  // env-driven tests in src/lib/__tests__/ for the pattern.
});
```

The agent must use vitest's module-reset pattern to exercise multiple env states; see the existing `useTerminalWsUrl.test.ts` for a working example in this codebase.

### 7.2 `next.config.ts`

**BEFORE** (current file content):

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["@libsql/client", "mysql2"],
  outputFileTracingExcludes: {
    "*": [".agents/**", ".claude/**", ".claude-plugin/**"],
  },
  turbopack: {
    root: process.cwd(),
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "avatars.githubusercontent.com",
        pathname: "/u/**",
      },
    ],
  },
};

export default nextConfig;
```

**AFTER**:

```ts
import type { NextConfig } from "next";

// Read RDV_BASE_PATH directly here — next.config.ts runs before any other
// module is loaded, so importing from `src/lib/base-path` would introduce
// a build-order dependency. Validation lives in src/lib/base-path.ts and
// is exercised when the server starts; here we trust it.
const basePath = process.env.RDV_BASE_PATH || "";

const nextConfig: NextConfig = {
  ...(basePath ? { basePath } : {}),
  output: "standalone",
  serverExternalPackages: ["@libsql/client", "mysql2"],
  outputFileTracingExcludes: {
    "*": [".agents/**", ".claude/**", ".claude-plugin/**"],
  },
  turbopack: {
    root: process.cwd(),
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "avatars.githubusercontent.com",
        pathname: "/u/**",
      },
    ],
  },
};

export default nextConfig;
```

**Important:** `basePath` may not be the empty string in Next.js config —
it must be omitted entirely or set to a non-empty `/foo`. That's why
the spread-only-when-truthy pattern.

### 7.3 `src/server/index.ts` + `src/server/terminal.ts`

**Requirement F-4**: the WebSocket upgrade only succeeds on
`{BASE_PATH}/ws/...`. Other paths return 404.

In `src/server/terminal.ts` (around line 1862 where the HTTP server is
created), introduce the path check before the WebSocket server attaches:

**BEFORE** (excerpt, line ~1862–1881):

```ts
const server = createServer(async (req, res) => {
  const handled = await handleInternalApi(req, res);
  if (!handled) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("WebSocket endpoint only");
  }
});

const wss = new WebSocketServer({ server });
```

**AFTER**:

```ts
import { WS_PATH_PREFIX } from "@/lib/base-path";

const server = createServer(async (req, res) => {
  const handled = await handleInternalApi(req, res);
  if (!handled) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("WebSocket endpoint only");
  }
});

// WebSocket upgrades only on the prefixed path. `noServer: true` so we
// control the upgrade gating manually.
const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  // Strip query string before path-matching.
  const pathOnly = (req.url || "").split("?", 1)[0];
  if (!pathOnly.startsWith(WS_PATH_PREFIX)) {
    socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit("connection", ws, req);
  });
});
```

The existing `wss.on("connection", ...)` handler does not need to
change — the query-string token extraction it already does works
identically.

### 7.4 `src/lib/terminal-ws-url.ts`

**BEFORE** (current file):

```ts
export function resolveTerminalWsUrlFromHost(input: {
  protocol: string;
  host: string;
}): string {
  const normalizedProto = input.protocol.replace(/:$/, "");
  const [hostname, port] = splitHost(input.host);
  const isLocalhost = hostname === "localhost" || hostname === "127.0.0.1";
  if (isLocalhost) {
    return `ws://localhost:${process.env.NEXT_PUBLIC_TERMINAL_PORT || "3001"}`;
  }
  const wsProtocol = normalizedProto === "https" ? "wss:" : "ws:";
  return `${wsProtocol}//${hostname}${port ? `:${port}` : ""}/ws`;
}
```

**AFTER**:

```ts
export function resolveTerminalWsUrlFromHost(input: {
  protocol: string;
  host: string;
  /** Browser-side basePath — `window.__RDV_BASE_PATH__` or "" */
  basePath?: string;
}): string {
  const normalizedProto = input.protocol.replace(/:$/, "");
  const [hostname, port] = splitHost(input.host);
  const isLocalhost = hostname === "localhost" || hostname === "127.0.0.1";
  if (isLocalhost) {
    // Localhost dev: terminal server listens on its own port, no prefix.
    return `ws://localhost:${process.env.NEXT_PUBLIC_TERMINAL_PORT || "3001"}`;
  }
  const wsProtocol = normalizedProto === "https" ? "wss:" : "ws:";
  const prefix = (input.basePath || "").replace(/\/$/, "");
  return `${wsProtocol}//${hostname}${port ? `:${port}` : ""}${prefix}/ws`;
}
```

And `src/hooks/useTerminalWsUrl.ts`:

**BEFORE**:

```ts
export function resolveTerminalWsUrl(): string {
  if (typeof window === "undefined") return "ws://localhost:3001";
  const { protocol, host } = window.location;
  return resolveTerminalWsUrlFromHost({ protocol, host });
}
```

**AFTER**:

```ts
declare global {
  interface Window {
    __RDV_BASE_PATH__?: string;
  }
}

export function resolveTerminalWsUrl(): string {
  if (typeof window === "undefined") return "ws://localhost:3001";
  const { protocol, host } = window.location;
  return resolveTerminalWsUrlFromHost({
    protocol,
    host,
    basePath: window.__RDV_BASE_PATH__ || "",
  });
}
```

Update `src/hooks/__tests__/useTerminalWsUrl.test.ts` accordingly —
new cases for `basePath: "/alpha"` should assert
`wss://host/alpha/ws` is returned.

### 7.5 `src/app/layout.tsx`

Embed `window.__RDV_BASE_PATH__` via SSR so the client knows the
runtime prefix without rebuilding the image.

The agent must add a `<script>` tag in the document `<head>` that sets
`window.__RDV_BASE_PATH__` from the server-side `BASE_PATH` constant.
Read the current `src/app/layout.tsx` first to choose the right
insertion point; the pattern is:

```tsx
import { BASE_PATH } from "@/lib/base-path";

// ...inside the layout's JSX, in <head>:
<script
  dangerouslySetInnerHTML={{
    __html: `window.__RDV_BASE_PATH__=${JSON.stringify(BASE_PATH)};`,
  }}
/>
```

`JSON.stringify` is the correct escape boundary — never string-concatenate.

### 7.6 `src/auth.ts` — cookie path scoping

NextAuth v5 accepts a `cookies` config block. Currently `auth.ts` does
not configure cookies explicitly; defaults give `Path=/`. Add explicit
configuration that uses the basePath.

Add to the `NextAuth({ ... })` config object (alongside `adapter`,
`session`, `providers`, `callbacks`):

```ts
import { BASE_PATH, COOKIE_PATH, INSTANCE_SLUG } from "@/lib/base-path";

// inside NextAuth({...}):
cookies: {
  sessionToken: {
    name: INSTANCE_SLUG
      ? `__Secure-rdv-${INSTANCE_SLUG}-session-token`
      : `__Secure-next-auth.session-token`,
    options: {
      httpOnly: true,
      sameSite: "lax",
      path: COOKIE_PATH,
      secure: true,
    },
  },
  callbackUrl: {
    name: INSTANCE_SLUG
      ? `__Secure-rdv-${INSTANCE_SLUG}-callback-url`
      : `__Secure-next-auth.callback-url`,
    options: {
      sameSite: "lax",
      path: COOKIE_PATH,
      secure: true,
    },
  },
  csrfToken: {
    name: INSTANCE_SLUG
      ? `__Host-rdv-${INSTANCE_SLUG}-csrf-token`
      : `__Host-next-auth.csrf-token`,
    options: {
      httpOnly: true,
      sameSite: "lax",
      path: "/",   // CSRF cookie MUST be path "/" — Host- prefix requires it
      secure: true,
    },
  },
},
```

**Subtle point**: the `__Host-` prefix on CSRF requires `Path=/` per
spec, so CSRF cookies are *not* path-scoped — they're shared across
instances. This is acceptable: NextAuth uses CSRF only for sign-in
flows and validates the host + secret. Two instances on the same host
will use different secrets (different `AUTH_SECRET`), so CSRF tokens
from one cannot validate against the other.

The cookie *name* differentiation is belt-and-suspenders so two
instances on the same host don't even see each other's cookies in the
browser's Application tab. Path scoping is the real isolation.

### 7.7 `src/lib/auth-utils.ts` — CF Access JWT issuer

`auth-utils.ts` already validates Cloudflare Access JWTs via
`CF_ACCESS_TEAM` / `CF_ACCESS_AUD`. The JWT validation is
hostname-scoped at the CF side, not path-scoped. **No change required**
to JWT validation logic. The agent should verify by reading the file
that nothing in it constructs URLs from `process.env.NEXTAUTH_URL`
without going through Next.js routing.

### 7.8 Absolute URL audit

The implementing agent must run this and address every hit:

```bash
rg -n '"/(api|login|profile|settings|sessions|recordings|templates|trash|secrets)/' src/ \
  | grep -v '__tests__\|\.test\.' \
  | grep -v 'fetch.*useFetch\|Link.*href'
```

Most hits will be inside `<Link href="...">` or `fetch("/api/...")`
calls. `<Link>` auto-prepends basePath, fine. `fetch` from the browser
auto-resolves against the current URL, so `/api/foo` works because
the page is at `/alpha/page`, and the fetch resolves to
`/alpha/api/foo`. Verify this assumption — Next.js basePath docs say
fetch is **NOT** auto-prefixed for client fetches. If incorrect, every
client-side `fetch("/api/...")` needs `${BASE_PATH}/api/...`.

If the audit finds that client `fetch` calls need prefixing, the
correct fix is to add a small wrapper `src/lib/api-fetch.ts` and
migrate fetch calls. **The agent must run this audit and report what
they found before making sweeping changes.**

### 7.9 Server-side absolute URL construction

Search for any server-side absolute URL building (NextAuth callbacks
not relying on `AUTH_URL`, redirect helpers, etc.):

```bash
rg -n 'new URL\|absoluteURL\|baseURL' src/
```

Any constructor that uses `process.env.NEXTAUTH_URL` or
`process.env.AUTH_URL` is fine — those env vars already include the
prefix at deploy time.

### 7.10 `GET /api/config` endpoint

Create `src/app/api/config/route.ts`:

```ts
import { NextResponse } from "next/server";
import { BASE_PATH, INSTANCE_SLUG } from "@/lib/base-path";

const VERSION = process.env.npm_package_version || "unknown";

export async function GET() {
  return NextResponse.json({
    basePath: BASE_PATH,
    instanceSlug: INSTANCE_SLUG,
    version: VERSION,
  });
}
```

Add to `docs/API.md` and `docs/openapi.yaml`.

### 7.11 `X-RDV-Instance` response header

In `src/middleware.ts` (if it doesn't exist yet, create it):

```ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { INSTANCE_SLUG } from "@/lib/base-path";

export function middleware(req: NextRequest) {
  const res = NextResponse.next();
  if (INSTANCE_SLUG) res.headers.set("x-rdv-instance", INSTANCE_SLUG);
  return res;
}

export const config = {
  matcher: "/(.*)",
};
```

Existing route-protection middleware logic per `CLAUDE.md` line 182
("Middleware in `src/middleware.ts` protects all routes except
`/login` and `/api`") may not currently exist as a separate file (the
absolute URL audit above will confirm). If route-protection logic is
elsewhere, just augment it; if no middleware exists, this new file is
the right home for both.

### 7.12 `scripts/init.sh`

Accept a new flag:

```bash
--base-path <PATH>     # Set RDV_BASE_PATH (e.g. /alpha)
--instance-slug <SLUG> # Set RDV_INSTANCE_SLUG
```

Both write to `.env.local`. The script's `--help` block should
document them.

### 7.13 Documentation updates

| File | Update |
|------|--------|
| `docs/SETUP.md` | New "Multi-Instance Deployment" section showing the env vars + GitHub OAuth multi-callback note |
| `docs/ARCHITECTURE.md` | Brief note in the existing architecture diagram showing basePath flow |
| `docs/API.md` | Document new `GET /api/config` |
| `docs/openapi.yaml` | Add `/config` path |
| `CLAUDE.md` (root) | Update the env-vars table to include `RDV_BASE_PATH` / `RDV_INSTANCE_SLUG` and update `NEXTAUTH_URL` → `AUTH_URL` (the docs are stale on this anyway) |

---

## 8. Test Plan

### 8.1 Unit tests

- `src/lib/__tests__/base-path.test.ts` (new): empty, `/alpha`, `/x/y`, malformed inputs throw, SLUG derivation, prefixPath helper.
- `src/hooks/__tests__/useTerminalWsUrl.test.ts` (update): two new cases for prefixed and unprefixed paths.

### 8.2 Integration tests

Add `src/__tests__/integration/multi-instance.test.ts` (location may vary based on existing test layout — find the matching pattern in this repo):

```ts
// Pseudo-test outline; adapt to existing patterns
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";

describe("multi-instance hosting", () => {
  let alpha: ChildProcess;
  let beta: ChildProcess;

  beforeAll(async () => {
    alpha = startServer({ basePath: "/alpha", port: 6101, dataDir: "/tmp/rdv-test-alpha" });
    beta  = startServer({ basePath: "/beta",  port: 6101, dataDir: "/tmp/rdv-test-beta"  });
    // NOTE: same port; in practice each runs in its own container.
    // Use port 6101 + 6201 here for test isolation.
    await waitForReady(6101); await waitForReady(6201);
  });
  afterAll(() => { alpha.kill(); beta.kill(); });

  it("AC-2: prefixed login is reachable", async () => {
    const res = await fetch("http://localhost:6101/alpha/login");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("<html");
  });

  it("AC-3: bare /login returns 404 with prefix set", async () => {
    const res = await fetch("http://localhost:6101/login", { redirect: "manual" });
    expect([404, 308]).toContain(res.status);
  });

  it("AC-5: cookies from /alpha are not sent to /beta", async () => {
    // Sign in to alpha, capture cookies, attempt to hit beta with them, expect 401
    // (Use credentials auth — localhost-only — for the test fixture)
  });

  it("AC-6: independent SQLite databases", async () => {
    // Create a session in alpha, verify it does not appear in beta's session list
  });
});
```

The agent must adapt this to the project's existing test runner setup
(vitest with happy-dom is the current config).

### 8.3 Regression

Run the full existing test suite with `RDV_BASE_PATH` unset and confirm zero regressions.

---

## 9. Deployment Surface (Reference Only — Out of Scope for This Issue)

For context, the K8s deployment that consumes this feature looks like:

**Pod env per instance (Helm values):**

```yaml
env:
  - { name: RDV_BASE_PATH,      value: "/alpha" }
  - { name: RDV_INSTANCE_SLUG,  value: "alpha" }
  - { name: AUTH_URL,           value: "https://dev.example.com/alpha" }
  - { name: AUTH_SECRET, valueFrom: { secretKeyRef: { name: rdv-alpha-secrets, key: AUTH_SECRET } } }
  - { name: RDV_DATA_DIR,       value: "/var/lib/rdv" }
  # plus CF_ACCESS_TEAM, CF_ACCESS_AUD, GITHUB_* as today
```

**Ingress (one host, many paths):**

```yaml
- host: dev.example.com
  http:
    paths:
      - path: /alpha
        pathType: Prefix
        backend: { service: { name: rdv-alpha, port: { number: 6001 } } }
      - path: /beta
        pathType: Prefix
        backend: { service: { name: rdv-beta,  port: { number: 6001 } } }
      - path: /
        pathType: Prefix
        backend: { service: { name: rdv-landing, port: { number: 80 } } }
```

The K8s side is implemented in a separate repository
(`example-org/k3s-infra`) and is not the responsibility of this issue.

---

## 10. Out of Scope

- Multi-tenancy *within* a single process.
- A landing page UI (the K8s side owns this).
- Per-instance Cloudflare Access policies (operations concern, no code).
- The Electron app — it always runs on localhost and never uses basePath.
- The mobile bridge — same; localhost paired to a single instance.
- Migration of existing single-instance deployments (they continue to work unchanged with `RDV_BASE_PATH=""`).

---

## 11. Implementation Phases — bd Issue Breakdown

Per `CLAUDE.md`, this project uses `bd` for issue tracking. Create
one parent issue and four child issues so the work is reviewable in
chunks.

```bash
# Parent
bd create \
  --title "Add RDV_BASE_PATH for multi-instance hosting" \
  --type feature \
  --priority p2 \
  --body-from docs/plans/multi-instance-basepath.md

# Child 1 — Spike + plumbing core
bd create \
  --title "RDV_BASE_PATH spike: helper module + next.config + WS path" \
  --type task --priority p2 \
  --depends-on <parent-id> \
  --body 'Implement §7.1 (src/lib/base-path.ts), §7.2 (next.config.ts),
          §7.3 (terminal server upgrade gating), §7.4 (terminal-ws-url +
          hook), §7.5 (layout SSR script). Tests for §8.1.
          Verification: AC-1..AC-4 pass.'

# Child 2 — Auth + cookies
bd create \
  --title "RDV_BASE_PATH: NextAuth cookie path scoping" \
  --type task --priority p2 \
  --depends-on <parent-id> \
  --body 'Implement §7.6 (auth.ts cookies block), §7.7 (auth-utils audit).
          Verification: AC-5, AC-6 (cookies + sessions independent), AC-7
          (GitHub OAuth callback under prefix), AC-8 (CF Access unchanged).'

# Child 3 — Absolute URL audit + endpoint + header
bd create \
  --title "RDV_BASE_PATH: URL audit, /api/config endpoint, X-RDV-Instance" \
  --type task --priority p3 \
  --depends-on <parent-id> \
  --body 'Implement §7.8 (audit), §7.9 (server URL audit), §7.10
          (/api/config), §7.11 (middleware header). Verification: AC-9
          (CLI unchanged), report from §7.8 audit attached.'

# Child 4 — Ops + docs
bd create \
  --title "RDV_BASE_PATH: init.sh, docs, integration test" \
  --type task --priority p3 \
  --depends-on <parent-id> \
  --body 'Implement §7.12 (init.sh flags), §7.13 (docs updates), §8.2
          (integration test). Verification: AC-10 + manual run of all
          commands in §2.'
```

Total estimate: 5–7 days for one engineer, including review.

---

## 12. Open Questions

These are resolved at design time. The implementing agent should **not**
revisit them unless they hit a real blocker.

1. **Env-only or DB-stored basePath?** Env-only. The app needs to know its prefix before it can connect to the DB.
2. **Should the rdv CLI have `--base-path`?** No — the CLI uses Unix sockets and bypasses HTTP entirely.
3. **Should `/api/config` exist?** Yes — see §7.10.
4. **Multi-account NextAuth per instance?** Out of scope. Each instance is its own NextAuth identity.

---

## 13. Glossary

| Term | Definition |
|------|------------|
| Instance | One running pod with one `RDV_BASE_PATH` and its own state. |
| Slug | The human name for an instance; usually the last segment of the basePath. |
| basePath | The URL prefix this instance owns. |
| Prefix | Same as basePath; used informally. |

---

## 14. Done means

All of:
- Every checkbox in §1 ticked.
- Every command in §2 passes.
- All bd child issues from §11 closed.
- A PR exists, has been reviewed, and is merged to main.
- `docs/plans/multi-instance-basepath.md` has its status updated to "Implemented in X.Y.Z" with a link to the PR.
