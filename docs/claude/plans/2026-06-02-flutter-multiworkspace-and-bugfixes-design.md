# Flutter Mobile: Multi‑Workspace Connectivity + Two Bug Fixes — Design

- **Date:** 2026-06-02
- **Branch:** `feat/mobile-multiworkspace`
- **App in scope:** `mobile/` (Flutter/Dart) only. **Not** `packages/mobile/` (Expo/RN).
- **Status:** Draft for review

## 1. Summary

Update the Flutter app so a single connection can be **either** a plain single‑workspace
server (today's behaviour) **or** a multi‑instance **Supervisor host** that serves several
path‑prefixed workspaces (e.g. `https://rdv.joyful.house/demo`, `/alpha`). The app will
**auto‑discover** workspaces under a host via `GET /api/instances`, let the user pick one,
and route all API / WebView / cookie traffic under the selected workspace's base path.

Bundled with this, two bugs (which touch the same screens/router) are fixed:

1. **Back does nothing when the app is opened from a notification.**
2. **The session header shows the session UUID instead of its name.**

## 2. Goals / Non‑Goals

**Goals**
- Connect to a multi‑instance Supervisor host and switch between its workspaces in‑app.
- Preserve the existing single‑server experience byte‑for‑byte (base path = `""`).
- Auto‑discover workspaces via the Supervisor `/api/instances` endpoint.
- Fix the two bugs above.
- No regression for users with existing saved servers (migrate them automatically).

**Non‑Goals / Assumptions**
- **Cloudflare Access is in front of the host.** The existing mobile login already depends
  on `CF_Authorization` (the instance `mobile-callback` reads it). OIDC‑only hosts with **no**
  CF Access in front are out of scope for discovery.
- No changes to `packages/mobile/` (Expo app).
- No WebSocket work in the app — the WebView page opens the WS and the server is already
  base‑path aware (`WS_PATH_PREFIX`).
- **One server‑side change** is in scope: a Supervisor `/auth/mobile-callback` route (§6.1).
  A second tidy (`withApiAuth` for `GET /api/sessions/[id]`, §9) remains optional/out of scope.

## 3. Verified Facts (from research)

| Fact | Evidence |
|---|---|
| App already stores **multiple servers** w/ per‑server credentials + active switching | `mobile/lib/domain/server_config.dart`, `.../infrastructure/storage/server_config_store_impl.dart`, `.../presentation/screens/server_picker/` |
| App has **no base‑path support**; Dio paths are absolute (`/api/...`) so `https://host/demo` + `/api/sessions` resolves to `https://host/api/sessions` (drops `/demo`) | `mobile/lib/infrastructure/api/remote_dev_client.dart` |
| WebView URLs are hard‑coded `/m/session/<id>`, `/m/channel/<id>`, `/m/recording/<id>` | `session_route_host.dart`, `session_view_screen.dart`, `channel_screen.dart`, `recording_screen.dart` |
| App never opens a WS directly (no `ws://`/`wss://` in `mobile/`) | grep of `mobile/` |
| **CF Access cookie is host‑wide**; **API keys are per‑instance** (each instance has its own SQLite DB) | `src/app/auth/mobile-callback/page.tsx`, `src/services/api-key-service.ts`, `src/db/schema.ts` (api_key) |
| Supervisor `GET /api/instances` authorizes on the **host‑wide CF cookie** (viewer role by email); it has **no** API keys and **no** mobile‑callback | `apps/supervisor/src/app/api/instances/route.ts`, `apps/supervisor/src/lib/auth.ts` |
| Per‑instance API key minted by `{host}/{slug}/auth/mobile-callback` → `remotedev://auth/callback?apiKey=…&cfToken=…` | `src/app/auth/mobile-callback/page.tsx` |
| `GET /api/sessions/[id]` returns the full session incl. `name`, but is wrapped in `withAuth` (session/CF cookie only), **not** `withApiAuth` (so a bare Bearer key won't authorize it) | `src/app/api/sessions/[id]/route.ts`, `src/lib/api.ts` |
| Notification taps + deep links navigate via `AppRouter.navigateTo()` → `GoRouter.go()` which **replaces** the stack (no back target) | `app_router.dart`, `notification_tap_handler.dart`, `app_link_listener.dart` |
| Session header hard‑codes `_sessionName = widget.sessionId` ("Phase 2 placeholder"), never resolves the real name | `session_view_screen.dart`, `session_status_bar.dart` |

## 4. Architecture

### 4.1 Domain model — Host → Workspace hierarchy

Introduce two domain entities (replacing the flat `ServerConfig` role):

```
HostConfig {
  id: String            // uuid
  label: String         // user-facing, e.g. "Joyful House"
  origin: String        // scheme://host[:port] — NO path
  kind: HostKind        // singleWorkspace | multiWorkspace (detected)
  createdAt, lastUsedAt: DateTime
}

WorkspaceConfig {
  id: String            // uuid (stable per host+slug)
  hostId: String        // -> HostConfig.id
  slug: String          // "" for a single-workspace host
  basePath: String      // "" or "/<slug>"
  displayName: String   // from /api/instances displayName, else label
  status: String?       // last-known instance status (ready/…); null for single
  lastUsedAt: DateTime
}
```

- **CF token (host‑wide)** is stored per **host** (`hostId`).
- **API key (per‑instance)** is stored per **workspace** (`workspaceId`).
- A **single‑workspace server** = one `HostConfig` (kind=singleWorkspace) + exactly one
  `WorkspaceConfig` with `slug=""`, `basePath=""`. This is the migration target for every
  existing saved server, so current users are unaffected.

### 4.2 Storage & migration

Extend the storage layer (`application/ports/` + `infrastructure/storage/`):

- New `HostWorkspaceStore` (port) persisting:
  - `hosts` → JSON list of `HostConfig`
  - `workspaces` → JSON list of `WorkspaceConfig`
  - `active_workspace_id`
- `MobileCredentialsStore` keys: CF token under `host.<hostId>.cfToken`; API key under
  `workspace.<workspaceId>.apiKey`. (Generalises today's per‑server namespacing.)
- **Migration (one‑time, on first launch post‑update):** read legacy `servers` +
  `active_server_id` + per‑server credentials. For each legacy `ServerConfig`:
  1. Create a `HostConfig` (origin = origin of `server.url`, label = `server.label`,
     kind=singleWorkspace). Move `cfToken` → host.
  2. Create one `WorkspaceConfig` (slug = path of `server.url` if any else `""`,
     basePath set accordingly, displayName = label). Move `apiKey` → workspace.
  3. Map `active_server_id` → `active_workspace_id`.
  Delete legacy keys after a successful migration. Idempotent + guarded by a
  `schema_version` flag so a half‑migration can resume.

### 4.3 Providers / DI

- `activeWorkspaceProvider` (replaces `activeServerProvider`) resolves the active
  `WorkspaceConfig` **and** its `HostConfig`.
- `_apiClientProvider` builds the Dio client from `{host.origin, workspace.basePath}` and
  injects auth headers: `Authorization: Bearer <workspace.apiKey>` + `Cookie:
  CF_Authorization=<host.cfToken>`. Invalidating the active workspace rebinds every
  downstream `*Api` provider (same pattern as today).

### 4.4 Request construction (base‑path)

Centralise base‑path joining in **one** place rather than sprinkling it:

- `RemoteDevClient` keeps `baseUrl = host.origin` and prepends `workspace.basePath` to every
  request path through a single private `_path(p)` helper (`'$basePath$p'`). All `*_api.dart`
  callers keep passing `/api/...` and get correct prefixing for free.
- A small `WorkspaceUrls` helper builds WebView URLs: `webPath(p) => '$origin$basePath$p'`
  used for `/m/session/<id>`, `/m/channel/<id>`, `/m/recording/<id>`, and the GitHub link URL.
- `NavigationPolicy` receives `basePath` and allows `'$basePath/m/...'` prefixes.

## 5. Auth & connection flows

### 5.1 Add a host + discovery (multi‑workspace)

**Chosen bootstrap: a new Supervisor `/auth/mobile-callback`** (server addition, §6.1) so the
existing, proven **system‑browser** deep‑link flow handles discovery too — one auth mechanism
across host and instances.

1. User enters host **origin** + label in `AddHostScreen` (generalises `AddServerScreen`).
2. **Bootstrap the host CF token:** drive the system browser to `{origin}/auth/mobile-callback`
   (the new Supervisor route). It validates the CF Access cookie (or Supervisor OIDC session),
   then redirects to `remotedev://auth/callback?scope=host&cfToken=…&email=…&userId=…` — note
   **no `apiKey`** (the Supervisor has none). The app stores `cfToken` on the host.
3. **Detect kind:** `GET {origin}/api/instances` with the CF cookie.
   - **200 + `{instances:[…]}`** → `kind=multiWorkspace`. Show `WorkspacePickerScreen` listing
     instances; `status=='ready'` are selectable, others shown disabled with their status.
   - **404 / not a supervisor** → `kind=singleWorkspace`; fall through to §5.3.
4. **Open selected workspace(s):** for each chosen `slug`, mint the per‑instance API key by
   driving the system browser to `{origin}/{slug}/auth/mobile-callback` and capturing
   `remotedev://auth/callback?apiKey=…&cfToken=…` (the **existing** instance route, unchanged).
   CF Access is already satisfied in the OS browser session, so this is immediate. Persist a
   `WorkspaceConfig` + its API key; refresh the host CF token from the returned `cfToken`.

The app distinguishes the two callbacks by `scope=host` / absence of `apiKey` (host bootstrap)
vs presence of `apiKey` (instance); the deep‑link parser + `mobile_callback_login_launcher`
handle both shapes.

### 5.2 Activate / switch a workspace

Selecting a workspace sets `active_workspace_id`, invalidates `activeWorkspaceProvider`, and
all `*Api` providers rebind to the new `{origin, basePath, apiKey, cfToken}`. A switcher is
exposed in the workspace picker and the app bar overflow.

### 5.3 Single‑workspace server (back‑compat)

Unchanged behaviour: `AddHostScreen` detects a non‑supervisor origin, creates a host
(kind=singleWorkspace) + one workspace (`basePath=""`), and runs the **existing**
system‑browser `{origin}/auth/mobile-callback` flow to mint the API key. Migrated legacy
servers are exactly this shape.

### 5.4 Re‑auth / refresh

`CfAuthInterceptor`'s silent‑refresh keeps working per host: a 401/403 re‑runs the
host login (WebView/​system‑browser as appropriate) and refreshes the host CF token and, when
needed, the workspace API key. Genuine failure routes to `/reauth`.

## 6. Base‑path threading — change inventory

| Site | File (symbol) | Change |
|---|---|---|
| Dio path build | `infrastructure/api/remote_dev_client.dart` | prepend `basePath` via `_path()` in get/post/patch/delete |
| Health/probe | `screens/server_picker/add_server_screen.dart` (`defaultHealthProbe`) | probe `{origin}{basePath}/api/config`; read back `basePath`/`instanceSlug` |
| Session WebView | `screens/webview_host/session_route_host.dart`; `screens/session_view/session_view_screen.dart` | `{origin}{basePath}/m/session/<id>` |
| Channel WebView | `screens/channels/channel_screen.dart` | `{origin}{basePath}/m/channel/<id>` |
| Recording WebView | `screens/recording/recording_screen.dart` | `{origin}{basePath}/m/recording/<id>` |
| Nav allowlist | `*_screen.dart` + `navigation_policy.dart` | allow `'$basePath/m/...'` |
| GitHub link | `screens/.../github_accounts_screen.dart` | base‑path‑aware link URL |
| Cookie seed | `infrastructure/webview/webview_cookie_seeder.dart` | seed CF cookie for `origin` (host‑wide); rely on server for path‑scoped session cookie |
| Discovery | **new** `infrastructure/api/instances_api.dart` + `domain/workspace.dart` | `GET {origin}/api/instances` |
| Host bootstrap | `infrastructure/auth/mobile_callback_login_launcher.dart` + deep‑link parser | handle `scope=host` callback (cfToken, no apiKey) |

### 6.1 Server‑side change (Supervisor)

New route `apps/supervisor/src/app/auth/mobile-callback/page.tsx`, mirroring the instance
route `src/app/auth/mobile-callback/page.tsx` **minus** API‑key minting:
- Resolve the caller via the Supervisor auth helpers (`resolveAuthenticatedEmail` /
  `withSupervisorAuth` in `apps/supervisor/src/lib/auth.ts`) — CF Access cookie **or**
  Supervisor OIDC session.
- Redirect to `remotedev://auth/callback?scope=host&cfToken=<CF_Authorization>&email=…&userId=…`.
- No new dependencies; ~30 LoC. Requires a Supervisor typecheck/build + a focused test.

## 7. Discovery + workspace picker UI

- **`WorkspacePickerScreen`** — lists a host's workspaces (display name, slug, status chip).
  Ready → tap to activate/open; non‑ready → disabled with status. Pull‑to‑refresh re‑queries
  `/api/instances`.
- **Host list** — the existing server picker becomes a **host** picker; expanding a host shows
  its workspaces (the chosen hierarchy). Single‑workspace hosts open directly.
- Empty/error states: not‑a‑supervisor, zero ready instances, CF login cancelled, network error.

## 8. Bug fix 1 — back from notification does nothing

**Cause:** `AppRouter.navigateTo()` → `GoRouter.go()` replaces the whole stack; notification
taps (`notification_tap_handler.dart`) and deep links (`app_link_listener.dart`) use it, so
there is no route to pop.

**Fix:** route notification/deep‑link navigation so a back target always exists:
- Ensure the home shell (`/home`) is on the stack, then `push()` the target (session/channel),
  so **back lands on the sessions list** for both cold and warm starts.
- Implement as an explicit `navigateDeepLink(route)` on `AppRouter` (go `/home` if not already
  rooted there, then `push` the target) and call it from both handlers. Keep `go()` for
  auth/server‑selection resets. Add a regression test asserting `canPop()` is true after a
  simulated notification tap from a cold start.

## 9. Bug fix 2 — session header shows the UUID

**Cause:** `session_view_screen.dart` sets `_sessionName = widget.sessionId` and never
resolves the real name; all entry points pass only the id.

**Fix (client‑only, robust for every entry point):**
- **From the list:** pass the full `SessionSummary` via GoRouter `extra` when pushing
  `/home/session/<id>` (the list already holds `name`) → header shows the name immediately,
  no fetch, no flicker.
- **From notification / deep link (id only):** resolve the name by calling
  `SessionsApi.list()` (which uses `withApiAuth`, so the mobile Bearer key works) and finding
  the id. While resolving, show a neutral placeholder ("Session"), **never** the raw UUID.
- `SessionViewScreen` accepts an optional `SessionSummary?`; uses it if present, else resolves.
- **Optional server tidy (out of scope, noted):** switch `GET /api/sessions/[id]` from
  `withAuth` → `withApiAuth` to match its sibling list/POST handlers, enabling a direct
  fetch‑by‑id. Not required for this fix; tracked as a follow‑up.

## 10. Testing strategy

- **Unit:** base‑path joining (`_path`/`WorkspaceUrls`) incl. `""`, `/demo`, trailing‑slash
  edge cases; storage migration (legacy server → host+workspace, incl. URL with a path);
  `/api/instances` parsing + status filtering.
- **Widget:** `navigateDeepLink` leaves `canPop()==true` from a cold start; session header
  renders `name` from `extra` and resolves from `list()` when id‑only.
- **Static:** `flutter analyze` must be clean.
- **Caveat:** `flutter test` may hang at `_dyld_start` on this Mac (known quarantine issue).
  If it hangs, capture a sample to confirm, then rely on `flutter analyze` + manual/device
  verification rather than blocking on the local test gate. Do **not** disable lints.

## 11. Rollout, migration, risks

- **Migration** runs once, guarded by a schema‑version flag; failure leaves legacy keys intact
  and surfaces a non‑destructive error. Existing users keep their single connection.
- **Risk — Supervisor route auth modes (§6.1).** The new `/auth/mobile-callback` must resolve a
  caller under both CF Access (cookie) and Supervisor OIDC (session) and return a usable
  host CF token. Typecheck/build the Supervisor app, test both paths, and validate end‑to‑end
  against `rdv.joyful.house`.
- **Risk — base‑path leakage.** Any missed URL site silently drops the prefix → 404s under a
  workspace. The change inventory (§6) is the checklist; a grep gate for hard‑coded `/m/` and
  absolute `/api/` in `mobile/` guards regressions.
- **Risk — host CF token freshness.** The CF JWT expires; the host bootstrap is re‑runnable and
  `CfAuthInterceptor` re‑triggers it on 401/403.

## 12. Out of scope / future

- OIDC‑only hosts with **no** CF Access in front; the Expo app; QR‑onboarding (separate branch
  `issue-177-flutter-qr-onboarding`); the optional `withApiAuth` tidy for
  `GET /api/sessions/[id]` (§9).

## 13. Work breakdown (→ bd issues / subagents)

1. **Domain + storage + migration** (Host/Workspace models, `HostWorkspaceStore`, credentials,
   one‑time migration, providers). *Foundational — lands first.*
2. **Base‑path plumbing** (Dio `_path`, `WorkspaceUrls`, WebView URLs, nav policy, probe).
3. **Supervisor `/auth/mobile-callback`** (server‑side, §6.1) + the app's `scope=host`
   deep‑link handling. *Independent of the Dart base‑path work; gates discovery.*
4. **Discovery + picker UI** (`instances_api`, `Workspace` model, `AddHostScreen`,
   `WorkspacePickerScreen`, host bootstrap, per‑instance key minting). Depends on 1–3.
5. **Bug 1** (router deep‑link back stack) — small, parallelisable.
6. **Bug 2** (session name resolution) — small, parallelisable.

Items 5 & 6 are independent of 1–4 and can run in parallel; 2 depends on 1; 4 depends on 1–3.
The Supervisor route (3) can be built in parallel with 1–2.
