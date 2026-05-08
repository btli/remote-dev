# Flutter App Redesign — Design Spec

**Date:** 2026-05-08
**Status:** Draft (pending review)
**Owner:** bryan.li
**Supersedes:** `archive/mobile-flutter/` (deprecated 2026-05-08)

## 1. Goals & non-goals

**Goals**
- Restore native iOS/Android distribution after the old Flutter app's deprecation.
- Host the existing mobile PWA (`src/components/mobile/`) as the primary surface for views that already work well on the web (terminal, channel view, recording playback).
- Make the app feel native end-to-end: native tab bar, lists, sheets, dropdowns, dialogs, session input, smart-keys, biometric lock, splash, deep links.
- Reuse the preserved Android signing env-var contract (`RDV_ANDROID_*`) and the FCM server contract (`push_token` table, `PushNotificationGateway`) from the deprecated app.

**Non-goals (v1)**
- Native reimplementation of the terminal canvas, channel view, or recording playback. Those stay in the WebView in v1.
- Retiring `packages/mobile/` (the React Native app). Both native targets coexist; archival decision is out of scope.
- Offline mode for any WebView surface. Online-only in v1.

## 2. Architecture

The new app is a **hybrid native + WebView** Flutter app. Native widgets own all list-y, sheet-y, dropdown-y surfaces and the session-view chrome (status bar, smart-keys, input bar). WebView hosts the surfaces that are genuinely web — terminal canvas, channel view, recording playback — via narrow mobile-only PWA routes.

```
┌─────────────────────────────────────────────────────────────────────┐
│ Flutter native app                                                  │
│                                                                     │
│  Domain: Project, Group, Session, Channel, Notification, User       │
│  API client (Dio) ──── Cookie: CF_Authorization=… ───▶ /api/*       │
│                                                                     │
│  Native screens: Tab bar, Sessions, Project tree, Notifications,    │
│                  Profile, Channels list, Sheets, Dialogs, Lock,     │
│                  Welcome, Server picker, Session-view chrome        │
│                                                                     │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │ Embedded WebView (one of):                                     │ │
│  │   /m/session/<id>    — terminal canvas only                    │ │
│  │   /m/channel/<id>    — channel view + thread takeover          │ │
│  │   /m/recording/<id>  — recording playback                      │ │
│  └────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

### 2.1 Surface split

| Surface | Native | WebView |
|---|---|---|
| Bottom tab bar | ✅ | |
| Sessions list (rows, swipe actions, status badges) | ✅ | |
| Project tree sheet (group + project picker) | ✅ | |
| New-session sheet | ✅ | |
| Action sheets, dropdowns, context menus, confirm dialogs | ✅ | |
| Notifications list + swipe actions | ✅ | |
| Profile tab + sub-screens | ✅ | |
| Channels list | ✅ | |
| Lock / Welcome / Sign-in chrome | ✅ | |
| Multi-server picker | ✅ | |
| Session view: status bar, **smart-keys, input bar** | ✅ | |
| Terminal canvas | | ✅ `/m/session/<id>` |
| Channel view + thread takeover | | ✅ `/m/channel/<id>` |
| Recording playback | | ✅ `/m/recording/<id>` |

### 2.2 Architectural rules (load-bearing — do not violate)

These rules are the result of platform validation and exist to prevent specific failure modes:

1. **All `addJavaScriptHandler` registrations happen in `onWebViewCreated`, never in `onLoadStop`.** If a handler is registered after page init, the JS side throws `TypeError: window.flutter_inappwebview.callHandler is not a function`.
2. **Native-to-WebView calls are gated on `onTerminalReady`.** The `SessionViewController` queues all `evaluateJavascript` / bridge invocations until `onTerminalReady` arrives, then drains. Calls during navigation are re-queued or dropped.
3. **Dio never reads from the WebView cookie store.** On Android, `WebView.CookieManager` and `okhttp` (Dio) are independent stores. The WebView is the source-of-truth during *auth*; `flutter_secure_storage` is the relay; Dio's `_AuthInterceptor` reads from secure storage on every request.
4. **WebView construction is deferred until the biometric gate resolves.** Constructing `InAppWebView` during cold start triggers Android WebView init on the platform thread and can produce a measurable jank spike as the native splash hands off to Flutter.
5. **WebView navigation policy: only allow navigation to `<serverOrigin>/m/*`.** All other URLs are intercepted via `shouldOverrideUrlLoading` and routed to `onLinkOpen`. CF Access redirects are explicitly allow-listed. Without this, a URL in terminal output could navigate the WebView away from the terminal mid-session.
6. **Embedded WebViews stay alive when tabs switch.** Session persistence is core — the `InAppWebView` for an active session is kept in the widget tree (with a stable `Key`) and not disposed when the user switches to Notifications/Profile. Memory cost is acceptable for the UX win.

### 2.3 Boundary contract — three things cross the native/WebView boundary

| Direction | Mechanism | Payload |
|---|---|---|
| Native → WebView | `loadUrl(...)` + JS bridge (`window.rdvBridge.*`) | Target route, input text, key events, paste, font size |
| WebView → Native | `addJavaScriptHandler` events | Selection change, terminal-ready, paste-request, activity, link-open |
| Native → Server | HTTPS w/ `Cookie: CF_Authorization=…` | List queries, FCM register, mark-read |

The PWA stays the source of truth for *user UI state* (tasks, channels, notifications, project tree). The native shell only owns **device-scoped state**: server URL list, active server, biometric prefs, FCM token, last-active server.

## 3. Auth flow — WebView-owned CF Access

CF Access is challenged inside the WebView. The native shell observes the cookie store and uses the resulting `CF_Authorization` cookie for its own API calls.

```
┌───────────┐                     ┌──────────────┐                ┌──────────┐
│  Native   │                     │   WebView    │                │  Server  │
│   shell   │                     │              │                │          │
└─────┬─────┘                     └──────┬───────┘                └─────┬────┘
      │  loadUrl(serverUrl/m/...)        │                              │
      ├─────────────────────────────────▶│                              │
      │                                  │  GET /m/...                  │
      │                                  ├─────────────────────────────▶│
      │                                  │  302 → CF Access login       │
      │                                  │◀─────────────────────────────┤
      │                                  │  user signs in (in WebView)  │
      │                                  │◀────────────────────────────▶│
      │                                  │  Set-Cookie: CF_Authorization│
      │                                  │  GET /m/... → renders        │
      │                                  │◀─────────────────────────────┤
      │  onLoadStop fires                │                              │
      │◀─────────────────────────────────┤                              │
      │  CookieManager.getCookies(url)                                  │
      │  → CF_Authorization read                                        │
      │  → persisted to flutter_secure_storage                          │
      │                                                                 │
      │  POST /api/push-tokens (Cookie: CF_Authorization=...)           │
      ├────────────────────────────────────────────────────────────────▶│
      │  201 Created                                                    │
      │◀────────────────────────────────────────────────────────────────┤
```

- Cookie read happens on every `onLoadStop` for the active server's origin and is keyed by `serverId` in secure storage. Background-killed-app FCM token refresh therefore has access to a (possibly stale) cookie.
- 401 from a native API call ⇒ cookie expired → reload WebView root URL → re-extract on next `onLoadStop`. Bounded retry (2 attempts) before the native shell surfaces an "Authentication needed" UI that re-opens the WebView root.
- Sign-out: clear WebView cookies for the active server's origin + clear secure-storage entries for that server + unregister FCM token + return to server picker.

## 4. JS bridge — native ↔ terminal/channel WebView

The WebView loads narrow mobile-only PWA routes that render *only* the relevant surface (no `MobileShell`, no tab bar) plus a tiny `window.rdvBridge` adapter.

### Native → WebView (calls into JS)

| Method | Purpose |
|---|---|
| `rdvBridge.input(text)` | User typed `text` in the native input bar → write to terminal |
| `rdvBridge.key(name, mods)` | Smart-key press, e.g. `('Tab', {ctrl:true})`. `mods` is `{ctrl,alt,shift,meta:bool}` |
| `rdvBridge.paste(text)` | Paste from native clipboard |
| `rdvBridge.setFontSize(px)` | Pinch-zoom result; PWA persists in localStorage too |
| `rdvBridge.scrollToBottom()` | After input lands, snap to live |

### WebView → Native (`addJavaScriptHandler`)

| Event | Purpose |
|---|---|
| `onSelectionChange(text)` | Native shows copy action sheet |
| `onTerminalReady` | Native unlocks input + clears splash |
| `onWantsPaste` | Long-press inside WebView asks native for clipboard |
| `onActivity(state)` | "Agent working / waiting / idle" → native status bar hint |
| `onLinkOpen(url)` | Native opens via in-app browser (SFSafariViewController / Custom Tabs) |

### Versioning

Bridge surface is versioned: `window.rdvBridge.version === N`. Native checks the version on `onTerminalReady` and refuses to send commands it knows the WebView doesn't understand. PWA bumps the version on breaking change.

### Keyboard layout pattern (mandatory)

The native input bar drives the OS soft keyboard. Layout must avoid the "WebView resizes when keyboard rises → xterm.js re-fits → terminal content jumps" failure mode:

- `Scaffold(resizeToAvoidBottomInset: false)` on `SessionView`. We own the layout math.
- Read `MediaQuery.viewInsetsOf(context).bottom` to drive the input bar's bottom offset.
- Constrain the WebView height **explicitly** — total viewport minus status bar, smart-key strip, input bar, and keyboard inset. Pass as a hard constraint, not `Expanded`.
- iOS WebView settings: `keyboardDisplayRequiresUserAction: false`, `disallowOverScroll: true`.
- **Android** WebView settings: `useHybridComposition: true` (required for correct keyboard/overlay interaction in Flutter hybrid views since Flutter 3.x).
- `SafeArea` only wraps the input bar (`top: false`); it is **not** for keyboard insets.

## 5. Push notifications — FCM contract preserved

Server already owns `push_token` table + `PushNotificationGateway`. We do not change the server contract.

### Token lifecycle

1. After WebView reports `onLoadStop` on the PWA root with a valid `CF_Authorization` cookie, native shell:
   - `FirebaseMessaging.requestPermission()` (iOS prompt; Android auto-grants pre-13, prompts on 13+).
   - `getToken()` → `POST /api/push-tokens` with cookie auth, body `{ token, platform, deviceId }`.
   - Subscribes to `onTokenRefresh` and re-registers.
2. Sign-out: `DELETE /api/push-tokens/<token>` then clear FCM token locally.
3. Per-server isolation: `deviceId` is stable per device, `token` is per-app-install; the same device may register against multiple servers. Each Remote Dev server has its own SQLite database, so the global `uniqueIndex("push_token_fcm_token_idx")` in `src/db/schema.ts` is *per-server*, not cross-server — registering the same FCM token with multiple servers stores one row per server, no conflict.
4. **iOS foreground presentation:** call `setForegroundNotificationPresentationOptions(alert: true, badge: true, sound: true)` during init. iOS 14+ suppresses foreground notifications by default without this.
5. **`onTokenRefresh` must re-register with all servers.** FCM issues one token per app installation, not per server. When the token rotates, iterate `serverConfigStore.loadAll()` and POST to each saved server's `/api/push-tokens`. The deprecated app only re-registered with the active server — explicit gap to fix.

### Payload (preserved from old app)

```json
{
  "data": {
    "sessionId": "<uuid>",
    "channelId": "<uuid>",
    "notificationId": "<uuid>",
    "kind": "agent_idle | agent_waiting | channel_message | …"
  },
  "notification": { "title": "...", "body": "..." }
}
```

### Tap-nav (now resolves to native routes)

| Payload | Native nav |
|---|---|
| `sessionId` set | Push `SessionScreen(sessionId)` (native chrome around `/m/session/<id>` WebView) |
| `channelId` set | Push `ChannelScreen(channelId)` (native chrome around `/m/channel/<id>` WebView) |
| neither | Switch to Notifications tab |

Mark-as-read on tap: `PATCH /api/notifications` with `{ ids: [notificationId] }`. Fire-and-forget; PWA's `NotificationContext` picks up the read state on next refresh / WS event.

### Cross-device dismissal

PWA emits a "notification dismissed" signal (already wired in `NotificationContext`). Native listens via a WebSocket the WebView already maintains. When the PWA clears 3+ notifications or "mark all read", native calls Android's `NotificationManager.cancelAll()` via a `MethodChannel('com.remotedev.remote_dev/notifications')` (preserved from old app). iOS clears its tray automatically when the app foregrounds, so iOS only needs `setBadgeCount(0)`.

## 6. Deep-link routing

Two link types feed the same router:

- `https://<server>/m/<route>` — Universal Links (iOS) / App Links (Android). Share-friendly.
- `remotedev://<route>` — fallback custom scheme. Used for internal deep links and any future auth-callback path.

Native uses the `app_links` package to expose a `Stream<Uri>`. A `DeepLinkRouter` translates a URI into an `AppRoute`:

```dart
sealed class AppRoute {
  factory AppRoute.session(String id) = _Session;
  factory AppRoute.channel(String id) = _Channel;
  factory AppRoute.recording(String id) = _Recording;
  const factory AppRoute.notifications() = _Notifications;
  const factory AppRoute.serverPicker() = _ServerPicker;
}
```

Both the deep-link handler and the FCM tap handler converge on `router.navigateTo(AppRoute)` so cold-start and warm-start behavior are identical.

## 7. Biometric lock + splash sequencing

Three native screens layered over everything:

```
App launch
  ↓
NativeSplashScreen      (instant, native PNG via flutter_native_splash)
  ↓
BiometricLockScreen     (if enabled and outside grace period)
  ↓
WebView preload         (covered by splash until onTerminalReady or onLoadStop)
  ↓
Native screen the user landed on (Sessions tab, or deep-link target)
```

- Biometric: `local_auth`. Settings: enabled (default off), grace period (immediate / 1m / 5m / 15m), require on cold start (default on when feature is enabled).
- Lock screen *covers* the app on resume; it does not navigate. It coexists with the PWA's `MobileLockScreen` — that one is for the *unauthenticated* state and renders inside the WebView; the native lock sits on top.
- Splash never auto-dismisses on a timer in the happy path. It dismisses on `onTerminalReady` / `onLoadStop`. After 8 s with no progress, it surfaces a "Trouble loading?" CTA that opens the server picker.

## 8. Multi-server picker

- Stored in `flutter_secure_storage`: `[{id, label, url, lastUsedAt}]`. Active server stored as a separate key.
- Switching servers: clear WebView cookies for previous origin → unregister FCM token for previous server → switch active record → reload WebView with new origin.
- Per-server isolation: secure-storage keys are prefixed by `serverId`. The same physical device can appear in multiple servers' `push_token` tables (server doesn't need to know about the relationship).
- Add-server flow: user enters URL → native validation (`GET /api/health` if available, otherwise just attempts the WebView load) → label prompt → save → activate.
- Delete-server: confirmation dialog → unregister FCM → drop the secure-storage entry → if it was the active server, fall back to most-recently-used.

## 9. Project layout & tech choices

Location: **`mobile/`** at repo root. Existing `archive/mobile-flutter/` stays archived for reference only.

```
mobile/
  android/                        # signed via RDV_ANDROID_* env vars (preserved contract)
  ios/                            # Universal Links + Push entitlements
  lib/
    main.dart
    app.dart                      # root MaterialApp + router

    domain/                       # entities + value objects
      session.dart  project.dart  group.dart  channel.dart
      notification.dart  user.dart  server_config.dart

    application/
      ports/                      # ApiClientPort, PushPort, BiometricPort,
                                  # SecureStoragePort, DeepLinkPort, BridgePort
      use_cases/                  # SignIn, RegisterPush, OpenSession, OpenChannel,
                                  # ListSessions, MarkNotificationRead, …

    infrastructure/
      api/                        # Dio RemoteDevClient, cookie jar bound to active server
      auth/                       # CookieReader (WebView ↔ secure storage)
      push/                       # FCM service, registration, tap handler, MethodChannel
      webview/                    # Bridge channel, route helpers, WebView factory
      storage/                    # secure_storage wrappers, server config store
      deeplinks/                  # app_links wiring + URI parser
      biometric/                  # local_auth wrapper

    presentation/
      router/                     # AppRouter (go_router), AppRoute enum
      screens/
        sessions/   channels/   notifications/   profile/
        session_view/             # native chrome + WebView host
        channel_view/             # native chrome + WebView host
        recording_view/
        lock/   splash/   welcome/   server_picker/
      widgets/
        bottom_tab_bar.dart
        smart_key_strip.dart
        mobile_input_bar.dart
        action_sheet.dart
        bottom_sheet.dart
      theme/                      # Tokyo Night palette mirrored from PWA
  test/
  pubspec.yaml
  README.md
```

### Dependencies

**Minimum SDK:** Dart `>=3.4.0 <4.0.0`, Flutter `>=3.22.0` (matches deprecated app, required for Dart 3 sealed classes used in `AppRoute`).

| Concern | Package | Rationale |
|---|---|---|
| State | `flutter_riverpod` | Old app used it; isolation, async, codegen-friendly |
| HTTP | `dio` | Cookie jar, interceptors, easy 401-retry |
| Cookie jar (optional) | `cookie_jar` + `dio_cookie_manager` | Per-server cookie isolation once multi-server is stable. Manual interceptor first; library when scale demands. |
| WebView | `flutter_inappwebview` | What the old app used; CookieManager API + `addJavaScriptHandler` are first-class. `webview_flutter` lacks the cookie ergonomics we need. |
| Routing | `go_router` | Declarative, deep-link-friendly. `AppRoute` sealed class adapts to `go_router` paths via a single `route.toPath()` helper. |
| Secure storage | `flutter_secure_storage` | Per-platform Keychain/Keystore — for cookie + FCM token + server config |
| Plain prefs | `shared_preferences` | Non-sensitive device state (last active tab, dismissed onboarding, keyboard height cache) |
| Biometric | `local_auth` | Standard |
| Push | `firebase_core` + `firebase_messaging` | Server contract is FCM |
| Deep links | `app_links` | Maintained; supports Universal Links + custom scheme |
| Splash | `flutter_native_splash` | One config generates platform splash assets. **`fullscreen: true` required** for edge-to-edge on Android 15+. |
| Connectivity | `connectivity_plus` | Native chrome shows "reconnecting" overlay when network drops. Without it the input bar silently swallows keystrokes while the WebView is offline. |
| **Code generation** | `freezed` + `freezed_annotation`, `json_serializable`, `riverpod_annotation`, `build_runner` | Domain models + Riverpod providers are codegen'd. Load-bearing dev deps. |

### User-Agent

WebView sets a UA suffix `RemoteDevMobile/<version>` so PWA / SSR can branch when needed (e.g. skip rendering the bottom tab bar on `/m/...` routes).

### Layering note (pragmatic Clean Architecture)

The directory structure shows `domain/`, `application/`, `infrastructure/`, `presentation/` — but in practice domain entities for this app are DTO-shaped (`Session`, `Channel`, `Notification` mirror API JSON). To avoid the most common Clean Architecture antipattern in Flutter, treat the layering pragmatically:

- **Use cases** are formalized only for flows with 2+ steps or side effects (e.g. `SignIn`, `RegisterPush`, `OpenSession`). Simple CRUD calls (e.g. `MarkNotificationRead`) live directly in Riverpod `AsyncNotifier`s.
- **Domain entities** are `@freezed` classes; their `fromJson`/`toJson` is generated. They have no business methods unless one organically appears.
- **Ports** (`ApiClientPort`, `PushPort`, `BiometricPort`, `SecureStoragePort`, `DeepLinkPort`, `BridgePort`) stay as interfaces — they are the testability boundary and earn their keep.

If `domain/` and `application/` end up too thin to justify their existence after Phase 2, collapse into a single `lib/models/` + `lib/ports/` split before Phase 3.

### Asset bundle

- **Nerd Fonts are NOT bundled.** The terminal renders inside the WebView, which uses fonts the PWA self-hosts as WOFF2. The deprecated app shipped JetBrainsMono / FiraCode / MesloLGS Nerd Fonts (~3 MB). Drop them.
- Native screens use the system font family with the Tokyo Night palette mirrored from the PWA — no bundled font.

## 10. PWA-side work (precondition for v1)

Three new mobile-only routes, with `<MobileShell>` and the bottom tab bar **excluded**:

- `/m/session/<id>` — `MobileSessionView` body only (terminal canvas + bridge), no smart-keys / input bar / status bar (those are now native). Renders xterm.js + `window.rdvBridge`.
- `/m/channel/<id>` — `ChannelView` + `ThreadPanel`, no tab bar.
- `/m/recording/<id>` — `RecordingPlayer`, no chrome.

These routes must be additive — they don't disrupt the existing `MobileApp` composition for users on the web PWA.

The existing `MobileViewportSwitch` should short-circuit cleanly when UA contains `RemoteDevMobile/` so we don't double-render desktop providers (this is an explicit verification item).

## 11. Distribution & signing

### iOS

- Bundle id `com.remotedev.app` (preserved from old app).
- TestFlight first; App Store after Phase 5.
- Universal Links via `apple-app-site-association` served at `/.well-known/apple-app-site-association` on **each** Remote Dev server the user adds. Multi-server implication: a user with two servers (work, personal) must have both domains listed in the app's entitlements (`com.apple.developer.associated-domains`). For v1, ship with a fixed allowlist of common domains in entitlements; arbitrary self-hosted servers fall back to the `remotedev://` custom scheme for deep links.
- Push entitlements + APNs key uploaded to Firebase.
- Minimum iOS: 15.0 (matches `flutter_inappwebview` 6.x and modern WKWebView cookie APIs).

### Android

- Package `com.remotedev.app`.
- Play Internal track first; Play Production after Phase 5.
- App Links via `assetlinks.json` at `/.well-known/assetlinks.json` on each server. Same multi-server caveat as iOS: arbitrary domains can't be added at runtime, so non-allowlisted servers fall back to `remotedev://`.
- Signing reuses the preserved env-var contract (no fallback to debug keystore for `release`):
  ```
  RDV_ANDROID_KEYSTORE_PATH
  RDV_ANDROID_KEYSTORE_PASSWORD
  RDV_ANDROID_KEY_ALIAS
  RDV_ANDROID_KEY_PASSWORD
  ```
- Minimum Android: API 26 (Android 8.0). Matches what the old app's WebView feature set required.

### CI

GitHub Actions workflow on tag `mobile-v*`:
- Builds Android App Bundle via existing `RDV_ANDROID_*` secrets.
- Builds iOS IPA via App Store Connect API key (new secret).
- Uploads to TestFlight / Play Internal track.

## 12. Phased rollout

Each phase is independently shippable.

| Phase | Scope | Ship gate |
|---|---|---|
| **0** | PWA: add `/m/session/<id>`, `/m/channel/<id>`, `/m/recording/<id>` routes. Add `window.rdvBridge` JS adapter. UA-sniff guard in `MobileViewportSwitch`. | Routes render in desktop browser (manual). |
| **1** | Flutter shell: scaffold `mobile/`, splash, WebView host, in-WebView CF Access auth, cookie reader, secure storage, server picker scaffold. | Can sign in and see the PWA in the WebView at `/m/session/...`. |
| **1.5** | **Bridge smoke-test spike (1–2 days).** Minimum native chrome (single `TextField`, no smart keys, no status bar) wired to bridge. Prove `rdvBridge.input(text)` reaches xterm.js, `onTerminalReady` arrives in Dart, keyboard layout doesn't reflow the terminal. Validates the riskiest assumption before building Phase 2's full chrome. | Bridge round-trip verified end-to-end on iOS + Android physical devices. |
| **2** | Native Sessions tab + bottom tab bar + project tree sheet + new-session sheet. Native session-view chrome (status bar + smart-keys + input bar) wired to bridge. Pinch-zoom gesture. | Open a session, type into the terminal via the native input bar. |
| **3** | Push notifications: FCM init, register, tap-nav into native session route. Cross-device dismissal via MethodChannel. iOS foreground presentation options. Multi-server `onTokenRefresh` fan-out. | Receive a push, tap, land on the right session. |
| **4** | Notifications tab native, Channels list native + WebView channel view, Profile tab native + sub-screens. Universal Links + App Links wired. | Feature parity with deprecated Flutter, plus channels. |
| **5** | Biometric lock, multi-server picker polish, recording playback, app store metadata, screenshots, **`PrivacyInfo.xcprivacy` manifest** (required May 2024+ for App Store), Android edge-to-edge config. | Submit to TestFlight + Play Internal. |

## 12.5 Error surface (native chrome behavior on failure)

The native chrome must define behavior for every failure mode that interrupts the WebView:

| Failure | Native UI response |
|---|---|
| Server unreachable (DNS / TCP / TLS fails) | Native error screen overlay on top of WebView with retry + "switch server" CTA. WebView paused. |
| CF Access challenge fails after 2 retries | Native "Authentication needed" screen with "Re-authenticate" CTA that reloads WebView root. |
| `onTerminalReady` never fires within 8 s | Splash dismisses to a "Trouble loading?" screen with reload + "switch server" CTA. |
| Session closed server-side mid-WebView-load | Bridge receives `onSessionClosed` → native pops `SessionScreen` and shows toast on Sessions tab. |
| Network drops while in session | `connectivity_plus` triggers a non-blocking "Reconnecting…" banner over the smart-key strip. Input bar disables until network returns. |
| 401 from a native API call | Reload WebView root → re-extract cookie. After 2 attempts, fall back to "Re-authenticate" screen. |
| Bridge version mismatch on `onTerminalReady` | Native shows "Update Remote Dev" screen with link to App Store / Play Store. |

## 13. Out of scope (filed as follow-ups)

- Native channel view (Dart markdown rendering, composer, threads, optimistic send).
- Offline mode / cached session list / cached notification list.
- Apple Watch companion.
- Native terminal renderer.
- Retiring `packages/mobile/` (RN) — explicitly kept active.
- iPad / large-screen Android adaptive layouts beyond what the PWA already does.

## 14. Open verification items (to address during Phase 0–1)

- Confirm `MobileViewportSwitch` short-circuits cleanly on `RemoteDevMobile/` UA so desktop providers don't double-render.
- Confirm `PushNotificationGateway` server-side handles per-server tokens correctly (likely yes; needs check).
- Confirm CF Access does not interfere with WebSocket `Upgrade` requests from the WebView origin.
- Confirm `flutter_inappwebview` CookieManager reads consistently across iOS WKWebView's data store and Android WebView's CookieManager when third-party cookies aren't involved.
- Confirm bundle id `com.remotedev.app` is still claimed in Apple Developer + Google Play Console.

## 15. Risks

| Risk | Mitigation |
|---|---|
| In-WebView CF Access challenge breaks on iOS WKWebView (e.g., no cookies persisted) | Phase 1 spike: validate cookie persistence end-to-end before building Phase 2. Fallback: external in-app browser tab (ASWebAuthenticationSession / Custom Tabs) returning a deep link, like the deprecated app. |
| FCM iOS background permission flake | Mirror the deprecated app's setup (it shipped). Use Firebase's APNs bridge, not direct APNs, so we keep the same server contract. |
| JS bridge drift between native and PWA | Versioned bridge object; native refuses unknown versions; release-train alignment between PWA and Flutter. |
| App Store rejection for "WebView app" | App is genuinely native (tab bar, lists, sheets, input bar, push, biometric). WebView only hosts a few content surfaces. Document this in submission notes. |
| Re-divergence of Flutter from PWA over time | Treat `/m/*` PWA routes as a public contract; PWA tests assert their existence; Flutter tests assert bridge calls round-trip. |
