# Flutter App — Phase 3: Push Notifications (FCM)

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development`. Subagents work in worktrees off `feat/mobile-phase-3`. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Wire FCM push notifications end-to-end. Server contract preserved from the deprecated app: `push_token` table + `PushNotificationGateway` ports already exist on the server. The Flutter side handles permission, token registration with multi-server fan-out, tap-nav into native session/channel routes, mark-as-read, and Android cross-device dismissal.

**Architecture:** `firebase_core` + `firebase_messaging` for the FCM client. `MethodChannel('com.remotedev.remote_dev/notifications')` on Android for `cancelAll`. Tap-nav converges through `AppRouter.navigateTo(AppRoute)` (the same entry deep-links use in Phase 4).

**Tech Stack:** `firebase_core` ^3.6.0, `firebase_messaging` ^15.1.3 (already in `pubspec.yaml` from Phase 1). Flutter platform channels for Android `cancelAll`.

**Spec:** §5 (push notifications).

**Out of scope:** Universal/App Links + deep-link source routing (Phase 4). iOS APNs cert / Apple Developer Account setup (Phase 5 — needed for App Store submission anyway).

---

## File structure (after all 7 tasks land)

```
mobile/
├── lib/
│   ├── application/
│   │   └── ports/
│   │       └── push_port.dart           # P3.2 — port abstraction
│   ├── infrastructure/
│   │   └── push/
│   │       ├── fcm_push_service.dart    # P3.2 — init + permission + getToken
│   │       ├── push_token_registrar.dart# P3.3 — multi-server fan-out
│   │       ├── notification_tap_handler.dart # P3.4
│   │       └── android_dismissal_channel.dart # P3.6
│   └── presentation/
│       └── providers/
│           └── push_providers.dart      # Riverpod glue
├── android/
│   └── app/
│       ├── google-services.json.example # P3.1 — sample (real one gitignored)
│       └── src/main/kotlin/.../MainActivity.kt # P3.6 — registers MethodChannel
├── ios/
│   └── Runner/
│       └── GoogleService-Info.plist.example # P3.1 — sample
├── docs/
│   └── mobile-firebase-setup.md         # P3.1 — manual setup steps for the human
└── .gitignore                           # add Firebase config files
```

**Manual prerequisite (P3.1):** the human creates a Firebase project, registers the iOS + Android apps, downloads the real config files into the gitignored locations. The Flutter code gracefully degrades when these are absent — `FCMPushService.initialize()` returns false and the app continues to function, just without push.

---

## Worktree strategy

`feat/mobile-phase-3` off master. Subagents in parallel where possible.

- **Wave 1 (sequential):** P3.1 docs + .gitignore (no code; just paths + setup guide).
- **Wave 2 (3 parallel):** P3.2 FCM init || P3.6 Android MethodChannel || P3.7 sign-out delete.
- **Wave 3 (sequential after Wave 2):** P3.3 token registrar (depends on P3.2).
- **Wave 4 (2 parallel):** P3.4 tap-nav handler || P3.5 mark-as-read (P3.5 depends on P3.4 actually — no, mark-read is an independent API call from the tap handler; both can run in parallel as they touch different files).

---

## Task 1 (P3.1): Firebase project setup docs + gitignored config

**Worktree:** `../remote-dev-flutter-p3-firebase` on `feat/mobile-phase-3-firebase`

### Goals

- `docs/mobile-firebase-setup.md` — step-by-step manual procedure for the human.
- `.gitignore` add: `mobile/android/app/google-services.json`, `mobile/ios/Runner/GoogleService-Info.plist`.
- Create `.example` placeholder files at the expected paths so the build doesn't fail on missing files.

### Step 1: Write `docs/mobile-firebase-setup.md`

```markdown
# Firebase Setup for the Remote Dev Mobile App (Phase 3)

This is a one-time manual setup the project owner runs. The Flutter code in `mobile/` works without it (push silently disabled), but real push notifications require these steps.

## 1. Create the Firebase project

1. Go to https://console.firebase.google.com → **Add project**.
2. Name it `remote-dev-mobile` (or similar). Disable Google Analytics if you don't need it.

## 2. Register the Android app

1. In the project, **Add app → Android**.
2. Package name: `com.remotedev.app`.
3. App nickname: `Remote Dev`.
4. Download `google-services.json` → place at `mobile/android/app/google-services.json`.

## 3. Register the iOS app

1. **Add app → iOS**.
2. Bundle id: `com.remotedev.app`.
3. App nickname: `Remote Dev`.
4. Download `GoogleService-Info.plist` → place at `mobile/ios/Runner/GoogleService-Info.plist`.
5. Add the file to the Runner target in Xcode.

## 4. Upload the APNs auth key (iOS push)

1. Apple Developer → Keys → `+` → enable **Apple Push Notifications service**.
2. Download the `.p8` file.
3. Firebase console → Project Settings → Cloud Messaging → upload the `.p8` with your Team ID + Key ID.

## 5. (Server) configure FCM service-account credentials

The server already has a `PushNotificationGateway` port. To send pushes, set:
- `FCM_PROJECT_ID` (from Firebase project settings)
- `FCM_SERVICE_ACCOUNT_JSON` (Firebase Admin SDK service account key, base64-encoded for env-var transport)

## 6. Verify

1. Build + run the app. `flutter doctor` should still be clean.
2. The app's debug log should show `[Push] Initialized successfully` once a server is selected.
3. Send a test push from Firebase Console → Cloud Messaging → New campaign → Test message → enter the device's FCM token from the app log.
```

### Step 2: Add to `.gitignore`

In `mobile/.gitignore` (or root):
```
android/app/google-services.json
ios/Runner/GoogleService-Info.plist
```

### Step 3: Create `.example` placeholder files

`mobile/android/app/google-services.json.example` — minimal placeholder JSON with comments explaining where to put the real file.

`mobile/ios/Runner/GoogleService-Info.plist.example` — minimal placeholder plist.

### Step 4: Commit

```
docs(mobile/push): Firebase setup procedure + gitignored config

- docs/mobile-firebase-setup.md: 6-step manual setup guide for the human
- .gitignore: real google-services.json and GoogleService-Info.plist
- .example placeholders at the expected paths

Plan: docs/superpowers/plans/2026-05-08-flutter-app-phase-3-push.md Task 1
Co-authored-by: Isaac
```

---

## Task 2 (P3.2): FCM init + permission + token registration

**Worktree:** `../remote-dev-flutter-p3-fcm` on `feat/mobile-phase-3-fcm`

### Files

- Create: `mobile/lib/application/ports/push_port.dart`
- Create: `mobile/lib/infrastructure/push/fcm_push_service.dart`
- Modify: `mobile/lib/main.dart` — call `Firebase.initializeApp()` at startup with try/catch fallback
- Tests

### Step 1: `PushPort` interface

```dart
abstract class PushPort {
  /// Initialize FCM. Returns true on success; false if config missing
  /// or permission denied. Idempotent.
  Future<bool> initialize();

  /// Current FCM token, or null if not initialized.
  Future<String?> getToken();

  /// Stream of token-refresh events.
  Stream<String> get onTokenRefresh;

  /// Unregister token from FCM (used on app reset).
  Future<void> deleteToken();
}
```

### Step 2: `FcmPushService`

```dart
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';

import '../../application/ports/push_port.dart';

class FcmPushService implements PushPort {
  bool _initialized = false;

  @override
  Future<bool> initialize() async {
    if (_initialized) return true;
    try {
      await Firebase.initializeApp();
    } catch (e) {
      debugPrint('[Push] Firebase.initializeApp failed (config missing?): $e');
      return false;
    }
    final messaging = FirebaseMessaging.instance;
    final settings = await messaging.requestPermission(
      alert: true, badge: true, sound: true,
    );
    if (settings.authorizationStatus == AuthorizationStatus.denied) {
      return false;
    }
    // iOS: present foreground notifications.
    await messaging.setForegroundNotificationPresentationOptions(
      alert: true, badge: true, sound: true,
    );
    _initialized = true;
    return true;
  }

  @override
  Future<String?> getToken() async {
    if (!_initialized) return null;
    return FirebaseMessaging.instance.getToken();
  }

  @override
  Stream<String> get onTokenRefresh => FirebaseMessaging.instance.onTokenRefresh;

  @override
  Future<void> deleteToken() async {
    if (!_initialized) return;
    await FirebaseMessaging.instance.deleteToken();
  }
}
```

### Step 3: Modify `main.dart` to call `FcmPushService().initialize()` post-launch (non-blocking)

Don't crash if Firebase config is missing — log + continue.

### Step 4: Tests using a mocked `FirebaseMessaging`

Mocking `FirebaseMessaging.instance` requires either dependency injection or a fake. For Phase 3 simplicity: extract a `MessagingFacade` that the service injects, and mock that.

(Test plan should cover: initialize returns false on missing config; getToken returns null when not initialized; etc.)

### Commit

```
feat(mobile/push): FCM init + permission + token retrieval

- PushPort abstraction
- FcmPushService: Firebase.initializeApp + requestPermission + getToken
- iOS setForegroundNotificationPresentationOptions
- Graceful degradation when google-services.json absent
- main.dart fires init at launch (non-blocking, log on failure)

Plan: docs/superpowers/plans/2026-05-08-flutter-app-phase-3-push.md Task 2
Co-authored-by: Isaac
```

---

## Task 3 (P3.3): Token registrar with multi-server fan-out

**Worktree:** `../remote-dev-flutter-p3-registrar` on `feat/mobile-phase-3-registrar`

### Files

- Create: `mobile/lib/infrastructure/push/push_token_registrar.dart`
- Modify: `mobile/lib/application/ports/api_client_port.dart` — already has `post`/`delete`; no change
- Modify: `mobile/lib/infrastructure/api/remote_dev_client.dart` — already has helpers
- Tests

### Step 1: Implement `PushTokenRegistrar`

Listens to the `onTokenRefresh` stream. On token refresh, iterates `ServerConfigStore.loadAll()` and POSTs the new token to `/api/push-tokens` on EACH server (the deprecated app's bug — only registered with the active server — is the explicit fix here).

```dart
class PushTokenRegistrar {
  PushTokenRegistrar({
    required this.push,
    required this.serverStore,
    required this.clientFactory,
    required this.deviceId,
  });

  final PushPort push;
  final ServerConfigStore serverStore;
  // factory: takes a serverConfig + returns an ApiClientPort wired to it
  final ApiClientPort Function(ServerConfig server) clientFactory;
  final String deviceId; // stable per-device

  StreamSubscription<String>? _refreshSub;

  Future<void> start() async {
    final ok = await push.initialize();
    if (!ok) return;
    final token = await push.getToken();
    if (token != null) {
      await _registerWithAll(token);
    }
    _refreshSub = push.onTokenRefresh.listen(_registerWithAll);
  }

  Future<void> _registerWithAll(String token) async {
    final servers = await serverStore.loadAll();
    final platform = Platform.isIOS ? 'ios' : 'android';
    for (final server in servers) {
      try {
        final client = clientFactory(server);
        await client.post('/api/push-tokens', body: {
          'token': token,
          'platform': platform,
          'deviceId': deviceId,
        });
      } catch (e) {
        // Don't let one server's failure block others.
        debugPrint('[Push] register on ${server.label} failed: $e');
      }
    }
  }

  Future<void> stop() async {
    await _refreshSub?.cancel();
    _refreshSub = null;
  }
}
```

### Step 2: Tests with mocked stream + multiple servers

### Commit

```
feat(mobile/push): PushTokenRegistrar with multi-server fan-out

- Listens to FCM onTokenRefresh; registers token with EVERY saved
  server (fixes the deprecated app's single-active-server bug)
- Per-server failures don't block others (try/catch each)
- Stable deviceId from secure storage

Plan: docs/superpowers/plans/2026-05-08-flutter-app-phase-3-push.md Task 3
Co-authored-by: Isaac
```

---

## Task 4 (P3.4): Notification tap-nav

**Worktree:** `../remote-dev-flutter-p3-tap` on `feat/mobile-phase-3-tap`

### Goal

Handle three FCM lifecycle entry points: foreground (`FirebaseMessaging.onMessage`), background-tap (`onMessageOpenedApp`), terminated-state-launch (`getInitialMessage`). Route based on payload to `AppRoute.session(id)`, `AppRoute.channel(id)`, or `AppRoute.notifications()`.

### Files

- Create: `mobile/lib/infrastructure/push/notification_tap_handler.dart`
- Tests

### Step 1: `NotificationTapHandler`

```dart
class NotificationTapHandler {
  NotificationTapHandler({required this.router});
  final AppRouter router;

  Future<void> initialize() async {
    // 1. Cold start (terminated state).
    final initial = await FirebaseMessaging.instance.getInitialMessage();
    if (initial != null) _navigate(initial.data);

    // 2. Background → foreground via tap.
    FirebaseMessaging.onMessageOpenedApp.listen((m) => _navigate(m.data));
  }

  void _navigate(Map<String, dynamic> data) {
    final sessionId = data['sessionId']?.toString();
    final channelId = data['channelId']?.toString();
    if (sessionId != null && sessionId.isNotEmpty) {
      router.navigateTo(AppRoute.session(sessionId));
      return;
    }
    if (channelId != null && channelId.isNotEmpty) {
      router.navigateTo(AppRoute.channel(channelId));
      return;
    }
    router.navigateTo(const AppRoute.notifications());
  }
}
```

### Tests

Mock `AppRouter`; pass synthetic payloads; verify `navigateTo` calls.

### Commit

```
feat(mobile/push): notification tap-nav handler

- Three lifecycle entry points: getInitialMessage / onMessageOpenedApp / [foreground via P3.5]
- Payload routing: sessionId → SessionRoute, channelId → ChannelRoute, neither → NotificationsRoute
- AppRouter.navigateTo is the single sink (Phase 4 deep-links also converge here)

Plan: docs/superpowers/plans/2026-05-08-flutter-app-phase-3-push.md Task 4
Co-authored-by: Isaac
```

---

## Task 5 (P3.5): Mark-as-read on tap

**Worktree:** `../remote-dev-flutter-p3-markread` on `feat/mobile-phase-3-markread`

### Files

- Modify: `mobile/lib/infrastructure/push/notification_tap_handler.dart` — add fire-and-forget `PATCH /api/notifications {ids: [notificationId]}`
- Modify: `mobile/lib/application/ports/notifications_port.dart` (NEW) — minimal port for `markRead([ids])`
- Modify: `mobile/lib/infrastructure/api/notifications_api.dart` (NEW)
- Tests

### Step 1: Port + API

```dart
abstract class NotificationsPort {
  Future<void> markRead(List<String> ids);
}

class NotificationsApi implements NotificationsPort {
  NotificationsApi(this._client);
  final ApiClientPort _client;
  @override
  Future<void> markRead(List<String> ids) async {
    if (ids.isEmpty) return;
    await _client.patch('/api/notifications', body: {'ids': ids});
  }
}
```

(Add `patch` to `ApiClientPort` if absent.)

### Step 2: Wire into `NotificationTapHandler`

```dart
void _navigate(Map<String, dynamic> data) {
  final notificationId = data['notificationId']?.toString();
  if (notificationId != null && notificationId.isNotEmpty) {
    notificationsApi.markRead([notificationId]).catchError((e) {
      debugPrint('[Push] mark-read failed: $e');
    });
  }
  // ... routing logic ...
}
```

### Commit

```
feat(mobile/push): mark notification as read on tap (fire-and-forget)
...
```

---

## Task 6 (P3.6): Android MethodChannel for cancelAll

**Worktree:** `../remote-dev-flutter-p3-android-channel` on `feat/mobile-phase-3-android-channel`

### Goal

Native Android `MethodChannel('com.remotedev.remote_dev/notifications')` exposes `cancelAll`. Dart calls it when the PWA WebSocket reports "notifications cleared on another client".

### Files

- Modify: `mobile/android/app/src/main/kotlin/.../MainActivity.kt` — register the channel
- Create: `mobile/lib/infrastructure/push/android_dismissal_channel.dart` — Dart wrapper
- Tests (Dart side; Kotlin side is integration-tested manually)

### Step 1: Kotlin

```kotlin
class MainActivity : FlutterActivity() {
    private val CHANNEL = "com.remotedev.remote_dev/notifications"

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, CHANNEL)
            .setMethodCallHandler { call, result ->
                when (call.method) {
                    "cancelAll" -> {
                        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
                        nm.cancelAll()
                        result.success(null)
                    }
                    else -> result.notImplemented()
                }
            }
    }
}
```

### Step 2: Dart wrapper

```dart
class AndroidDismissalChannel {
  static const _channel = MethodChannel('com.remotedev.remote_dev/notifications');

  Future<void> cancelAll() async {
    if (!Platform.isAndroid) return;
    try {
      await _channel.invokeMethod('cancelAll');
    } on PlatformException catch (e) {
      debugPrint('[Push] cancelAll failed: $e');
    } on MissingPluginException {
      // Native side not yet wired (test environment).
    }
  }
}
```

### Commit

```
feat(mobile/push): Android MethodChannel for cancelAll
...
```

---

## Task 7 (P3.7): Sign-out flow — DELETE /api/push-tokens/<token>

**Worktree:** `../remote-dev-flutter-p3-signout` on `feat/mobile-phase-3-signout`

### Goal

When the user removes a server (delete-server flow) or signs out, DELETE the per-server FCM token registration on that server.

### Files

- Modify: `mobile/lib/infrastructure/push/push_token_registrar.dart` — add `unregisterFromServer(serverId)` method
- Modify: `mobile/lib/presentation/screens/server_picker/server_picker_screen.dart` — call `unregisterFromServer` before `serverStore.remove(id)`
- Tests

### Step 1: `unregisterFromServer`

```dart
Future<void> unregisterFromServer(String serverId) async {
  final token = await push.getToken();
  if (token == null) return;
  final servers = await serverStore.loadAll();
  ServerConfig? target;
  for (final s in servers) {
    if (s.id == serverId) {
      target = s;
      break;
    }
  }
  if (target == null) return;
  try {
    final client = clientFactory(target);
    await client.delete('/api/push-tokens/$token');
  } catch (e) {
    debugPrint('[Push] unregister on ${target.label} failed: $e');
  }
}
```

### Commit

```
feat(mobile/push): unregister FCM token on server-delete / sign-out
...
```

---

## Phase 3 ship gate

- [ ] `flutter analyze` clean
- [ ] `flutter test` passes (existing 95+ + new push tests)
- [ ] `flutter build apk --debug` succeeds **with placeholder Firebase config** (graceful degradation)
- [ ] Manually verify (post-merge, after `docs/mobile-firebase-setup.md` runs):
  - Push permission prompt fires on first launch.
  - FCM token logged on init.
  - Test push from Firebase console arrives + tap-nav routes correctly.
  - Sign-out / delete-server unregisters the token.

## Out of scope — deferred

- iOS App Store submission + APNs production config (Phase 5).
- Real notification UI (Notifications tab — Phase 4).
- Cross-device dismissal listener (depends on Phase 4 channel WebSocket; for now `AndroidDismissalChannel.cancelAll` is callable but no caller wires it).
