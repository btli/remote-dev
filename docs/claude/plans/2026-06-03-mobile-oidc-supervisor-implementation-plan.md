# Mobile OIDC Supervisor Support — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Flutter mobile multi-workspace bootstrap work on an OIDC/Authentik supervisor host (rdv.joyful.house, no Cloudflare Access) without regressing CF hosts (dev.bryanli.net).

**Architecture:** Generalize the app's hard-coded `CF_Authorization` credential into a list of named auth cookies `{name,value,path}`. The two `mobile-callback` routes (identity already resolved CF *or* OIDC) return a CF cookie on CF hosts and the NextAuth session cookie on OIDC hosts. The app replays them on Dio and seeds them into terminal WebViews. Terminal WebSocket stays HMAC-token-based.

**Tech Stack:** Next.js 16 / NextAuth v5 server components + Vitest; Flutter (Dio, flutter_inappwebview, flutter_secure_storage, freezed) + Dart test.

**Design spec:** `docs/claude/plans/2026-06-03-mobile-oidc-supervisor-design.md` (read it; this plan implements it).

**Conventions (NON-NEGOTIABLE):** server logging via `createLogger` (never `console.*`, never log raw cookie values); never disable lint rules / `@ts-ignore`; `bun` not npm; all code changes in a git worktree (`./scripts/worktree-warm.sh` first); commit footer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

**Worktree gates per phase:** TS phases — `bun run typecheck && bun run lint && bun run test:run`. Mobile phases — `cd mobile && dart format . && flutter analyze && flutter test` (if `flutter test` hangs at `_dyld_start`, sample to confirm then proceed per known issue). Run `dart run build_runner build --delete-conflicting-outputs` after editing freezed models.

---

## Task 1: Instance callback — session-cookie extraction helper

**Files:**
- Create: `src/lib/mobile-callback.ts`
- Test: `src/lib/__tests__/mobile-callback.test.ts`
- Reference: `src/lib/auth-cookies.ts:108-114` (`getSessionCookieName`), `src/lib/base-path.ts:60` (`COOKIE_PATH`), `src/lib/auth-utils.ts:76-156` (`getAuthSession`), current `src/app/auth/mobile-callback/page.tsx`.

- [ ] **Step 1: Write failing tests for `collectSessionCookies`**

```ts
// src/lib/__tests__/mobile-callback.test.ts
import { describe, it, expect } from "vitest";
import { collectSessionCookies, encodeAuthCookies } from "@/lib/mobile-callback";

const store = (pairs: [string, string][]) => ({
  getAll: () => pairs.map(([name, value]) => ({ name, value })),
});

describe("collectSessionCookies", () => {
  it("returns the single unchunked cookie at the given path", () => {
    const got = collectSessionCookies(store([["__Secure-rdv-demo-session-token", "abc"]]), "__Secure-rdv-demo-session-token", "/demo");
    expect(got).toEqual([{ name: "__Secure-rdv-demo-session-token", value: "abc", path: "/demo" }]);
  });
  it("collects chunks in numeric order", () => {
    const got = collectSessionCookies(
      store([["__Secure-rdv-demo-session-token.1", "B"], ["__Secure-rdv-demo-session-token.0", "A"]]),
      "__Secure-rdv-demo-session-token", "/demo");
    expect(got.map((c) => c.value)).toEqual(["A", "B"]);
  });
  it("does not substring-match sibling cookies", () => {
    const got = collectSessionCookies(
      store([["__Secure-rdv-demo-session-token", "A"], ["__Secure-rdv-demo-callback-url", "X"]]),
      "__Secure-rdv-demo-session-token", "/demo");
    expect(got).toHaveLength(1);
  });
  it("returns [] when absent", () => {
    expect(collectSessionCookies(store([]), "x", "/")).toEqual([]);
  });
});

describe("encodeAuthCookies", () => {
  it("round-trips via base64url JSON", () => {
    const enc = encodeAuthCookies([{ name: "a", value: "b", path: "/" }]);
    expect(enc).not.toMatch(/[+/=]/);
    expect(JSON.parse(Buffer.from(enc, "base64url").toString())).toEqual([{ name: "a", value: "b", path: "/" }]);
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (`bun run test:run src/lib/__tests__/mobile-callback.test.ts`) — module not found.

- [ ] **Step 3: Implement the helpers**

```ts
// src/lib/mobile-callback.ts
export type AuthCookie = { name: string; value: string; path: string };

export function collectSessionCookies(
  store: { getAll: () => { name: string; value: string }[] },
  cookieName: string,
  path: string,
): AuthCookie[] {
  const chunkRe = new RegExp(`^${escapeRegExp(cookieName)}\\.(\\d+)$`);
  const all = store.getAll();
  const exact = all.find((c) => c.name === cookieName);
  if (exact) return [{ name: exact.name, value: exact.value, path }];
  return all
    .map((c) => ({ c, m: chunkRe.exec(c.name) }))
    .filter((x): x is { c: { name: string; value: string }; m: RegExpExecArray } => x.m !== null)
    .sort((a, b) => Number(a.m[1]) - Number(b.m[1]))
    .map((x) => ({ name: x.c.name, value: x.c.value, path }));
}

export function encodeAuthCookies(cookies: AuthCookie[]): string {
  return Buffer.from(JSON.stringify(cookies)).toString("base64url");
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
```

- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit** — `feat(mobile-callback): add session-cookie collection + base64url encode helper`.

---

## Task 2: Instance callback — `resolveInstanceMobileCallback` + thin page

**Files:**
- Modify: `src/lib/mobile-callback.ts`, `src/app/auth/mobile-callback/page.tsx`
- Test: `src/lib/__tests__/mobile-callback.test.ts`

- [ ] **Step 1: Write failing tests** for `resolveInstanceMobileCallback` covering: (a) CF valid → `redirect` whose URL has `scope=instance`, an `apiKey`, legacy `cfToken`, and `authCookies` decoding to `[{CF_Authorization, <token>, "/"}]`; (b) CF token present but invalid AND no session → `login`; (c) no CF, OIDC session present (single + chunked) → `redirect` with `scope=instance`, `authCookies` from the scoped name, and NO `apiKey`/`cfToken`; (d) nothing → `login`. Mock `next/headers` `cookies`, `validateAccessJWT`, `getAuthSession`, `getOrCreateUserByEmail`, `createApiKey`, `getSessionCookieName`, `COOKIE_PATH` via `vi.mock`.

```ts
// sketch of the OIDC assertion
const res = await resolveInstanceMobileCallback();
expect(res.kind).toBe("redirect");
const u = new URL((res as any).url.replace("remotedev://", "https://x/"));
expect(u.searchParams.get("scope")).toBe("instance");
expect(u.searchParams.get("apiKey")).toBeNull();
expect(JSON.parse(Buffer.from(u.searchParams.get("authCookies")!, "base64url").toString()))
  .toEqual([{ name: "__Secure-rdv-demo-session-token", value: "JWE", path: "/demo" }]);
```

- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement `resolveInstanceMobileCallback`** in `src/lib/mobile-callback.ts`:

```ts
import { cookies } from "next/headers";
import { validateAccessJWT } from "@/lib/cloudflare-access";
import { getAuthSession } from "@/lib/auth-utils";
import { getOrCreateUserByEmail } from "@/lib/user-identity";
import { createApiKey } from "@/services/api-key-service";
import { getSessionCookieName } from "@/lib/auth-cookies";
import { COOKIE_PATH } from "@/lib/base-path";
import { createLogger } from "@/lib/logger";

const log = createLogger("auth/mobile-callback");

export type MobileCallbackResult =
  | { kind: "redirect"; url: string }
  | { kind: "login" }
  | { kind: "error"; message: string };

function deepLink(params: Record<string, string | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v != null && v !== "") q.set(k, v);
  return `remotedev://auth/callback?${q.toString()}`;
}

export async function resolveInstanceMobileCallback(): Promise<MobileCallbackResult> {
  const store = await cookies();
  const cfToken = store.get("CF_Authorization")?.value;
  if (cfToken) {
    const cfUser = await validateAccessJWT(cfToken);
    if (cfUser) {
      const user = await getOrCreateUserByEmail(cfUser.email);
      const apiKey = (await createApiKey(user.id, "Mobile App")).key;
      log.info("Mobile API key issued via callback (CF)", { userId: user.id });
      return { kind: "redirect", url: deepLink({
        scope: "instance", apiKey, cfToken,
        authCookies: encodeAuthCookies([{ name: "CF_Authorization", value: cfToken, path: "/" }]),
        userId: user.id, email: user.email ?? "",
      }) };
    }
  }
  const session = await getAuthSession();
  if (session?.user?.id) {
    const name = getSessionCookieName();
    const authCookies = collectSessionCookies(store, name, COOKIE_PATH);
    if (authCookies.length > 0) {
      log.info("Mobile session credential issued via callback (OIDC)", { userId: session.user.id });
      return { kind: "redirect", url: deepLink({
        scope: "instance", authCookies: encodeAuthCookies(authCookies),
        userId: session.user.id, email: session.user.email ?? "",
      }) };
    }
    log.warn("OIDC session resolved but session cookie not found in store", { name });
  }
  return { kind: "login" };
}
```

- [ ] **Step 4: Rewrite the page as a thin wrapper:**

```tsx
// src/app/auth/mobile-callback/page.tsx
export const dynamic = "force-dynamic";
import { redirect } from "next/navigation";
import { prefixPath } from "@/lib/base-path";
import { resolveInstanceMobileCallback } from "@/lib/mobile-callback";

export default async function MobileCallbackPage() {
  const result = await resolveInstanceMobileCallback();
  if (result.kind === "redirect") redirect(result.url);
  if (result.kind === "login")
    redirect(prefixPath(`/login?callbackUrl=${encodeURIComponent(prefixPath("/auth/mobile-callback"))}`));
  return <ErrorPage message={result.message} />;
}
// keep the existing ErrorPage component
```

> Confirm `prefixPath` exists in `src/lib/base-path.ts` (grep showed `prefixPath` at :75). If `redirect` to login conflicts with proxy behavior, fall back to rendering `ErrorPage` with a "please sign in" message.

- [ ] **Step 5: Run tests — expect PASS.** Then **gate**: `bun run typecheck && bun run lint && bun run test:run`.
- [ ] **Step 6: Commit** — `feat(mobile-callback): resolve OIDC session credential for instance callback`.

---

## Task 3: Chunk-aware proxy presence gate (Codex blocker #2)

**Files:**
- Modify: `src/lib/auth-cookies.ts` (extend candidate matching) **or** `src/proxy.ts:126`
- Test: `src/__tests__/proxy.test.ts`
- Reference: `src/proxy.ts:124-126`, `src/lib/auth-cookies.ts:140-149`.

- [ ] **Step 1: Write failing proxy test** — a scoped request bearing only `__Secure-rdv-<slug>-session-token.0` (and `.1`) is treated as logged-in (not redirected to `/login`); a request with the exact base name still passes; the **unscoped** single-server path is unchanged.

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement.** Prefer a pure helper in `auth-cookies.ts` so logic is testable without the proxy:

```ts
// src/lib/auth-cookies.ts — add:
export function hasSessionCookie(cookieNames: string[]): boolean {
  const candidates = getSessionCookieNameCandidates();
  return cookieNames.some((n) => candidates.some((c) => n === c || new RegExp(`^${c.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}\\.\\d+$`).test(n)));
}
```
Then in `src/proxy.ts` replace the `candidates.some((name) => request.cookies.has(name))` line with `hasSessionCookie(request.cookies.getAll().map((c) => c.name))`. Keep the unscoped branch untouched.

- [ ] **Step 4: Run — expect PASS.** Gate: typecheck + lint + test:run.
- [ ] **Step 5: Commit** — `fix(proxy): treat chunked session cookies as present in scoped gate`.

---

## Task 4: Supervisor callback — OIDC credential + robust cookie name (Codex #4)

**Files:**
- Create: `apps/supervisor/src/lib/mobile-callback.ts`
- Modify: `apps/supervisor/src/app/auth/mobile-callback/page.tsx`
- Test: extend `apps/supervisor/src/app/auth/mobile-callback/__tests__/page.test.tsx`
- Reference: `apps/supervisor/src/lib/auth.ts:60-99` (`resolveAuthenticatedEmail`, `resolveSupervisorUser`), `apps/supervisor/src/lib/session-cookie.ts:57-62`, current supervisor page.

- [ ] **Step 1: Write failing tests** — extend the existing supervisor callback test: CF path still emits `scope=host` + `cfToken` + new `authCookies=[CF@/]`; **OIDC** path (CF absent, `resolveAuthenticatedEmail` returns an email, session cookie present, single + chunked) emits `scope=host` + `authCookies=[{<name>, value, "/"}]` and no `cfToken`; unauthenticated → `login`.

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement `resolveSupervisorMobileCallback`** mirroring Task 2 but: identity via `resolveAuthenticatedEmail(request?)` + `resolveSupervisorUser`; path `"/"`; cookie name via a `resolveSessionCookieName()` that (1) derives scheme from `headers()` `x-forwarded-proto`, passing `{ headers }` to `getSessionCookieName(request)`, and (2) if that name is absent in the store, scans for the first cookie matching `^(__Secure-|__Host-)?authjs[.-]session-token(\.\d+)?$` and uses its base name. Reuse `collectSessionCookies`/`encodeAuthCookies` (duplicate the tiny helpers into the supervisor lib — the apps don't share a module). Page becomes a thin wrapper identical in shape to Task 2 (supervisor `redirect`/`login`/`ErrorPage`).

- [ ] **Step 4: Run — expect PASS.** Gate (run in `apps/supervisor`): `bun run typecheck && bun run lint && bun run test`.
- [ ] **Step 5: Commit** — `feat(supervisor): resolve OIDC session credential for mobile host callback`.

---

## Task 5: Mobile — `AuthCookie` model + decode

**Files:**
- Create: `mobile/lib/domain/auth_cookie.dart`, `mobile/test/domain/auth_cookie_test.dart`
- Reference: existing freezed models in `mobile/lib/domain/` for boilerplate.

- [ ] **Step 1: Write failing test** for a `decodeAuthCookies(String)` that base64url-decodes a JSON list into `List<AuthCookie>`, returns `[]` for malformed/empty input, and preserves order.
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement** freezed `AuthCookie {name,value,path}` + `decodeAuthCookies` (use `base64Url.decode` with padding normalization; wrap in try/catch → `[]`). Run `dart run build_runner build --delete-conflicting-outputs`.
- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit** — `feat(mobile): add AuthCookie model + base64url decode`.

---

## Task 6: Mobile — launcher parse precedence + base-path fix (Codex blocker #3)

**Files:**
- Modify: `mobile/lib/infrastructure/auth/mobile_callback_login_launcher.dart`
- Test: `mobile/test/infrastructure/auth/mobile_callback_login_launcher_test.dart` (extend/create)
- Reference: `_awaitCallback` at lines ~258-260; `parseMobileCallback`; `HostCallback`/`InstanceCallback`.

- [ ] **Step 1: Write failing tests:**
  - `parseMobileCallback`: `scope=host` → HostCallback with decoded `authCookies`; `scope=instance` (no apiKey) → InstanceCallback with `authCookies`, `apiKey==null`; legacy no-scope + `apiKey` → InstanceCallback (authCookies from `cfToken`); legacy no-scope no-apiKey → HostCallback (authCookies from `cfToken`); malformed `authCookies` → `[]`.
  - Base-path construction (extract the URL builder into a testable `buildCallbackUrl(Uri base)`): host root `https://h` → `https://h/auth/mobile-callback`; workspace `https://h/demo` → `https://h/demo/auth/mobile-callback`; trailing slash `https://h/demo/` → `.../demo/auth/mobile-callback`.
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement.** Add `authCookies` to both callback variants + `apiKey?` to InstanceCallback; rewrite `parseMobileCallback` with scope-authoritative precedence + legacy `cfToken` synthesis. Extract and fix the URL builder:

```dart
Uri buildCallbackUrl(Uri base) {
  final trimmed = base.path.replaceFirst(RegExp(r'/+$'), '');
  return base.replace(path: '$trimmed/auth/mobile-callback');
}
```
Replace `baseUrl.replace(path: '/auth/mobile-callback')` with `buildCallbackUrl(baseUrl)`. Ensure `loginHost`/`login` return the new cookie lists.

- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit** — `fix(mobile): preserve workspace base path in callback URL + parse authCookies`.

---

## Task 7: Mobile — credentials store (authCookies + read-compat)

**Files:**
- Modify: `mobile/lib/infrastructure/auth/mobile_credentials.dart`
- Test: `mobile/test/infrastructure/auth/mobile_credentials_test.dart`
- Reference: store namespaces `host.<id>` / `workspace.<id>` and legacy keys.

- [ ] **Step 1: Write failing tests:** `setHostAuthCookies`/`getHostAuthCookies` round-trip JSON; `getHostAuthCookies` falls back to legacy `host.<id>.cfToken` → `[{CF_Authorization,…,"/"}]`; same for workspace; `apiKey` still stored/read.
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement** the new keys + read-compat fallbacks + an `AuthMaterial{List<AuthCookie> cookies; String? apiKey}` value type (or place `AuthMaterial` where it's consumed — keep one definition).
- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit** — `feat(mobile): store/read named auth cookies with legacy fallback`.

---

## Task 8: Mobile — interceptor + discovery + workspace client

**Files:**
- Modify: `mobile/lib/infrastructure/api/cf_auth_interceptor.dart`, `mobile/lib/infrastructure/api/instances_api.dart`, `mobile/lib/infrastructure/api/remote_dev_client.dart`
- Test: `mobile/test/infrastructure/api/cf_auth_interceptor_test.dart`
- Reference: current `onRequest` (Bearer + Cookie merge); `AuthMaterial` usage.

- [ ] **Step 1: Write failing tests:** interceptor attaches a single `Cookie:` header joining multiple `AuthCookie`s (`a=1; b=2`), merges with an existing Cookie header, and sets `Authorization: Bearer` only when `apiKey` non-empty; with empty cookies + null apiKey, no auth headers added.
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement** `AuthMaterial{cookies,apiKey}` threading: interceptor joins cookies; `instances_api` uses host cookies (`apiKey:null`); `remote_dev_client.forWorkspace` uses workspace cookies + apiKey.
- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit** — `refactor(mobile): drive Dio auth from AuthMaterial cookie list`.

---

## Task 9: Mobile — seeder (multi-cookie + SameSite + delete) & cleanup wiring (Codex #5, #6)

**Files:**
- Modify: `mobile/lib/infrastructure/webview/webview_cookie_seeder.dart`, `mobile/lib/presentation/screens/profile/account_screen.dart`, `mobile/lib/presentation/screens/server_picker/server_picker_screen.dart`, `mobile/lib/infrastructure/storage/host_workspace_store_impl.dart`
- Test: `mobile/test/infrastructure/webview/webview_cookie_seeder_test.dart` (where mockable) + a store/cleanup test.

- [ ] **Step 1: Write failing tests** (where the platform CookieManager is injectable/mockable): `seedAuthCookies` calls `setCookie` once per cookie with that cookie's `path`, `isSecure:true`, `isHttpOnly:true`, `sameSite: Lax`; `deleteAuthCookies` deletes each by name+path. Store test: `removeWorkspace` triggers deletion of that workspace's WebView cookies and secure-storage entries, and leaves sibling workspaces intact.
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement** `seedAuthCookies(origin, List<AuthCookie>)` + `deleteAuthCookies(origin, List<AuthCookie>)` (add `sameSite: HTTPCookieSameSitePolicy.LAX`). Update the screens that previously seeded `CF_Authorization` to seed the **workspace** auth cookies. Wire `removeWorkspace`/sign-out to delete that workspace's cookies (incl. chunks) regardless of siblings; delete host cookies only on last removal.
- [ ] **Step 4: Run — expect PASS.** Mobile gate: `dart format . && flutter analyze && flutter test`.
- [ ] **Step 5: Commit** — `feat(mobile): seed/delete per-workspace auth cookies in WebView (SameSite=Lax)`.

---

## Task 10: Docs + CHANGELOG

**Files:** `CHANGELOG.md`, `docs/AGENTS.md` / `docs/MULTI_INSTANCE.md` / `docs/MOBILE_ARCHITECTURE.md` (auth notes), `docs/SUPERVISOR_DEPLOY.md` (`AUTH_URL=https://<host>` when OIDC enabled).

- [ ] **Step 1:** Add `[Unreleased]` CHANGELOG entries (Added: OIDC supervisor support for mobile; Fixed: workspace base-path in callback URL, chunked-cookie proxy gate, WebView cookie cleanup on workspace removal). Update the touched docs. Commit — `docs: OIDC mobile supervisor support + AUTH_URL note`.

---

## Task 11: Ship + homelab deploy + on-device E2E

- [ ] **Step 1:** From the worktree, run the full TS gate (`bun run typecheck && bun run lint && bun run build && bun run test:run`) and the mobile gate. Move the spec + this plan into the branch so they ship with the PR.
- [ ] **Step 2:** `/ship` (PR → review → merge → auto-deploy dev.bryanli.net → canary). CF canary 302s are expected.
- [ ] **Step 3:** Homelab: rebuild supervisor + instance images via the **Forgejo** pipeline (NOT GitHub) → Harbor → ArgoCD rollout; confirm `AUTH_URL=https://rdv.joyful.house` on the supervisor. Confirm rollout green before E2E.
- [ ] **Step 4:** Build the debug APK (`flutter build apk --debug`; Android SDK `/opt/homebrew/share/android-commandlinetools`), install on the Pixel, and E2E: add rdv.joyful.house → OIDC login → discover instances → add workspace → REST → open terminal (assert token fetch + WS connect). Capture adb logcat.
- [ ] **Step 5:** Close remote-dev-8erx (`--reason="Shipped in PR #NNN"`), `bd dolt push`, file any follow-ups (deep-link PKCE state).

---

## Final review
After all tasks: dispatch a final code-review subagent across the whole diff (TS + Dart). Then `superpowers:finishing-a-development-branch`.
