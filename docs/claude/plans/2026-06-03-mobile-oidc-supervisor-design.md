# Mobile OIDC Supervisor Support — Design Spec

> **Status:** Approved design (2026-06-03), **revised per Codex review (2026-06-03)** — integrated 2 blockers + 4 improvements (see §14). Next step: implementation plan (`superpowers:writing-plans`) → `superpowers:subagent-driven-development`.
> **Tracking:** remote-dev-8erx
> **Approach:** #1 — generalize the edge-credential into a named auth cookie. **Scope:** full end-to-end (discovery + REST + terminals on rdv.joyful.house, deployed to homelab + verified on-device).

**Goal:** Make the Flutter mobile multi-workspace bootstrap work on an **OIDC/Authentik supervisor host** (rdv.joyful.house) that has **no Cloudflare Access**, without regressing CF-Access hosts (dev.bryanli.net).

**Architecture:** The mobile app already holds a portable credential it replays on Dio requests and seeds into terminal WebViews. Today that credential is hard-coded to the `CF_Authorization` cookie. We generalize it to a **list of named auth cookies** (`{name, value, path}`). The two `mobile-callback` server routes — whose identity resolution already supports both CF and OIDC — return a CF cookie on CF hosts and the **NextAuth session cookie** on OIDC hosts. No new auth backends, no new tables, no new mint endpoints.

**Tech Stack:** Next.js 16 / NextAuth v5 (Auth.js) server components; Flutter (Riverpod, Dio, flutter_inappwebview, flutter_secure_storage, freezed); Vitest + Dart test.

---

## 1. Background & Root Cause

The mobile multi-workspace feature (PR #336) assumed every supervisor host sits behind **Cloudflare Access**, which issues a host-wide `CF_Authorization` cookie. The mobile app replays that cookie on Dio calls (`Cookie: CF_Authorization=…`) and seeds it into the terminal WebView cookie jar.

rdv.joyful.house authenticates via **Authentik OIDC** (NextAuth), proven by:
- `GET https://rdv.joyful.house/ → 307 → /login?callbackUrl=%2F`
- `GET /api/auth/providers → {"oidc":{"name":"Authentik",…}}` (supervisor: **oidc only**)
- `GET /demo → 307 → /demo/login`; `/demo/api/auth/providers → github + credentials + oidc`

There is **no CF cookie** to read, replay, or seed.

**Key insight:** The *backends* already do dual auth. Only the callbacks and the app's CF assumption are CF-locked:
- Instance: `withApiAuth` (`src/lib/api.ts:95-118`) calls `getAuthSession()` (CF **or** OIDC, `src/lib/auth-utils.ts:76-156`) **first**, then falls back to Bearer API key.
- Supervisor: `withSupervisorAuth` → `resolveAuthenticatedEmail` (CF **or** OIDC, `apps/supervisor/src/lib/auth.ts:60-99`).
- Cookie names are already discoverable: `getSessionCookieName()` (`src/lib/auth-cookies.ts:108-114`, slug-scoped) and `apps/supervisor/src/lib/session-cookie.ts:57-62` (default).

## 2. Success Criteria

1. On rdv.joyful.house, the app can: add the host → OIDC login (system browser) → **discover** instances via `/api/instances` → add a workspace → **REST** calls succeed → open a **terminal/session** WebView. (The seeded session cookie authenticates the WebView *page* and its `GET /<slug>/api/sessions/:id/token` fetch; the terminal **WebSocket** keeps using the existing short-lived HMAC token — see §7.1. No cookie change to the WS path.)
2. dev.bryanli.net (CF Access) continues to work **unchanged** for both updated and un-updated app installs.
3. Existing installed-app credentials are **not** invalidated (no forced re-login).
4. New backend logic is unit-tested; mobile parse/store/interceptor/seeder/launcher logic is unit-tested.
5. Supervisor + instance images deployed to the homelab (Forgejo→Harbor→ArgoCD); flow verified on-device.

## 3. Non-Goals

- No new supervisor API-key subsystem; no WebView API-key→session bridge (Approach #3, deferred).
- No change to instance REST credential on **CF** hosts (keeps Bearer API key + CF cookie).
- Deep-link custom-scheme hijack hardening (PKCE-style `state`) — **file a follow-up**; pre-existing risk equal for CF.
- Self-serve multi-email management UI (separate follow-up).

## 4. Credential Model & Deep-Link Contract

### 4.1 AuthCookie
```
AuthCookie = { name: string, value: string, path: string }
```
- **CF host:** `[{ name: "CF_Authorization", value: <cfToken>, path: "/" }]`
- **OIDC supervisor:** `[{ name: "__Secure-authjs.session-token", value: <JWE>, path: "/" }]`
- **OIDC instance (basePath `/<slug>`):** `[{ name: "__Secure-rdv-<slug>-session-token", value: <JWE>, path: "/<slug>" }]`

A **list** handles Auth.js **chunking**: when the session JWE exceeds ~4 kB it is split into `<name>.0`, `<name>.1`, …. All chunks are collected, transported, replayed, and seeded; the server reassembles by name. (Authentik sessions are usually a single cookie, but we handle chunking because the proxy gate is otherwise blind to it — see §5.3.)

### 4.2 Deep link (callback → app)
```
remotedev://auth/callback
  ?scope=host|instance                       # REQUIRED (parser treats scope as authoritative — §6.2)
  &authCookies=<base64url(JSON([AuthCookie,…]))>
  &apiKey=<string>                            # CF instance callback only (legacy + new-app Bearer)
  &cfToken=<string>                           # legacy, CF callbacks only (un-updated apps)
  &email=<string>&userId=<string>
```
- **CF supervisor:** `scope=host`, `authCookies=[CF@/]`, legacy `cfToken=`.
- **CF instance:** `scope=instance`, `authCookies=[CF@/]`, `apiKey=`, legacy `cfToken=`.
- **OIDC supervisor:** `scope=host`, `authCookies=[session@/]`.
- **OIDC instance:** `scope=instance`, `authCookies=[session@/<slug>]`.

`base64url` (RFC 4648 §5, no padding) avoids `+`/`/`/`=` collisions in a URL query value.

## 5. Backend Design

Identity resolution + cookie extraction move into a **testable helper** per app; each `page.tsx` becomes a thin wrapper that calls the helper and either `redirect()`s to the deep link, `redirect()`s to login, or renders the existing `ErrorPage`.

### 5.1 Instance — `src/lib/mobile-callback.ts` (NEW)
```ts
export type AuthCookie = { name: string; value: string; path: string };
export type MobileCallbackResult =
  | { kind: "redirect"; url: string }   // deep link
  | { kind: "login" }                    // no identity → bounce to /login
  | { kind: "error"; message: string };

// Collect `name` and `name.<n>` chunk cookies (numeric order), from a cookie store.
export function collectSessionCookies(
  store: { getAll(): { name: string; value: string }[] },
  cookieName: string,
  path: string,
): AuthCookie[];

export async function resolveInstanceMobileCallback(): Promise<MobileCallbackResult>;
```
Logic:
1. **CF path** (unchanged behavior): `CF_Authorization` present + `validateAccessJWT` passes → `getOrCreateUserByEmail` → `createApiKey(user.id,"Mobile App")` → deep link `scope=instance` + `apiKey` + legacy `cfToken` + `authCookies=[{CF_Authorization, cfToken, "/"}]`.
2. **OIDC path** (NEW): else `getAuthSession()`; if a session resolves → `cookieName = resolveInstanceSessionCookieName()` (§5.4), `path = COOKIE_PATH`, `authCookies = collectSessionCookies(store, cookieName, path)`. If non-empty → deep link `scope=instance`, `authCookies`, **no** apiKey/cfToken.
3. Else → `{ kind: "login" }`; page does `redirect("<basePath>/login?callbackUrl=<basePath>/auth/mobile-callback")`. `ErrorPage` only for the impossible "authenticated but no extractable cookie" case.

`page.tsx` keeps `export const dynamic = "force-dynamic"` + the existing `ErrorPage`.

### 5.2 Supervisor — `apps/supervisor/src/lib/mobile-callback.ts` (NEW)
Same shape, but:
- Identity via `resolveAuthenticatedEmail(request)` → `resolveSupervisorUser(email)` (existing).
- Cookie name via `resolveSupervisorSessionCookieName()` (§5.4); path `"/"`.
- CF path: `scope=host`, `authCookies=[{CF_Authorization, cfToken, "/"}]`, legacy `cfToken=`.
- OIDC path: `scope=host`, `authCookies=[{<name>, value, "/"}]`.

### 5.3 Proxy presence-gate must be chunk-aware (Codex #2 — was a BLOCKER)
The scoped **instance** proxy gates the WebView page load by *presence* of the session cookie name: `src/proxy.ts:126` does `candidates.some(name => request.cookies.has(name))`, and `getSessionCookieNameCandidates()` (`src/lib/auth-cookies.ts:140-148`) returns only the **base** names. A **chunked** session cookie (`<name>.0`, `<name>.1`) has no base-name cookie, so the gate would 307→`/login` and the seeded-cookie WebView page would never load. (REST/token fetches are under `/api`, not proxy-gated, and `auth()` reassembles chunks there — so only the gated page is affected.)

**Required change:** make the presence gate accept a base candidate **or** its numeric chunks. Centralize in `getSessionCookieNameCandidates()` semantics or in the `proxy.ts` check, e.g. treat a candidate as present when any request cookie name equals `c` or matches `^<c>\.\d+$`. Add proxy tests for a request bearing only `…-session-token.0` / `.1`. (This also hardens browser logins, not just mobile.)

### 5.4 Cookie-name resolution robustness (Codex #4 — was MAJOR)
The supervisor `getSessionCookieName(request?)` decides the `__Secure-` prefix from the `AUTH_URL`/`NEXTAUTH_URL` scheme when no request is passed; the supervisor server component passes none, and `AUTH_URL` is **not** guaranteed set in the supervisor container (absent from `apps/supervisor/.env.example` / `docs/SUPERVISOR_DEPLOY.md`). Wrong prefix → silent extraction failure.

**Required change:** in both `mobile-callback` helpers, resolve the name from request reality, not an env guess:
1. Derive scheme from `headers()` (`x-forwarded-proto`) and pass a minimal `{ headers }` request to the existing `getSessionCookieName(request)`; **and**
2. Belt-and-suspenders fallback: if the resolved name isn't in the cookie store, scan for the first cookie whose name matches `^(__Secure-|__Host-)?(authjs|rdv-<slug>)[.-]session-token(\.\d+)?$` and use its base name.
Also add a startup/runtime note to docs: when supervisor OIDC is enabled, set `AUTH_URL=https://<supervisor-host>`.

### 5.5 Chunk collection
`collectSessionCookies` matches exactly `name` and `name + "." + <digits>` (numeric-ordered `.0`, `.1`, …); never substring-matches (avoids grabbing `…-callback-url`). Assert ordering in tests.

## 6. Mobile Design (generalize, do not rewrite)

### 6.1 New model — `mobile/lib/domain/auth_cookie.dart`
Freezed `AuthCookie { String name; String value; String path; }` + json. Helper `decodeAuthCookies(String b64url) -> List<AuthCookie>` (base64url-decode → JSON list; tolerant → `[]` on malformed input).

### 6.2 `mobile_callback_login_launcher.dart` — parse precedence **and base-path fix** (Codex #3 — was a BLOCKER)
`MobileCallbackResult` variants `HostCallback`/`InstanceCallback` each gain `List<AuthCookie> authCookies`; `InstanceCallback` keeps `String? apiKey`. New `parseMobileCallback` precedence (scope authoritative):
```
scope=="host"      -> HostCallback(authCookies, email, userId)
scope=="instance"  -> InstanceCallback(authCookies, apiKey?, email, userId)
else (legacy, no scope): apiKey present -> InstanceCallback(authCookies ?? [CF from cfToken], apiKey, …)
                         else            -> HostCallback(authCookies ?? [CF from cfToken], …)
```
**Base-path bug fix:** `_awaitCallback` currently does `baseUrl.replace(path: '/auth/mobile-callback')` (`mobile_callback_login_launcher.dart:258-260`), which **discards** the workspace prefix — so an instance login at `https://host/demo` wrongly opens `https://host/auth/mobile-callback` (the supervisor). On OIDC the instance session lives only at `/<slug>`, so this must append under the existing path:
```
final base = baseUrl.path.replaceFirst(RegExp(r'/+$'), '');   // '' for host root, '/demo' for workspace
final callbackUrl = baseUrl.replace(path: '$base/auth/mobile-callback');
```
Tests: host root → `/auth/mobile-callback`; workspace (`/demo`) → `/demo/auth/mobile-callback`; via workspace picker; and refresh/re-auth via `conn.effectiveUrl`. Login stays **system-browser + deep-link**; per-workspace OIDC is a silent Authentik SSO redirect (IdP cookie set by the host login).

### 6.3 `mobile_credentials.dart` — storage + read-compat
- Store host cookies at `host.<hostId>.authCookies` (JSON list), workspace at `workspace.<workspaceId>.authCookies`; keep `workspace.<workspaceId>.apiKey`.
- **Read-compat:** `getHostAuthCookies` / `getWorkspaceAuthCookies` return the stored list, else fall back to legacy `…cfToken` → `[{CF_Authorization, …, "/"}]`. No forced re-login on upgrade.
- New `AuthMaterial { List<AuthCookie> cookies; String? apiKey; }` replaces the `{apiKey, cfCookie}` pair.

### 6.4 `cf_auth_interceptor.dart`
`onRequest`: join all `AuthMaterial.cookies` into one `Cookie:` header (`name=value; …`, merging with any existing Cookie header as today); attach `Authorization: Bearer <apiKey>` only when `apiKey` is non-empty. (Behaviorally identical for the CF single-cookie case.)

### 6.5 `webview_cookie_seeder.dart` — multi-cookie + SameSite (Codex #6 — MINOR)
Seed **each** `AuthCookie` via `CookieManager.setCookie(url, name, value, path: c.path, isSecure: true, isHttpOnly: true, sameSite: HTTPCookieSameSitePolicy.LAX, expiresDate: +30d)`. Explicit `sameSite: Lax` mirrors the server's `sameSite: "lax"` (`src/lib/auth-cookies.ts:171-178`); the WebView page load is a top-level GET (Lax sends it) and the token fetch is same-origin. Add a companion `deleteAuthCookies(origin, List<AuthCookie>)` that deletes each by name+path (incl. chunks) — used by §6.8.

### 6.6 `instances_api.dart` (discovery)
Attach **host** auth cookies: `AuthMaterial(cookies: hostAuthCookies, apiKey: null)`.

### 6.7 `remote_dev_client.dart`
`forWorkspace(...)` builds `AuthMaterial(cookies: workspaceAuthCookies, apiKey: workspaceApiKey)`.

### 6.8 Credential cleanup on sign-out / workspace delete (Codex #5 — was MAJOR)
Today sign-out clears secure storage but only deletes WebView cookies on the *last-workspace* path (`account_screen.dart:138-148`), and `removeWorkspace` clears only secure storage (`host_workspace_store_impl.dart:115-119`). With **per-workspace** OIDC cookies, a deleted/signed-out workspace stays authenticated in the WebView jar.

**Required change:** make WebView cookie deletion path/name-aware. On workspace sign-out **or** delete, call `deleteAuthCookies` for *that workspace's* cookies (incl. chunks) regardless of siblings; delete the host cookies only when the last workspace/host is removed. Wire `removeWorkspace` to delete the workspace's WebView cookies + secure-storage entries.

## 7. Transport & Scope Isolation

### 7.1 Terminal transport is token-based, not cookie-based (Codex #1)
The xterm terminal does **not** authenticate the WebSocket with a cookie. `useTerminalWebSocket.ts:200` fetches `GET /<slug>/api/sessions/:id/token` (under `withApiAuth` → session-cookie auth works) which mints a short-lived HMAC token (`generateWsToken`), then connects `wss://host/<slug>/ws?token=…`; `terminal.ts:1950` validates only `query.token` via `validateWsToken`. **Implication:** the seeded OIDC session cookie only needs to authenticate (a) the WebView page and (b) the token fetch — both same-origin under `/<slug>`. The WS path needs no cookie change. E2E must assert the token fetch succeeds and the `?token=` WS connects.

### 7.2 Scope isolation
- **Discovery → supervisor:** send **only host** auth cookies.
- **Instance REST + terminal WebView/token-fetch:** send/seed **only that workspace's** auth cookies (at their `/<slug>` path).
- Instance session cookies are slug-named (`rdv-<slug>-…`) **and** path-scoped, so there is no name collision with the supervisor's `__Secure-authjs.session-token@/` even on the shared homelab domain. Strict per-scope separation is kept regardless (host cookie never seeded into an instance WebView).

## 8. Compatibility / Non-Regression
- CF callbacks emit **both** legacy params (`apiKey`,`cfToken`) and new `authCookies` → updated apps prefer `authCookies`, un-updated apps use legacy. dev.bryanli.net unaffected.
- Mobile read-compat falls back to legacy stored keys → no forced re-login.
- `buildScopedCookies()` returns `undefined` when `RDV_BASE_PATH` is unset → single-server/localhost behavior byte-identical. The §5.3 proxy change must preserve the unscoped path exactly.

## 9. Security
- App stores a NextAuth session-token value (sensitive) in `flutter_secure_storage` — same sensitivity class as the CF token already stored; on-device transport via `remotedev://`.
- **No new server attack surface:** no new mint endpoints, no API-key-in-URL, no new tables.
- Never log raw cookie values (use `createLogger`; log `userId`/`email` only).
- §6.8 cleanup closes a real session-leak in the WebView jar on workspace removal.

## 10. Testing
- **Instance backend** (`src/lib/__tests__/mobile-callback.test.ts`): CF valid/invalid; OIDC single + **chunked**; no-identity→`login`; emitted deep-link params. Mock `cookies`/`headers`, `validateAccessJWT`, `getAuthSession`, cookie-name resolver, `createApiKey`.
- **Proxy** (`src/__tests__/proxy.test.ts`): chunk-only request (`.0`/`.1`) is treated logged-in; unscoped path unchanged.
- **Supervisor backend** (extend `apps/supervisor/src/app/auth/mobile-callback/__tests__/page.test.tsx`): OIDC branch + chunked + `authCookies`; keep CF.
- **Mobile** (`mobile/test/...`): `parseMobileCallback` (host/instance/legacy/chunked/malformed b64); **launcher base-path** construction (host/workspace/picker/refresh); credentials read-compat; interceptor (multi-cookie + Bearer gating); seeder (per-path + sameSite); cleanup (per-workspace vs last). `flutter test` may hang at `_dyld_start` — attempt, fall back to skipping the gate for the sideload APK if it recurs.
- **E2E (on-device):** rdv.joyful.house host add → discover → workspace → REST → terminal (token fetch + WS); capture adb logcat.

## 11. Deployment (two tracks)
1. **GitHub `/ship`:** lands instance + mobile + proxy changes to master → auto-deploy to **dev.bryanli.net** (CF) → canary. (Supervisor change inert there.)
2. **Homelab (Forgejo→Harbor→ArgoCD):** rebuild **supervisor** + **instance** images, ArgoCD rollout. Source = **Forgejo, not GitHub** (known gotcha). Distinct operational step; may require pushing the Forgejo remote / triggering CI and confirming rollout before on-device verification. Set/confirm `AUTH_URL=https://rdv.joyful.house` on the supervisor (§5.4).

## 12. File Map
**Create**
- `src/lib/mobile-callback.ts` (+ `src/lib/__tests__/mobile-callback.test.ts`)
- `apps/supervisor/src/lib/mobile-callback.ts`
- `mobile/lib/domain/auth_cookie.dart` (+ generated `.freezed.dart`/`.g.dart`) (+ `mobile/test/domain/auth_cookie_test.dart`)

**Modify**
- `src/app/auth/mobile-callback/page.tsx`; `apps/supervisor/src/app/auth/mobile-callback/page.tsx` (+ its `__tests__/page.test.tsx`)
- `src/proxy.ts` and/or `src/lib/auth-cookies.ts` (chunk-aware presence gate, §5.3) (+ `src/__tests__/proxy.test.ts`)
- `mobile/lib/infrastructure/auth/mobile_callback_login_launcher.dart` (parse + base-path)
- `mobile/lib/infrastructure/auth/mobile_credentials.dart`
- `mobile/lib/infrastructure/api/cf_auth_interceptor.dart`
- `mobile/lib/infrastructure/webview/webview_cookie_seeder.dart` (multi-cookie, sameSite, delete)
- `mobile/lib/infrastructure/api/instances_api.dart`
- `mobile/lib/infrastructure/api/remote_dev_client.dart`
- `mobile/lib/presentation/screens/profile/account_screen.dart` + `mobile/lib/presentation/screens/server_picker/server_picker_screen.dart` + `mobile/lib/infrastructure/storage/host_workspace_store_impl.dart` (cleanup wiring, §6.8)
- `CHANGELOG.md`; auth notes in `docs/AGENTS.md` / `docs/MULTI_INSTANCE.md` / `docs/MOBILE_ARCHITECTURE.md` / `docs/SUPERVISOR_DEPLOY.md` (AUTH_URL) as touched.

## 13. Open Questions / Risks
- **Rolling sessions:** value read server-side stays valid until `exp`; replay still authenticates; re-login on expiry (matches CF UX).
- **Chunk likelihood:** Authentik sessions are usually single-cookie; we handle chunking defensively because the proxy gate (§5.3) would otherwise silently fail the page load.
- **AUTH_URL on supervisor:** resolved by §5.4 (header-derived + cookie-scan fallback) and a deploy doc note.

## 14. Codex Review Integration (2026-06-03)
- **#1 [MAJOR→clarified]** Terminal WS is HMAC-token, not cookie → §2/§7.1 corrected (reduces risk; cookie only auths page + token fetch).
- **#2 [BLOCKER→fixed]** Chunk-aware proxy presence gate → §5.3 (+ tests).
- **#3 [BLOCKER→fixed]** Launcher base-path preservation → §6.2 (+ tests).
- **#4 [MAJOR→fixed]** Supervisor cookie-name resolution via headers + scan fallback; AUTH_URL doc note → §5.4.
- **#5 [MAJOR→fixed]** Path/name-aware WebView cookie cleanup on sign-out/delete → §6.8.
- **#6 [MINOR→fixed]** Seeder sets `sameSite: Lax` → §6.5.
