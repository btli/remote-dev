# Flutter App — Phase 4: Native Notifications/Channels/Profile + Deep Links

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development`. Subagents work in worktrees off `feat/mobile-phase-4`. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Fill in the 3 non-Sessions tabs (Notifications, Channels, Profile) and wire deep-link routing — Universal Links (iOS), App Links (Android), and the `remotedev://` custom scheme. Plus a final cleanup task that overrides the deferred Riverpod providers in `main.dart` so the app actually wires up against a real `RemoteDevClient` per active server.

**Architecture (per spec §2.1):**
- **Notifications tab** (native list): pulls `/api/notifications`, filter chips, swipe-to-dismiss, swipe-to-mark-read.
- **Channels list** (native): rows + unread badges + swipe-to-archive. Tap a channel → `ChannelScreen` (native AppBar around `/m/channel/<id>` WebView).
- **Profile tab** (native): settings rows, sub-screens (Account, GitHub accounts, Appearance, Servers, About).
- **Deep links:** `app_links` package emits `Stream<Uri>`; `DeepLinkRouter` translates to `AppRoute`. Universal Links / App Links allowlist common server domains; non-allowlisted servers fall back to the custom scheme.

**Tech Stack:** `app_links: ^6.3.2` (already in pubspec from Phase 1 — verify; add if missing). Existing `firebase_messaging` foreground message handling for the unread badge.

**Spec:** §2.1, §6, §11.

**Out of scope (Phase 5):** biometric, multi-server polish, recording playback, store metadata, iOS push entitlements, store deep-link URL.

---

## File structure (after all 7 tasks land + the wire-up)

```
mobile/lib/
├── domain/
│   ├── notification.dart           # P4.1
│   └── channel.dart                # P4.2
├── application/ports/
│   ├── notifications_port.dart     # P3.5 already; P4.1 extends with list/dismiss
│   ├── channels_port.dart          # P4.2
│   └── deep_link_port.dart         # P4.7
├── infrastructure/
│   ├── api/
│   │   ├── notifications_api.dart  # P3.5; P4.1 extends
│   │   └── channels_api.dart       # P4.2
│   └── deep_link/
│       ├── app_link_listener.dart  # P4.5 + P4.6 + P4.7 share this
│       └── deep_link_router.dart   # P4.7
└── presentation/
    ├── screens/
    │   ├── notifications/
    │   │   └── notifications_tab_screen.dart  # P4.1
    │   ├── channels/
    │   │   ├── channels_tab_screen.dart       # P4.2
    │   │   └── channel_screen.dart            # P4.3
    │   └── profile/
    │       ├── profile_tab_screen.dart        # P4.4
    │       ├── account_screen.dart            # P4.4
    │       ├── github_accounts_screen.dart    # P4.4
    │       ├── appearance_screen.dart         # P4.4
    │       ├── servers_screen.dart            # P4.4
    │       └── about_screen.dart              # P4.4
    └── shell/
        └── home_shell.dart                    # P4.* — replace placeholders with real tabs

mobile/ios/Runner/
├── Runner.entitlements                # P4.5 — associated-domains entitlement
└── Info.plist                          # P4.7 — CFBundleURLTypes for remotedev://

mobile/android/app/src/main/AndroidManifest.xml  # P4.6 + P4.7

src/app/.well-known/                    # SERVER side (separate PR ideally; documented in this plan)
├── apple-app-site-association          # P4.5
└── assetlinks.json                     # P4.6
```

---

## Worktree strategy

Single feature branch `feat/mobile-phase-4`. Subagents in waves:

- **Wave 1 (3 parallel):** P4.1 Notifications tab || P4.2 Channels list || P4.4 Profile tab
- **Wave 2 (sequential):** P4.3 ChannelScreen (after P4.2)
- **Wave 3 (3 parallel):** P4.5 Universal Links || P4.6 App Links || P4.7 Custom scheme
- **Wave 4 (sequential):** Wire-up — final commit overriding the deferred providers in `main.dart`

---

## Architectural rules

1. **All `addJavaScriptHandler` registrations remain in `onWebViewCreated`.** P4.3 follows the existing pattern from P2.9.
2. **`AppRouter.navigateTo(AppRoute)` is the single sink.** P4.7 wires `app_links`'s URI stream to it; P3.4's tap handler already converges here.
3. **Non-allowlisted servers fall back to `remotedev://`.** Universal/App Links can't be added at runtime, so users with arbitrary server URLs use the custom scheme.
4. **Single quotes, `debugPrint`, no `print`.**

---

## Task 1 (P4.1): Native Notifications tab

**Worktree:** `../remote-dev-flutter-p4-notifications` on `feat/mobile-phase-4-notifications`

### Files

- Create: `mobile/lib/domain/notification.dart` (freezed)
- Modify: `mobile/lib/application/ports/notifications_port.dart` — add `list({filter})` + `dismiss(id)` + `markAllRead()`
- Modify: `mobile/lib/infrastructure/api/notifications_api.dart` — implement those
- Create: `mobile/lib/presentation/screens/notifications/notifications_tab_screen.dart`
- Modify: `mobile/lib/presentation/screens/shell/home_shell.dart` — replace Notifications placeholder
- Tests

### Goals

- Filter chips: All / Unread / Mentions.
- Swipe-to-dismiss → `DELETE /api/notifications` (single id).
- Swipe-to-mark-read → `PATCH /api/notifications {ids: [id]}` (already in P3.5).
- Pull-to-refresh.
- Tap row → mark-read + navigate to source session/channel via `AppRoute`.
- Empty state.

### Domain model

```dart
@freezed
class AppNotification with _$AppNotification {
  const factory AppNotification({
    required String id,
    required String title,
    required String body,
    required DateTime createdAt,
    required bool read,
    String? sessionId,
    String? channelId,
    @Default('default') String kind,
  }) = _AppNotification;

  factory AppNotification.fromJson(Map<String, dynamic> json) =>
      _$AppNotificationFromJson(json);
}
```

### Steps

1. Domain model + freezed codegen.
2. Extend `NotificationsPort` with `list({String? filter})`, `dismiss(String id)`, `markAllRead()`.
3. Extend `NotificationsApi` accordingly. `list({filter})` parses both wrapped + bare-array responses.
4. Implement `NotificationsTabScreen` with the filter chips, list, swipe actions.
5. Wire into `HomeShell._notificationsBody`.
6. Tests for the API + screen.

### Commit

```
feat(mobile/notifications): native Notifications tab
```

---

## Task 2 (P4.2): Native Channels list

**Worktree:** `../remote-dev-flutter-p4-channels` on `feat/mobile-phase-4-channels`

### Files

- Create: `mobile/lib/domain/channel.dart` (freezed)
- Create: `mobile/lib/application/ports/channels_port.dart`
- Create: `mobile/lib/infrastructure/api/channels_api.dart`
- Create: `mobile/lib/presentation/screens/channels/channels_tab_screen.dart`
- Modify: `mobile/lib/presentation/screens/shell/home_shell.dart`
- Tests

### Goals

- Pulls `/api/channels`. Renders rows: channel name + unread badge.
- Swipe-to-archive → `DELETE /api/channels/<id>`.
- Pull-to-refresh.
- Tap row → push `ChannelScreen` (P4.3 wires).
- Empty state.

### Domain model

```dart
@freezed
class Channel with _$Channel {
  const factory Channel({
    required String id,
    required String name,
    @Default(0) int unreadCount,
    String? projectId,
  }) = _Channel;

  factory Channel.fromJson(Map<String, dynamic> json) =>
      _$ChannelFromJson(json);
}
```

### Commit

```
feat(mobile/channels): native channels list with unread badges + swipe-to-archive
```

---

## Task 3 (P4.3): `ChannelScreen` — native chrome around /m/channel/<id> WebView

**Worktree:** `../remote-dev-flutter-p4-channelscreen` (after P4.2 lands)

### Files

- Create: `mobile/lib/presentation/screens/channels/channel_screen.dart`
- Modify: `mobile/lib/presentation/router/app_router.dart` — add `/home/channel/:id`
- Tests

### Goals

- Native `AppBar` with channel name + back button + actions menu.
- Body: `WebViewFactory().build(initialUrl: <server>/m/channel/<id>)` — same pattern as `SessionViewScreen`.
- Native back drives `BridgeController.back()` (Phase 0's PWA bridge handler closes any open thread first; otherwise route pops).

---

## Task 4 (P4.4): Native Profile tab + sub-screens

**Worktree:** `../remote-dev-flutter-p4-profile`

### Files

- Create: 6 screens under `mobile/lib/presentation/screens/profile/`
- Modify: `mobile/lib/presentation/screens/shell/home_shell.dart`
- Tests for each

### Goals

- Profile tab as a native `ListView` with rows that push to sub-screens.
- Sub-screens: Account, GitHub accounts, Appearance, Servers (reuses P1.8's picker), About.
- Each is a `Scaffold` with native settings cells.
- Phase 5 polishes; Phase 4 ships scaffolding.

---

## Task 5 (P4.5): Universal Links (iOS)

**Worktree:** `../remote-dev-flutter-p4-universal-links`

### Files

- Modify: `mobile/ios/Runner/Runner.entitlements` (create if absent)
- Document: server-side `/.well-known/apple-app-site-association` (server change is OUT of mobile scope; document in `docs/mobile-deep-links.md`)

### Goals

- `applinks:dev.example.com` (or whatever the project's default Remote Dev domain is) listed in `com.apple.developer.associated-domains`.
- Non-allowlisted servers fall back to `remotedev://`.

---

## Task 6 (P4.6): App Links (Android)

**Worktree:** `../remote-dev-flutter-p4-app-links`

### Files

- Modify: `mobile/android/app/src/main/AndroidManifest.xml` — `<intent-filter>` for `https://dev.example.com/m/*` with `android:autoVerify="true"`
- Document: server-side `/.well-known/assetlinks.json`

---

## Task 7 (P4.7): Custom scheme + DeepLinkRouter

**Worktree:** `../remote-dev-flutter-p4-deep-links`

### Files

- Modify: `mobile/ios/Runner/Info.plist` — `CFBundleURLTypes` for `remotedev`
- Modify: `mobile/android/app/src/main/AndroidManifest.xml` — `<data android:scheme="remotedev" />`
- Create: `mobile/lib/infrastructure/deep_link/app_link_listener.dart` — listens to `AppLinks().uriLinkStream`
- Create: `mobile/lib/infrastructure/deep_link/deep_link_router.dart` — translates URI → `AppRoute`
- Modify: `mobile/lib/main.dart` — start the listener at boot
- Tests for the URI → AppRoute translation

### Step 1: `DeepLinkRouter`

```dart
class DeepLinkRouter {
  static AppRoute? routeFor(Uri uri) {
    // remotedev://session/<id>, remotedev://channel/<id>, etc.
    // OR https://server/m/session/<id> from Universal Links.
    final segments = uri.pathSegments.isNotEmpty ? uri.pathSegments : [uri.host];
    if (segments.isEmpty) return null;
    final first = segments.first;
    final id = segments.length > 1 ? segments[1] : null;
    switch (first) {
      case 'session':
      case 'm' when segments.length > 2 && segments[1] == 'session':
        final sid = first == 'session' ? id : segments[2];
        if (sid != null && sid.isNotEmpty) return AppRoute.session(sid);
        return null;
      case 'channel':
      case 'm' when segments.length > 2 && segments[1] == 'channel':
        final cid = first == 'channel' ? id : segments[2];
        if (cid != null && cid.isNotEmpty) return AppRoute.channel(cid);
        return null;
      case 'recording':
      case 'm' when segments.length > 2 && segments[1] == 'recording':
        final rid = first == 'recording' ? id : segments[2];
        if (rid != null && rid.isNotEmpty) return AppRoute.recording(rid);
        return null;
      case 'notifications':
        return const AppRoute.notifications();
      default:
        return null;
    }
  }
}
```

### Step 2: `AppLinkListener`

```dart
class AppLinkListener {
  AppLinkListener({required this.router, AppLinks? links})
      : _links = links ?? AppLinks();

  final AppRouter router;
  final AppLinks _links;
  StreamSubscription<Uri>? _sub;

  Future<void> start() async {
    final initial = await _links.getInitialAppLink();
    if (initial != null) _navigate(initial);
    _sub = _links.uriLinkStream.listen(_navigate);
  }

  void _navigate(Uri uri) {
    final route = DeepLinkRouter.routeFor(uri);
    if (route != null) router.navigateTo(route);
  }

  Future<void> stop() async {
    await _sub?.cancel();
    _sub = null;
  }
}
```

### Tests

Pure-function `DeepLinkRouter.routeFor` tests for every variant.

---

## Wave 4 (final wire-up): main.dart provider overrides

**Worktree:** `../remote-dev-flutter-p4-wire-providers`

### Goal

After Phase 4's tabs all need real data, override the deferred `UnimplementedError` providers (`sessionsApiProvider`, `projectTreeApiProvider`, `pushTokenRegistrarProvider`, `notificationsApiProvider`, `channelsApiProvider`) in `main.dart` so the app actually works against the active server.

### Files

- Modify: `mobile/lib/main.dart`

### Pattern

```dart
void main() {
  // Eager init of FCM (non-blocking).
  Future<void>.microtask(() => FcmPushService().initialize());

  runApp(ProviderScope(
    overrides: [
      // Wire each *Api provider to a RemoteDevClient bound to the active server.
      // Use ref.watch(activeServerProvider) inside the override to react to switches.
      sessionsApiProvider.overrideWith((ref) {
        final server = ref.watch(activeServerProvider).value;
        if (server == null) throw const _NoActiveServer();
        final client = RemoteDevClient(
          serverOrigin: Uri.parse(server.url),
          serverId: server.id,
          storage: ref.watch(secureStorageProvider),
        );
        return SessionsApi(client);
      }),
      // ... similar for projectTreeApi, channelsApi, notificationsApi, pushTokenRegistrar
    ],
    child: const RemoteDevApp(),
  ));
}
```

### Tests

A widget test that mounts `RemoteDevApp` with stubbed providers (no real overrides — just verifying the override mechanism didn't break the existing Phase 0–3 tests).

---

## Phase 4 ship gate

- [ ] `flutter test` clean
- [ ] `flutter analyze` clean
- [ ] `flutter build apk --debug` succeeds
- [ ] All 7 P4 bd issues closed; epic `remote-dev-9ngw` closed.

## Out of scope — Phase 5

- Real channel-view UI inside `ChannelScreen` (it stays in WebView per spec); native channel widget would be Phase 5+ if ever.
- iOS push entitlements, App Store metadata, biometric, multi-server polish, recording playback.
