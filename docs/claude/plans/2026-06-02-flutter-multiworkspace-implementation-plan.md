# Flutter Multi‑Workspace + Bug Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let one Flutter connection target either a single‑workspace server or a multi‑instance Supervisor host (auto‑discover + switch path‑prefixed workspaces), and fix the notification back‑stack and UUID‑header bugs.

**Architecture:** Introduce a `Host → Workspace` hierarchy (host owns the host‑wide CF token; each workspace owns a slug/basePath + per‑instance API key). Centralise base‑path joining in the Dio client + a `WorkspaceUrls` helper. Discovery uses a new Supervisor `/auth/mobile-callback` (host CF token) + `GET /api/instances`, reusing the existing system‑browser deep‑link flow. Existing saved servers auto‑migrate to one host + one `basePath=""` workspace.

**Tech Stack:** Flutter/Dart, Riverpod, Dio, go_router, flutter_inappwebview, flutter_secure_storage, freezed/json_serializable; Next.js/TypeScript (`apps/supervisor`).

**Design spec:** `docs/claude/plans/2026-06-02-flutter-multiworkspace-and-bugfixes-design.md`

---

## Conventions (read first)

- **Worktree:** all work happens in this worktree (`.worktrees/mobile-multiworkspace`, branch `feat/mobile-multiworkspace`). Do not edit the main checkout.
- **Read before writing:** every task says which files to read. Open the *current* code and follow neighbouring patterns (naming, freezed usage, Riverpod providers, test style). Line numbers in the spec are anchors, not ground truth.
- **Tests / TDD:**
  - Dart: prefer test‑first. Run a single test with `cd mobile && flutter test test/<path>_test.dart`. **Caveat:** `flutter test` may hang at `_dyld_start` on this Mac (quarantine). If a run shows 0% CPU for >60s, `sample <pid>` to confirm, then kill it and rely on `flutter analyze` + the logic being trivially correct. Never disable lints to get green.
  - `cd mobile && flutter analyze` must be clean after every task.
  - TS (supervisor): `cd apps/supervisor && bun run typecheck` (and `bun test <file>` if a test exists). Use the repo's package manager (`bun`), never npm.
- **Codegen:** models use freezed/json_serializable. After editing a `@freezed`/`@JsonSerializable` class run `cd mobile && dart run build_runner build --delete-conflicting-outputs`.
- **Commits:** small and frequent, one per step group. Commit message footer:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- **Logging:** server‑side TS uses `createLogger` (no `console.*`). Client Dart may use `debugPrint`/existing logging.
- **No base‑path leakage gate:** after Tasks B/D, `grep -rnE "'/m/|\"/api/" mobile/lib` should show only the centralised helpers constructing those, not scattered literals.

## File structure map

**Create (Dart):**
- `mobile/lib/domain/host_config.dart` — `HostConfig` freezed model.
- `mobile/lib/domain/workspace_config.dart` — `WorkspaceConfig` freezed model.
- `mobile/lib/domain/instance_summary.dart` — discovery DTO from `/api/instances`.
- `mobile/lib/application/ports/host_workspace_store.dart` — store port.
- `mobile/lib/infrastructure/storage/host_workspace_store_impl.dart` — store impl + migration.
- `mobile/lib/infrastructure/api/instances_api.dart` — `GET /api/instances`.
- `mobile/lib/infrastructure/url/workspace_urls.dart` — web/WS URL builder.
- `mobile/lib/presentation/screens/host_picker/add_host_screen.dart` — generalises add‑server.
- `mobile/lib/presentation/screens/host_picker/workspace_picker_screen.dart` — workspace list.
- Tests under `mobile/test/...` mirroring the above.

**Modify (Dart):** `remote_dev_client.dart`, `mobile_credentials.dart`, `cf_auth_interceptor.dart`, `mobile_callback_login_launcher.dart`, `app_link_listener.dart` + deep‑link parser, `app_router.dart`, `notification_tap_handler.dart`, `session_view_screen.dart`, `session_route_host.dart`, `channel_screen.dart`, `recording_screen.dart`, `navigation_policy.dart`, `sessions_tab_screen.dart`, `sessions_api.dart`, `main.dart`, `add_server_screen.dart` (probe), `github_accounts_screen.dart`, server picker screens, `app.dart`.

**Create (TS):** `apps/supervisor/src/app/auth/mobile-callback/page.tsx` (+ test if a sibling pattern exists).

---

## Task E: Bug 1 — back from notification (independent, do first)

**Files:**
- Read: `mobile/lib/presentation/router/app_router.dart`, `app_route.dart`, `notification_tap_handler.dart`, `infrastructure/deep_link/app_link_listener.dart`, `presentation/screens/shell/home_shell.dart`.
- Modify: `app_router.dart` (+ both handlers).
- Test: `mobile/test/presentation/router/app_router_deeplink_test.dart`.

**Locked interface (add to `AppRouter`):**
```dart
/// Navigate to a deep-linked target (notification/app-link) such that a back
/// target always exists: root at /home, then push the target.
void navigateDeepLink(AppRoute route) {
  final loc = route.toPath();
  if (loc == const AppRoute.home().toPath()) {
    _config.go(loc);
    return;
  }
  // Ensure the home shell is beneath the target so back returns to it.
  _config.go(const AppRoute.home().toPath());
  _config.push(loc);
}
```

- [ ] **Step 1 — Failing test.** Assert that after `navigateDeepLink(AppRoute.session('s1'))` from a cold start (`initialLocation: '/servers'` with an active workspace), the router can pop (a `/home` route sits beneath `/home/session/s1`). Use the existing router test setup (read any `*_router*_test.dart` for the harness; if none, build a minimal `GoRouter` with the app's routes and assert on `canPop()` / `routerDelegate.currentConfiguration` matches length ≥ 2).
- [ ] **Step 2 — Run, expect fail** (`navigateDeepLink` undefined). If `flutter test` hangs, confirm via `sample`, then proceed (the change is mechanical).
- [ ] **Step 3 — Implement** `navigateDeepLink` as above. In `notification_tap_handler.dart` and `app_link_listener.dart`, replace the `router.navigateTo(<session|channel|notifications target>)` calls with `router.navigateDeepLink(...)`. Keep `navigateTo`/`go()` for auth/server‑reset paths.
- [ ] **Step 4 — Run, expect pass.** Then `cd mobile && flutter analyze`.
- [ ] **Step 5 — Commit:** `fix(mobile): back works when opened from a notification (root home then push)`

> If the app uses a `StatefulShellRoute`/branch for `/home`, verify `push('/home/session/x')` keeps the shell beneath. If routing makes the session a top‑level route (no `/home` parent), the `go('/home')`+`push` sequence above still yields a poppable stack; confirm by test.

---

## Task F: Bug 2 — session header shows UUID (independent, do first)

**Files:**
- Read: `mobile/lib/presentation/screens/session_view/session_view_screen.dart`, `session_status_bar.dart`, `domain/session_summary.dart`, `infrastructure/api/sessions_api.dart`, `presentation/screens/sessions/sessions_tab_screen.dart`, `presentation/router/app_router.dart` (session route builder).
- Modify: `session_view_screen.dart`, `sessions_tab_screen.dart`, `app_router.dart` (pass/read `extra`), optionally `sessions_api.dart`.
- Test: `mobile/test/presentation/session_view/session_name_test.dart`.

**Approach (client‑only, robust for all entry points):**
1. When pushing the session route from the list, pass the full `SessionSummary` via GoRouter `extra`.
2. `SessionViewScreen` accepts an optional `SessionSummary? initialSummary`; if present, header shows `initialSummary.name` immediately.
3. If absent (notification/deep‑link → id only), resolve the name by calling `SessionsApi.list()` (uses `withApiAuth`, so the mobile Bearer key works) and finding the id. While unresolved, show `'Session'` — **never** `widget.sessionId`.

**Locked behaviour for the status bar title:** `final title = _resolvedName ?? initialSummary?.name ?? 'Session';` (no path that renders the raw id).

- [ ] **Step 1 — Failing test A:** a widget/unit test that `SessionViewScreen` given `initialSummary` with `name:'Build server'` renders `'Build server'` (not the id) in `SessionStatusBar`.
- [ ] **Step 2 — Failing test B:** given no summary and a fake `SessionsApi` whose `list()` returns `[SessionSummary(id:'s1', name:'Build server', …)]`, the header resolves to `'Build server'`; before resolution it shows `'Session'`, never `'s1'`.
- [ ] **Step 3 — Run, expect fail.**
- [ ] **Step 4 — Implement:**
  - Add `final SessionSummary? initialSummary;` to `SessionViewScreen` ctor.
  - Replace the `_sessionName = widget.sessionId` placeholder with name resolution: set from `initialSummary?.name`; if null, `await sessionsApi.list()` (via the existing provider), `firstWhereOrNull((s) => s.id == widget.sessionId)`, set `_resolvedName`. Guard with `mounted`.
  - Status bar `sessionName:` uses the locked title expression.
  - In `app_router.dart` session route builder, read `state.extra as SessionSummary?` and pass as `initialSummary`.
  - In `sessions_tab_screen.dart`, change `context.push('/home/session/${session.id}')` → `context.push('/home/session/${session.id}', extra: session)` (and the just‑created session path).
- [ ] **Step 5 — Run, expect pass;** `flutter analyze`.
- [ ] **Step 6 — Commit:** `fix(mobile): show session name in header, resolving id-only entry via list()`

---

## Task C: Supervisor `/auth/mobile-callback` + app host‑scope deep link

**C1 — Server route (TS).**

**Files:**
- Read: `src/app/auth/mobile-callback/page.tsx` (instance reference), `apps/supervisor/src/lib/auth.ts` (`resolveAuthenticatedEmail`, `withSupervisorAuth`), `apps/supervisor/src/lib/cf-access.ts`, `apps/supervisor/src/app/login/page.tsx`.
- Create: `apps/supervisor/src/app/auth/mobile-callback/page.tsx`.

**Behaviour:** server component that (a) resolves the caller via the Supervisor auth helper (CF Access cookie or OIDC session); if unauthenticated, render the same "no auth token" error UI the instance route uses (read it, mirror it). (b) On success, read the `CF_Authorization` cookie value and `redirect()` to:
`remotedev://auth/callback?scope=host&cfToken=<encodeURIComponent(cf)>&email=<…>&userId=<…>`.
Do **not** mint an API key (the Supervisor has none). Use `createLogger("auth/mobile-callback")` for any logging.

- [ ] **Step 1 — Read** the instance `mobile-callback/page.tsx` and the supervisor auth helpers; note exact import paths + the email/user shape.
- [ ] **Step 2 — Implement** the route mirroring the instance one, minus `createApiKey`, emitting `scope=host`.
- [ ] **Step 3 — Verify:** `cd apps/supervisor && bun run typecheck`. If a test harness exists for routes, add a minimal test that an authenticated request 3xx‑redirects to a `remotedev://auth/callback?scope=host` URL and an unauthenticated one renders the error.
- [ ] **Step 4 — Commit:** `feat(supervisor): host-scope mobile-callback for Flutter workspace discovery`

**C2 — App: parse the host‑scope callback (Dart).**

**Files:**
- Read: `mobile/lib/infrastructure/auth/mobile_callback_login_launcher.dart`, `mobile/lib/infrastructure/deep_link/app_link_listener.dart` (+ any callback param parser), `mobile/lib/infrastructure/auth/mobile_credentials.dart`.
- Modify: the deep‑link/callback parser + launcher to support a host‑scope result.
- Test: `mobile/test/infrastructure/auth/mobile_callback_parse_test.dart`.

**Locked result type (add):**
```dart
sealed class MobileCallbackResult {}
class InstanceCallback extends MobileCallbackResult {       // existing shape
  final String apiKey; final String cfToken; final String email; final String userId;
  InstanceCallback(this.apiKey, this.cfToken, this.email, this.userId);
}
class HostCallback extends MobileCallbackResult {           // new: scope=host, no apiKey
  final String cfToken; final String email; final String userId;
  HostCallback(this.cfToken, this.email, this.userId);
}
```

- [ ] **Step 1 — Failing test:** parsing `remotedev://auth/callback?scope=host&cfToken=ey..&email=a@b&userId=u1` yields `HostCallback`; the existing `apiKey=…` URL yields `InstanceCallback`.
- [ ] **Step 2 — Run, expect fail.**
- [ ] **Step 3 — Implement** the parser: `scope=='host'` or missing `apiKey` ⇒ `HostCallback`; else `InstanceCallback`. Add a launcher method `Future<HostCallback> loginHost(String origin)` that opens `{origin}/auth/mobile-callback` and awaits a `HostCallback` (mirror the existing instance `login` method).
- [ ] **Step 4 — Run, expect pass;** `flutter analyze`.
- [ ] **Step 5 — Commit:** `feat(mobile): parse host-scope auth callback for discovery bootstrap`

---

## Task A: Domain + storage + migration + providers (foundation)

**Files (create):** `domain/host_config.dart`, `domain/workspace_config.dart`, `application/ports/host_workspace_store.dart`, `infrastructure/storage/host_workspace_store_impl.dart`.
**Files (read for pattern):** `domain/server_config.dart`, `infrastructure/storage/server_config_store_impl.dart`, `application/ports/server_config_store.dart`, `infrastructure/auth/mobile_credentials.dart`, `main.dart` (provider wiring), `presentation/router/app_router.dart` (`activeServerProvider`).
**Files (modify):** `mobile_credentials.dart` (host/workspace‑keyed credentials), `main.dart` + `app_router.dart` (introduce `activeWorkspaceProvider`, rebind `_apiClientProvider`).
**Tests:** `mobile/test/infrastructure/storage/host_workspace_store_test.dart`, `mobile/test/infrastructure/storage/migration_test.dart`.

**Locked models (freezed):**
```dart
enum HostKind { singleWorkspace, multiWorkspace }

@freezed
class HostConfig with _$HostConfig {
  const factory HostConfig({
    required String id,
    required String label,
    required String origin,        // scheme://host[:port], no trailing slash, no path
    required HostKind kind,
    required DateTime createdAt,
    required DateTime lastUsedAt,
  }) = _HostConfig;
  factory HostConfig.fromJson(Map<String, dynamic> j) => _$HostConfigFromJson(j);
}

@freezed
class WorkspaceConfig with _$WorkspaceConfig {
  const factory WorkspaceConfig({
    required String id,
    required String hostId,
    required String slug,          // "" for single-workspace
    required String basePath,      // "" or "/<slug>"
    required String displayName,
    String? status,                // last-known instance status; null for single
    required DateTime lastUsedAt,
  }) = _WorkspaceConfig;
  factory WorkspaceConfig.fromJson(Map<String, dynamic> j) => _$WorkspaceConfigFromJson(j);
}
```

**Locked store port:**
```dart
abstract class HostWorkspaceStore {
  Future<List<HostConfig>> loadHosts();
  Future<List<WorkspaceConfig>> loadWorkspaces({String? hostId});
  Future<WorkspaceConfig?> loadActiveWorkspace();
  Future<HostConfig?> loadHost(String hostId);
  Future<void> upsertHost(HostConfig host);
  Future<void> upsertWorkspace(WorkspaceConfig ws);
  Future<void> setActiveWorkspace(String workspaceId);
  Future<void> removeHost(String hostId);          // cascades to its workspaces + creds
  Future<void> removeWorkspace(String workspaceId);
  Future<void> migrateLegacyServersIfNeeded();     // idempotent; guarded by schema_version
}
```

**Credentials (locked keys):** CF token at `host.<hostId>.cfToken`; API key at `workspace.<workspaceId>.apiKey`. Add to `MobileCredentialsStore`: `setHostCfToken/getHostCfToken/clearHost`, `setWorkspaceApiKey/getWorkspaceApiKey/clearWorkspace`.

**Migration algorithm (`migrateLegacyServersIfNeeded`):** if `schema_version` ≥ 2, return. Else read legacy `servers` + `active_server_id` + legacy per‑server creds. For each `ServerConfig s`: parse `Uri.parse(s.url)`; `origin = '${u.scheme}://${u.host}${u.hasPort ? ':${u.port}' : ''}'`; `slug/basePath` from `u.path` (strip trailing slash; `""` if root). Create `HostConfig(kind: singleWorkspace, label: s.label, origin)` + one `WorkspaceConfig(slug, basePath, displayName: s.label)`. Move legacy `cfToken`→host, `apiKey`→workspace. Map `active_server_id`→`active_workspace_id`. Write `schema_version = 2`. On any error, do **not** delete legacy keys; surface a non‑fatal error.

- [ ] **Step 1 — Models + codegen.** Create both freezed models; run `dart run build_runner build --delete-conflicting-outputs`; `flutter analyze`. Commit: `feat(mobile): Host/Workspace domain models`.
- [ ] **Step 2 — Store test (migration).** Write `migration_test.dart`: seed a fake secure storage with one legacy server (root URL) + one with a `/demo` path + creds + `active_server_id`; run `migrateLegacyServersIfNeeded`; assert two hosts, two workspaces (`basePath` `""` and `/demo`), creds moved, active mapped, `schema_version==2`, and a second run is a no‑op. Use the existing fake/secure‑storage test double (read `server_config_store` tests for the pattern).
- [ ] **Step 3 — Run, expect fail.**
- [ ] **Step 4 — Implement** `host_workspace_store_impl.dart` + the port + credential additions.
- [ ] **Step 5 — Run, expect pass;** `flutter analyze`. Commit: `feat(mobile): Host/Workspace store + one-time legacy migration`.
- [ ] **Step 6 — Providers.** Add `activeWorkspaceProvider` (+ active host) and rebind `_apiClientProvider` to build Dio from `{host.origin, workspace.basePath}` with both auth headers. Replace `activeServerProvider` usages (search: `grep -rn activeServerProvider mobile/lib`) — keep a thin shim if a wide blast radius, else migrate call sites. Run migration at startup (in `main.dart`, before first route). `flutter analyze`. Commit: `feat(mobile): active-workspace providers + startup migration`.

---

## Task B: Base‑path plumbing (depends on A)

**Files:**
- Read: `infrastructure/api/remote_dev_client.dart`, all `infrastructure/api/*_api.dart`, `presentation/screens/webview_host/session_route_host.dart`, `session_view_screen.dart`, `channels/channel_screen.dart`, `recording/recording_screen.dart`, `webview/navigation_policy.dart`, `screens/server_picker/add_server_screen.dart`, `github_accounts_screen.dart`.
- Create: `infrastructure/url/workspace_urls.dart`.
- Modify: `remote_dev_client.dart` + the WebView/nav/probe sites.
- Tests: `mobile/test/infrastructure/url/workspace_urls_test.dart`, `mobile/test/infrastructure/api/remote_dev_client_basepath_test.dart`.

**Locked helper:**
```dart
class WorkspaceUrls {
  final String origin;     // no trailing slash
  final String basePath;   // "" or "/demo"
  const WorkspaceUrls(this.origin, this.basePath);
  String api(String p) => '$basePath${_lead(p)}';          // for Dio path (origin is baseUrl)
  String web(String p) => '$origin$basePath${_lead(p)}';   // full URL for WebView
  static String _lead(String p) => p.startsWith('/') ? p : '/$p';
}
```

- [ ] **Step 1 — Helper test:** `WorkspaceUrls('https://h','').web('/m/session/s1') == 'https://h/m/session/s1'`; with `'/demo'` ⇒ `'https://h/demo/m/session/s1'`; `api('/api/sessions')` ⇒ `'/api/sessions'` and `'/demo/api/sessions'`. Implement; run; pass.
- [ ] **Step 2 — Dio test:** with a mock adapter, assert a `get('/api/sessions')` against a `/demo` workspace requests path `/demo/api/sessions`. Implement: `RemoteDevClient` takes `basePath`, prepends via `WorkspaceUrls.api` in each verb. Run; pass.
- [ ] **Step 3 — WebView/nav/probe sites:** thread `basePath` (from the active workspace) into `session_route_host.dart`, `session_view_screen.dart`, `channel_screen.dart`, `recording_screen.dart` web URLs and their `NavigationPolicy` allow‑prefixes (`'$basePath/m/...'`); make `add_server_screen` probe `{origin}{basePath}/api/config`; base‑path the GitHub‑link URL. `flutter analyze`.
- [ ] **Step 4 — Leakage gate:** `grep -rnE "'/m/|\"/m/" mobile/lib` and `grep -rnE "resolve\('/api|'/api/sessions'" mobile/lib` — confirm only the helpers/clients build these. Fix stragglers.
- [ ] **Step 5 — Commit:** `feat(mobile): base-path aware Dio + WebView/nav/probe URLs`

---

## Task D: Discovery + workspace picker UI (depends on A, B, C)

**Files:**
- Create: `domain/instance_summary.dart`, `infrastructure/api/instances_api.dart`, `presentation/screens/host_picker/add_host_screen.dart`, `presentation/screens/host_picker/workspace_picker_screen.dart`.
- Read/modify: `screens/server_picker/*` (generalise to host picker or add host flow), `app_router.dart` (routes), `add_server_screen.dart` (reuse probe), `mobile_callback_login_launcher.dart` (host + instance login), `main.dart` (providers).
- Tests: `mobile/test/infrastructure/api/instances_api_test.dart`, `mobile/test/.../workspace_picker_test.dart`.

**Locked discovery DTO + API:**
```dart
@freezed
class InstanceSummary with _$InstanceSummary {
  const factory InstanceSummary({
    required String slug,
    required String displayName,
    required String status,        // ready | provisioning | … 
  }) = _InstanceSummary;
  factory InstanceSummary.fromJson(Map<String, dynamic> j) => _$InstanceSummaryFromJson(j);
}

class InstancesApi {                 // talks to the host ORIGIN (no basePath)
  Future<List<InstanceSummary>> list();   // GET {origin}/api/instances, CF cookie
  bool get isSupervisor;                   // false when 404/not-supervisor
}
```

- [ ] **Step 1 — `instances_api` test:** mock `GET /api/instances` returning `{instances:[{slug:'demo',displayName:'Demo',status:'ready'},{slug:'wip',status:'provisioning',…}]}`; assert parse + that a 404 maps to "not a supervisor" (empty/flag). Implement; run; pass. Commit.
- [ ] **Step 2 — Add‑host flow:** `AddHostScreen` — user enters origin+label → `launcher.loginHost(origin)` (Task C2) stores host CF token → `InstancesApi(origin).list()`:
  - supervisor → persist `HostConfig(kind: multiWorkspace)` and route to `WorkspacePickerScreen`;
  - not supervisor → persist `HostConfig(kind: singleWorkspace)` + run the existing instance `login(origin)` to mint the single workspace's API key (`basePath=""`), then activate.
- [ ] **Step 3 — `WorkspacePickerScreen`:** list `InstanceSummary` (status chips; ready selectable). Selecting a ready instance → `launcher.login('$origin/$slug')` mints the per‑instance key → upsert `WorkspaceConfig(slug, basePath:'/$slug', displayName, status)` + set active → navigate `/home`. Pull‑to‑refresh re‑lists. Empty/error states per spec §7.
- [ ] **Step 4 — Host/workspace picker integration:** the existing server picker becomes a host list; expanding a multi‑workspace host shows its workspaces with a switcher; single‑workspace hosts open directly. Wire routes in `app_router.dart`. `flutter analyze`.
- [ ] **Step 5 — Commit:** `feat(mobile): workspace discovery + picker for multi-instance hosts`

---

## Integration verification (after all tasks)

- [ ] `cd mobile && flutter analyze` clean; `cd apps/supervisor && bun run typecheck` clean.
- [ ] Run available tests (note dyld caveat); record any skipped due to the hang.
- [ ] Manual matrix (device/emulator or against `rdv.example.com`): (a) existing single server still connects post‑migration; (b) add the supervisor host → discover → open `demo` → sessions list + a session WebView load under `/demo`; (c) open a session from a notification → header shows the name → **back returns to the sessions list**; (d) switch between two workspaces.
- [ ] Update `CHANGELOG.md` `[Unreleased]` (Added: multi‑workspace discovery; Fixed: notification back, session header name).

## Self-review (done by plan author)

- **Spec coverage:** §4.1 models→Task A; §4.2 storage/migration→A; §4.3 providers→A; §4.4 + §6 base‑path→B; §5/§6.1 auth+supervisor route→C; §7 discovery/picker→D; §8 bug1→E; §9 bug2→F. All covered.
- **Type consistency:** `WorkspaceUrls.api/web`, `HostConfig/WorkspaceConfig` fields, `HostCallback/InstanceCallback`, `InstanceSummary`, `navigateDeepLink`, `HostWorkspaceStore` methods are referenced consistently across tasks.
- **Placeholders:** none (`TBD/TODO`‑free); larger UI tasks specify locked interfaces + behaviour + tests and instruct pattern‑following against named existing files rather than pasting possibly‑stale widget code.
