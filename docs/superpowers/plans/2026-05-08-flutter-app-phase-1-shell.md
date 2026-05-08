# Flutter App — Phase 1: Shell Scaffold + WebView Host + In-WebView CF Access Auth

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development`. Each task dispatched as a fresh subagent in its own git worktree. Steps use checkbox (`- [ ]`) syntax for tracking. **All implementation must be performed by subagents in worktrees per project rule.**

**Goal:** Stand up the new Flutter mobile app at `mobile/` with a `flutter_inappwebview`-based shell that loads `/m/<surface>/<id>` PWA routes (shipped in Phase 0), handles CF Access authentication inside the WebView, extracts the cookie, and uses it for native API calls.

**Architecture:** Hybrid native + WebView Flutter app, layered as `presentation` (screens, widgets) → `application` (use cases, ports) → `infrastructure` (Dio HTTP, flutter_inappwebview, flutter_secure_storage). Riverpod for state, go_router for navigation, Dio for HTTP, flutter_inappwebview 6.x for WebView, flutter_secure_storage for credentials. Per-server isolation: secure-storage keys prefixed by `serverId`. Single-source-of-truth for cookies during auth: WebView CookieManager → relayed to flutter_secure_storage → Dio reads from storage on every request.

**Tech Stack:** Dart `>=3.4.0 <4.0.0`, Flutter `>=3.22.0`. Dependencies (full list in P1.1).

**Spec:** [`docs/superpowers/specs/2026-05-08-flutter-app-redesign-design.md`](../specs/2026-05-08-flutter-app-redesign-design.md) §2.2 (architectural rules), §3 (auth flow), §9 (project layout & deps).

**Out of scope (deferred to later plans):** Phase 1.5 bridge smoke-test (separate plan), Phase 2 native session-view chrome, Phase 3 push notifications, Phase 4+ polish.

---

## Worktree & branch strategy

All Phase 1 work lands on a single feature branch `feat/mobile-phase-1` off `master`. Subagents work in worktrees:

- **P1.1** runs first, alone, in worktree `../remote-dev-flutter-p1-scaffold` on branch `feat/mobile-phase-1`. Its commits are merged to `master` only after P1.10 is complete (single PR for all of Phase 1).
- **Wave-2 tasks (P1.2, P1.3, P1.9, P1.10)** run in PARALLEL, each in its own worktree branched off `feat/mobile-phase-1`. After each completes, the controller merges its branch back to `feat/mobile-phase-1` (squash-merge to keep history clean; resolve any pubspec.yaml conflicts during merge).
- Subsequent waves (P1.4 → P1.5/P1.8 → P1.6 → P1.7) also use parallel worktrees where dependencies allow.

Each worktree must run `flutter pub get` once after creation. There is no equivalent of `worktree-warm.sh` for Flutter; cold pub get takes 30–60 s on the first run, near-instant after that thanks to the global pub cache.

## File Structure

After all 10 tasks land, the `mobile/` directory looks like:

```
mobile/
├── android/                              # Android platform shell (P1.1)
│   ├── app/
│   │   ├── build.gradle                  # signing config from RDV_ANDROID_* env vars (P1.10 augments)
│   │   ├── src/main/AndroidManifest.xml
│   │   └── src/main/res/                 # adaptive icon, splash drawables (P1.2)
│   └── key.properties.example            # local dev signing fallback (gitignored real one)
├── ios/                                  # iOS platform shell (P1.1)
│   ├── Runner/Info.plist                 # bundle id, splash screen storyboard ref (P1.2)
│   └── Runner/Assets.xcassets/           # splash + app icon (P1.2)
├── lib/
│   ├── main.dart                         # P1.1 — entry point, ProviderScope
│   ├── app.dart                          # P1.1 — MaterialApp + router
│   ├── domain/                           # P1.1 — base models (mostly DTOs, expanded later phases)
│   │   └── server_config.dart            # ServerConfig value object (P1.3)
│   ├── application/
│   │   └── ports/
│   │       ├── secure_storage_port.dart  # P1.3
│   │       ├── server_config_store.dart  # P1.3
│   │       ├── api_client_port.dart      # P1.6
│   │       └── cookie_reader_port.dart   # P1.5
│   ├── infrastructure/
│   │   ├── auth/
│   │   │   └── cookie_reader.dart        # P1.5 — extracts CF_Authorization from WebView
│   │   ├── api/
│   │   │   ├── remote_dev_client.dart    # P1.6 — Dio-based, cookie-from-storage
│   │   │   └── auth_interceptor.dart     # P1.6 — injects Cookie header
│   │   ├── webview/
│   │   │   ├── webview_factory.dart      # P1.4 — InAppWebView builder w/ correct settings
│   │   │   └── navigation_policy.dart    # P1.4 — only allow <serverOrigin>/m/* + CF challenge
│   │   └── storage/
│   │       ├── flutter_secure_storage_port.dart  # P1.3 — SecureStoragePort impl
│   │       └── server_config_store_impl.dart     # P1.3 — list of servers, active server
│   └── presentation/
│       ├── router/
│       │   ├── app_route.dart            # P1.9 — sealed class
│       │   └── app_router.dart           # P1.9 — go_router config + AppRoute → path
│       └── screens/
│           ├── splash/
│           │   └── splash_screen.dart    # P1.2 — Flutter side (covers WebView preload)
│           ├── server_picker/
│           │   ├── server_picker_screen.dart   # P1.8
│           │   └── add_server_screen.dart      # P1.8
│           ├── webview_host/
│           │   ├── webview_host_screen.dart    # P1.4 — hosts InAppWebView
│           │   └── reauth_screen.dart          # P1.7 — "Authentication needed" recovery
│           └── error/
│               └── network_error_screen.dart   # P1.7 — server unreachable / offline
├── test/                                 # Flutter unit + widget tests
│   ├── infrastructure/
│   │   ├── storage/server_config_store_test.dart
│   │   ├── auth/cookie_reader_test.dart
│   │   └── api/auth_interceptor_test.dart
│   └── presentation/
│       └── router/app_router_test.dart
├── pubspec.yaml                          # P1.1 — all deps + flutter_native_splash config
├── pubspec.lock
├── analysis_options.yaml                 # P1.1 — flutter_lints + custom rules
├── flutter_native_splash.yaml            # P1.2 — splash config (referenced by pubspec)
└── README.md                             # P1.1
```

CI workflow:

```
.github/workflows/
└── mobile-release.yml                    # P1.10 — Android App Bundle on tag mobile-v*
```

---

## Architectural rules (load-bearing — every subagent must respect)

These come from spec §2.2 and the Phase 0 review:

1. **All `addJavaScriptHandler` registrations happen in `onWebViewCreated`, never in `onLoadStop`.** Lazy registration causes `TypeError` during page init.
2. **Native-to-WebView calls are gated on a future `terminal-connected` event** (Phase 1.5+). Phase 1's WebView host doesn't issue any bridge calls yet — that comes in Phase 2.
3. **Dio NEVER reads from the WebView cookie store directly.** WebView → `flutter_secure_storage` → Dio. No shortcuts.
4. **WebView construction is deferred until biometric gate resolves.** Phase 1 has no biometric yet, so this rule is dormant — but the WebView-host screen MUST be a separate route reachable only from server-picker selection, so future biometric gating slots in cleanly.
5. **WebView navigation policy: only allow `<serverOrigin>/m/*`.** All other URLs are intercepted via `shouldOverrideUrlLoading` and routed to `onLinkOpen` (Phase 2 implements; for now, just intercept and ignore).
6. **Per-server isolation in storage:** `flutter_secure_storage` keys are prefixed by `serverId` (UUID generated when the server is added).

---

## Bite-Sized Task Granularity

**Each step is one action (2–5 min):**
- "Write the failing widget test" — step
- "Run `flutter test` to make sure it fails" — step
- "Implement the minimal code" — step
- "Run `flutter test` and confirm pass" — step
- "Commit" — step

For Flutter, tests run with `cd mobile && flutter test [path]`. Static analysis is `flutter analyze`. Type-checking is part of `flutter analyze`.

---

## Task 1: Scaffold the `mobile/` Flutter project

**Wave:** 1 (sequential, foundational — must complete before Wave 2)
**Worktree:** `../remote-dev-flutter-p1-scaffold` on branch `feat/mobile-phase-1`
**Files (create):**
- `mobile/pubspec.yaml`
- `mobile/analysis_options.yaml`
- `mobile/lib/main.dart`
- `mobile/lib/app.dart`
- `mobile/lib/domain/.gitkeep`
- `mobile/lib/application/ports/.gitkeep`
- `mobile/lib/infrastructure/.gitkeep`
- `mobile/lib/presentation/.gitkeep`
- `mobile/test/widget_test.dart` (smoke)
- `mobile/README.md`
- `mobile/android/` and `mobile/ios/` (created by `flutter create`)

- [ ] **Step 1: Create the Flutter project**

```bash
cd /Users/bryan.li/Projects/remote-dev-flutter-p1-scaffold  # the worktree
flutter create \
  --org com.remotedev \
  --project-name remote_dev \
  --platforms=ios,android \
  --no-pub \
  mobile
```

Expected: directory `mobile/` created with `android/`, `ios/`, `lib/`, `test/`, `pubspec.yaml`. The `--no-pub` flag skips `pub get` so we can edit `pubspec.yaml` first. `--org com.remotedev` and `--project-name remote_dev` together produce bundle id `com.remotedev.remote_dev` — we'll fix that to `com.remotedev.app` in step 2 to match the deprecated app's identifier.

- [ ] **Step 2: Update bundle id to `com.remotedev.app`**

Edit `mobile/android/app/build.gradle.kts` (or `build.gradle`): change `applicationId` from `"com.remotedev.remote_dev"` to `"com.remotedev.app"`. Edit `mobile/ios/Runner.xcodeproj/project.pbxproj`: change `PRODUCT_BUNDLE_IDENTIFIER` from `com.remotedev.remoteDev` to `com.remotedev.app` in all 3 build configurations (Debug, Profile, Release).

Verify via grep:
```bash
grep -r "com.remotedev" mobile/android/app/ mobile/ios/Runner.xcodeproj/
```

Expected: every match shows `com.remotedev.app` (no `.remote_dev`, `.remoteDev`).

- [ ] **Step 3: Write `mobile/pubspec.yaml` with all Phase 1 dependencies**

```yaml
name: remote_dev
description: Remote Dev mobile app
publish_to: "none"
version: 0.1.0

environment:
  sdk: ">=3.4.0 <4.0.0"
  flutter: ">=3.22.0"

dependencies:
  flutter:
    sdk: flutter
  cupertino_icons: ^1.0.8

  # State
  flutter_riverpod: ^2.6.1
  riverpod_annotation: ^2.6.1

  # HTTP + cookies
  dio: ^5.7.0
  cookie_jar: ^4.0.8
  dio_cookie_manager: ^3.1.1

  # WebView
  flutter_inappwebview: ^6.1.5

  # Routing
  go_router: ^14.6.2

  # Storage
  flutter_secure_storage: ^9.2.2
  shared_preferences: ^2.3.3

  # Connectivity awareness (used in Phase 2 error surface; install now)
  connectivity_plus: ^6.0.5

  # Models
  freezed_annotation: ^2.4.4
  json_annotation: ^4.9.0

  # UUID for serverId
  uuid: ^4.5.1

dev_dependencies:
  flutter_test:
    sdk: flutter
  flutter_lints: ^5.0.0

  # Code generation
  build_runner: ^2.4.13
  freezed: ^2.5.7
  json_serializable: ^6.8.0
  riverpod_generator: ^2.6.3

  # Test helpers
  mocktail: ^1.0.4

flutter:
  uses-material-design: true
  # flutter_native_splash assets and config land in P1.2
```

Run `flutter pub get` from `mobile/` and confirm 0 errors.

- [ ] **Step 4: Write `mobile/analysis_options.yaml`**

```yaml
include: package:flutter_lints/flutter.yaml

analyzer:
  exclude:
    - "**/*.g.dart"
    - "**/*.freezed.dart"
  language:
    strict-casts: true
    strict-inference: true
    strict-raw-types: true

linter:
  rules:
    avoid_print: true
    prefer_single_quotes: true
    require_trailing_commas: true
```

- [ ] **Step 5: Write `mobile/lib/main.dart`**

```dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'app.dart';

void main() {
  runApp(const ProviderScope(child: RemoteDevApp()));
}
```

- [ ] **Step 6: Write `mobile/lib/app.dart` (placeholder router; P1.9 fleshes it out)**

```dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

class RemoteDevApp extends ConsumerWidget {
  const RemoteDevApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return MaterialApp(
      title: 'Remote Dev',
      theme: ThemeData(
        useMaterial3: true,
        colorSchemeSeed: const Color(0xFF7AA2F7), // Tokyo Night blue
        brightness: Brightness.dark,
        scaffoldBackgroundColor: const Color(0xFF1A1B26),
      ),
      home: const _PlaceholderScreen(),
    );
  }
}

class _PlaceholderScreen extends StatelessWidget {
  const _PlaceholderScreen();

  @override
  Widget build(BuildContext context) {
    return const Scaffold(
      body: Center(
        child: Text(
          'Remote Dev — Phase 1 scaffold',
          style: TextStyle(color: Colors.white),
        ),
      ),
    );
  }
}
```

- [ ] **Step 7: Write the smoke widget test `mobile/test/widget_test.dart`**

```dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:remote_dev/app.dart';

void main() {
  testWidgets('app boots and shows the placeholder', (tester) async {
    await tester.pumpWidget(const ProviderScope(child: RemoteDevApp()));
    expect(find.text('Remote Dev — Phase 1 scaffold'), findsOneWidget);
  });
}
```

- [ ] **Step 8: Run tests + analyze**

```bash
cd mobile
flutter test
flutter analyze
```

Expected: 1 test passing, 0 analyzer issues.

- [ ] **Step 9: Write `mobile/README.md`**

Brief, ≤30 lines: project purpose, dev setup (`cd mobile && flutter pub get && flutter run`), test commands (`flutter test`, `flutter analyze`), reference to spec/plan.

- [ ] **Step 10: Commit**

```bash
git add mobile/ .gitignore  # .gitignore may need a new entry for *.iml etc.
git commit -m "feat(mobile): scaffold Flutter project with Phase 1 deps

- com.remotedev.app bundle id (preserved from deprecated app)
- Dart 3.4+ / Flutter 3.22+
- Riverpod, Dio, flutter_inappwebview 6.x, go_router, flutter_secure_storage, etc.
- Tokyo Night-themed placeholder screen
- Smoke widget test passing

Plan: docs/superpowers/plans/2026-05-08-flutter-app-phase-1-shell.md Task 1

Co-authored-by: Isaac"
```

After this commit lands on `feat/mobile-phase-1` (via merge from the worktree), Wave 2 can proceed in parallel.

---

## Task 2: Native splash + Android edge-to-edge

**Wave:** 2 (parallel)
**Worktree:** `../remote-dev-flutter-p1-splash`
**Files:**
- `mobile/pubspec.yaml` — add `flutter_native_splash` to `dev_dependencies` + `flutter_native_splash:` config block
- `mobile/assets/splash/splash_icon.png` — 1024×1024 logo on transparent bg
- `mobile/lib/presentation/screens/splash/splash_screen.dart`
- `mobile/test/presentation/screens/splash_screen_test.dart`

- [ ] **Step 1: Add the splash dev-dependency + config to `pubspec.yaml`**

```yaml
dev_dependencies:
  flutter_native_splash: ^2.4.3
  # … existing dev deps …

flutter_native_splash:
  color: "#1A1B26"
  image: assets/splash/splash_icon.png
  android_12:
    color: "#1A1B26"
    image: assets/splash/splash_icon.png
  fullscreen: true   # REQUIRED for Android 15+ edge-to-edge — without it, splash has a white bar
  android_gravity: center
  ios_content_mode: center
```

Add the asset to the `flutter:` section:

```yaml
flutter:
  uses-material-design: true
  assets:
    - assets/splash/
```

- [ ] **Step 2: Add a placeholder splash icon**

Create `mobile/assets/splash/splash_icon.png` as a 1024×1024 PNG with the Tokyo Night blue (#7AA2F7) Remote Dev mark on transparent background. Real branding can be swapped in Phase 5; for now any Tokyo-Night-styled placeholder works — generate via `convert -size 1024x1024 xc:transparent -fill "#7AA2F7" -gravity center -font Helvetica -pointsize 96 -annotate 0 "RDV" mobile/assets/splash/splash_icon.png` or hand-design.

- [ ] **Step 3: Generate platform splash assets**

```bash
cd mobile
dart run flutter_native_splash:create
```

Expected: assets generated under `android/app/src/main/res/drawable*/splash.png`, `ios/Runner/Assets.xcassets/LaunchImage.imageset/`, etc.

- [ ] **Step 4: Implement `lib/presentation/screens/splash/splash_screen.dart`**

This is the **Flutter-side** splash that takes over from the native launch image. It covers WebView preload until the WebView reports ready (Phase 2). For Phase 1 it's a simple branded screen with a centered loading indicator, and a delayed CTA.

```dart
import 'package:flutter/material.dart';

class SplashScreen extends StatefulWidget {
  const SplashScreen({super.key, this.onTroubleLoading});

  /// Called after [troubleLoadingDelay] of no progress; the host screen
  /// can route to the server picker or a recovery flow.
  final VoidCallback? onTroubleLoading;

  static const Duration troubleLoadingDelay = Duration(seconds: 8);

  @override
  State<SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends State<SplashScreen> {
  bool _showTroubleCta = false;

  @override
  void initState() {
    super.initState();
    Future<void>.delayed(SplashScreen.troubleLoadingDelay, () {
      if (!mounted) return;
      setState(() => _showTroubleCta = true);
    });
  }

  @override
  Widget build(BuildContext context) {
    return const Scaffold(
      backgroundColor: Color(0xFF1A1B26),
      body: SafeArea(
        child: Center(
          child: _SplashContent(),
        ),
      ),
    );
  }
}

class _SplashContent extends StatelessWidget {
  const _SplashContent();

  @override
  Widget build(BuildContext context) {
    // Phase 1: minimal centered indicator. Phase 2 wires the
    // "trouble loading" CTA from the parent state.
    return const SizedBox(
      width: 64,
      height: 64,
      child: CircularProgressIndicator(
        strokeWidth: 3,
        valueColor: AlwaysStoppedAnimation(Color(0xFF7AA2F7)),
      ),
    );
  }
}
```

(The trouble-loading CTA wires into Phase 2's WebView host — for Phase 1 we just show the indicator.)

- [ ] **Step 5: Write the splash widget test**

```dart
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:remote_dev/presentation/screens/splash/splash_screen.dart';

void main() {
  testWidgets('SplashScreen shows a progress indicator', (tester) async {
    await tester.pumpWidget(const MaterialApp(home: SplashScreen()));
    expect(find.byType(CircularProgressIndicator), findsOneWidget);
  });
}
```

- [ ] **Step 6: Run tests + analyze + commit**

```bash
cd mobile
flutter test test/presentation/screens/splash_screen_test.dart
flutter analyze
```

```bash
git add mobile/pubspec.yaml mobile/assets/splash/ mobile/lib/presentation/screens/splash/ mobile/test/presentation/screens/splash_screen_test.dart mobile/android/app/src/main/res/ mobile/ios/Runner/Assets.xcassets/ mobile/ios/Runner/Base.lproj/LaunchScreen.storyboard
git commit -m "feat(mobile): native splash via flutter_native_splash + edge-to-edge

- Tokyo Night-themed launch image
- fullscreen: true for Android 15+ edge-to-edge compliance
- Flutter-side SplashScreen widget covers WebView preload (Phase 2)
- Smoke widget test passing

Plan: docs/superpowers/plans/2026-05-08-flutter-app-phase-1-shell.md Task 2

Co-authored-by: Isaac"
```

---

## Task 3: SecureStoragePort + ServerConfigStore + per-server isolation

**Wave:** 2 (parallel)
**Worktree:** `../remote-dev-flutter-p1-storage`
**Files:**
- `mobile/lib/domain/server_config.dart`
- `mobile/lib/application/ports/secure_storage_port.dart`
- `mobile/lib/application/ports/server_config_store.dart`
- `mobile/lib/infrastructure/storage/flutter_secure_storage_port.dart`
- `mobile/lib/infrastructure/storage/server_config_store_impl.dart`
- `mobile/test/infrastructure/storage/server_config_store_test.dart`
- `mobile/test/infrastructure/storage/flutter_secure_storage_port_test.dart`

- [ ] **Step 1: Define `ServerConfig` value object**

```dart
// mobile/lib/domain/server_config.dart
import 'package:freezed_annotation/freezed_annotation.dart';

part 'server_config.freezed.dart';
part 'server_config.g.dart';

@freezed
class ServerConfig with _$ServerConfig {
  const factory ServerConfig({
    required String id,
    required String label,
    required String url,
    required DateTime lastUsedAt,
  }) = _ServerConfig;

  factory ServerConfig.fromJson(Map<String, dynamic> json) =>
      _$ServerConfigFromJson(json);
}
```

- [ ] **Step 2: Define `SecureStoragePort` interface**

```dart
// mobile/lib/application/ports/secure_storage_port.dart
abstract class SecureStoragePort {
  /// Read the value at [key] for the given [serverId]. Returns null if absent.
  Future<String?> read(String serverId, String key);

  /// Write [value] at [key] for the given [serverId].
  Future<void> write(String serverId, String key, String value);

  /// Delete the entry at [key] for the given [serverId]. No-op if absent.
  Future<void> delete(String serverId, String key);

  /// Delete every key for [serverId] (used on sign-out / delete-server).
  Future<void> deleteAll(String serverId);
}
```

- [ ] **Step 3: Define `ServerConfigStore` interface**

```dart
// mobile/lib/application/ports/server_config_store.dart
import '../../domain/server_config.dart';

abstract class ServerConfigStore {
  Future<List<ServerConfig>> loadAll();
  Future<ServerConfig?> loadActive();
  Future<void> setActive(String serverId);
  Future<void> upsert(ServerConfig config);
  Future<void> remove(String serverId);
}
```

- [ ] **Step 4: Implement `FlutterSecureStoragePort`**

```dart
// mobile/lib/infrastructure/storage/flutter_secure_storage_port.dart
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import '../../application/ports/secure_storage_port.dart';

class FlutterSecureStoragePort implements SecureStoragePort {
  FlutterSecureStoragePort([FlutterSecureStorage? storage])
      : _storage = storage ?? const FlutterSecureStorage(
          aOptions: AndroidOptions(encryptedSharedPreferences: true),
          iOptions: IOSOptions(
            accessibility: KeychainAccessibility.first_unlock_this_device,
          ),
        );

  final FlutterSecureStorage _storage;

  String _key(String serverId, String key) => 'server.$serverId.$key';

  @override
  Future<String?> read(String serverId, String key) =>
      _storage.read(key: _key(serverId, key));

  @override
  Future<void> write(String serverId, String key, String value) =>
      _storage.write(key: _key(serverId, key), value: value);

  @override
  Future<void> delete(String serverId, String key) =>
      _storage.delete(key: _key(serverId, key));

  @override
  Future<void> deleteAll(String serverId) async {
    final all = await _storage.readAll();
    final prefix = 'server.$serverId.';
    for (final key in all.keys.where((k) => k.startsWith(prefix))) {
      await _storage.delete(key: key);
    }
  }
}
```

- [ ] **Step 5: Implement `ServerConfigStoreImpl`** that uses `SecureStoragePort` for the server list (under a sentinel `serverId = "__meta__"`).

```dart
// mobile/lib/infrastructure/storage/server_config_store_impl.dart
import 'dart:convert';
import '../../application/ports/secure_storage_port.dart';
import '../../application/ports/server_config_store.dart';
import '../../domain/server_config.dart';

class ServerConfigStoreImpl implements ServerConfigStore {
  ServerConfigStoreImpl(this._storage);

  final SecureStoragePort _storage;

  static const _metaServerId = '__meta__';
  static const _serverListKey = 'servers';
  static const _activeServerKey = 'active_server_id';

  @override
  Future<List<ServerConfig>> loadAll() async {
    final raw = await _storage.read(_metaServerId, _serverListKey);
    if (raw == null || raw.isEmpty) return const [];
    final list = (jsonDecode(raw) as List).cast<Map<String, dynamic>>();
    return list.map(ServerConfig.fromJson).toList(growable: false);
  }

  @override
  Future<ServerConfig?> loadActive() async {
    final id = await _storage.read(_metaServerId, _activeServerKey);
    if (id == null) return null;
    final all = await loadAll();
    for (final cfg in all) {
      if (cfg.id == id) return cfg;
    }
    return null;
  }

  @override
  Future<void> setActive(String serverId) =>
      _storage.write(_metaServerId, _activeServerKey, serverId);

  @override
  Future<void> upsert(ServerConfig config) async {
    final list = await loadAll();
    final updated = [
      ...list.where((c) => c.id != config.id),
      config,
    ]..sort((a, b) => b.lastUsedAt.compareTo(a.lastUsedAt));
    await _storage.write(
      _metaServerId,
      _serverListKey,
      jsonEncode(updated.map((c) => c.toJson()).toList()),
    );
  }

  @override
  Future<void> remove(String serverId) async {
    final list = await loadAll();
    final updated = list.where((c) => c.id != serverId).toList();
    await _storage.write(
      _metaServerId,
      _serverListKey,
      jsonEncode(updated.map((c) => c.toJson()).toList()),
    );
    // Clear all per-server data.
    await _storage.deleteAll(serverId);
    // If this was the active server, fall back to the most-recent remaining.
    final activeId = await _storage.read(_metaServerId, _activeServerKey);
    if (activeId == serverId) {
      if (updated.isNotEmpty) {
        await setActive(updated.first.id);
      } else {
        await _storage.delete(_metaServerId, _activeServerKey);
      }
    }
  }
}
```

- [ ] **Step 6: Run code generation**

```bash
cd mobile
dart run build_runner build --delete-conflicting-outputs
```

Expected: `server_config.freezed.dart`, `server_config.g.dart` generated. 0 build errors.

- [ ] **Step 7: Write tests for `ServerConfigStoreImpl` using `mocktail`**

```dart
// mobile/test/infrastructure/storage/server_config_store_test.dart
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:remote_dev/application/ports/secure_storage_port.dart';
import 'package:remote_dev/domain/server_config.dart';
import 'package:remote_dev/infrastructure/storage/server_config_store_impl.dart';

class _MockStorage extends Mock implements SecureStoragePort {}

void main() {
  late _MockStorage storage;
  late ServerConfigStoreImpl store;

  setUp(() {
    storage = _MockStorage();
    store = ServerConfigStoreImpl(storage);
  });

  ServerConfig _config(String id, {String label = 'Server', DateTime? at}) =>
      ServerConfig(
        id: id,
        label: label,
        url: 'https://$id.example.com',
        lastUsedAt: at ?? DateTime(2026, 5, 8),
      );

  test('loadAll returns empty list when nothing is stored', () async {
    when(() => storage.read('__meta__', 'servers')).thenAnswer((_) async => null);
    final result = await store.loadAll();
    expect(result, isEmpty);
  });

  test('upsert appends a new config and sorts by lastUsedAt desc', () async {
    when(() => storage.read('__meta__', 'servers'))
        .thenAnswer((_) async => jsonEncode([_config('a', at: DateTime(2026, 5, 1)).toJson()]));
    when(() => storage.write(any(), any(), any())).thenAnswer((_) async {});

    await store.upsert(_config('b', at: DateTime(2026, 5, 8)));

    final captured = verify(() => storage.write('__meta__', 'servers', captureAny()))
        .captured.single as String;
    final list = (jsonDecode(captured) as List).cast<Map<String, dynamic>>();
    expect(list.first['id'], 'b');
    expect(list.last['id'], 'a');
  });

  test('remove drops the entry and clears its per-server data', () async {
    when(() => storage.read('__meta__', 'servers'))
        .thenAnswer((_) async => jsonEncode([_config('a').toJson(), _config('b').toJson()]));
    when(() => storage.read('__meta__', 'active_server_id'))
        .thenAnswer((_) async => 'a');
    when(() => storage.write(any(), any(), any())).thenAnswer((_) async {});
    when(() => storage.deleteAll('a')).thenAnswer((_) async {});

    await store.remove('a');

    verify(() => storage.deleteAll('a')).called(1);
    verify(() => storage.write('__meta__', 'active_server_id', 'b')).called(1);
  });
}
```

(Add an analogous test for `setActive` and `loadActive`.)

- [ ] **Step 8: Test the secure-storage adapter for key prefixing**

```dart
// mobile/test/infrastructure/storage/flutter_secure_storage_port_test.dart
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:remote_dev/infrastructure/storage/flutter_secure_storage_port.dart';

class _MockStorage extends Mock implements FlutterSecureStorage {}

void main() {
  late _MockStorage backing;
  late FlutterSecureStoragePort port;

  setUp(() {
    backing = _MockStorage();
    port = FlutterSecureStoragePort(backing);
  });

  test('read prefixes the key with serverId', () async {
    when(() => backing.read(key: 'server.abc.cf_token'))
        .thenAnswer((_) async => 'tok');
    final result = await port.read('abc', 'cf_token');
    expect(result, 'tok');
  });

  test('deleteAll removes only entries for the given serverId', () async {
    when(() => backing.readAll()).thenAnswer((_) async => {
          'server.abc.cf_token': 'tok',
          'server.abc.api_key': 'key',
          'server.xyz.cf_token': 'other',
        });
    when(() => backing.delete(key: any(named: 'key'))).thenAnswer((_) async {});

    await port.deleteAll('abc');

    verify(() => backing.delete(key: 'server.abc.cf_token')).called(1);
    verify(() => backing.delete(key: 'server.abc.api_key')).called(1);
    verifyNever(() => backing.delete(key: 'server.xyz.cf_token'));
  });
}
```

- [ ] **Step 9: Run + commit**

```bash
cd mobile && flutter test && flutter analyze
```

```bash
git add mobile/lib/domain/ mobile/lib/application/ports/secure_storage_port.dart mobile/lib/application/ports/server_config_store.dart mobile/lib/infrastructure/storage/ mobile/test/infrastructure/storage/
git commit -m "feat(mobile): SecureStoragePort + ServerConfigStore with per-server isolation

- ServerConfig freezed model with JSON codec
- SecureStoragePort interface (read/write/delete/deleteAll, all keyed by serverId)
- FlutterSecureStoragePort impl that prefixes every key with 'server.<id>.'
- ServerConfigStore lists/upserts/removes server entries; tracks active server
- mocktail-driven unit tests for both stores

Plan: docs/superpowers/plans/2026-05-08-flutter-app-phase-1-shell.md Task 3

Co-authored-by: Isaac"
```

---

## Task 4: WebView host with `onWebViewCreated` handler registration + navigation policy

**Wave:** 3 (sequential, after P1.3 lands on `feat/mobile-phase-1`)
**Worktree:** `../remote-dev-flutter-p1-webview`
**Files:**
- `mobile/lib/infrastructure/webview/webview_factory.dart`
- `mobile/lib/infrastructure/webview/navigation_policy.dart`
- `mobile/lib/presentation/screens/webview_host/webview_host_screen.dart`
- `mobile/test/infrastructure/webview/navigation_policy_test.dart`

- [ ] **Step 1: Implement `NavigationPolicy`**

A pure function the WebView's `shouldOverrideUrlLoading` calls to decide ALLOW / INTERCEPT / REDIRECT. Pure → easy to unit test.

```dart
// mobile/lib/infrastructure/webview/navigation_policy.dart

enum NavigationDecision { allow, interceptAndOpenExternally, intercept }

class NavigationPolicy {
  const NavigationPolicy({required this.serverOrigin});

  final Uri serverOrigin; // e.g. https://dev.example.com

  /// Returns [NavigationDecision.allow] only for paths under the server's
  /// /m/* embed routes and Cloudflare Access challenge URLs. All other
  /// URLs (terminal-output links, external sites) are intercepted.
  NavigationDecision decide(Uri uri) {
    if (_isCfAccessChallenge(uri)) return NavigationDecision.allow;
    if (uri.origin != serverOrigin.origin) {
      return NavigationDecision.interceptAndOpenExternally;
    }
    if (!uri.path.startsWith('/m/')) {
      return NavigationDecision.intercept;
    }
    return NavigationDecision.allow;
  }

  static bool _isCfAccessChallenge(Uri uri) {
    final host = uri.host.toLowerCase();
    return host.endsWith('.cloudflareaccess.com') ||
        host == 'cloudflareaccess.com';
  }
}
```

- [ ] **Step 2: Test `NavigationPolicy`**

```dart
// mobile/test/infrastructure/webview/navigation_policy_test.dart
import 'package:flutter_test/flutter_test.dart';
import 'package:remote_dev/infrastructure/webview/navigation_policy.dart';

void main() {
  final policy = NavigationPolicy(serverOrigin: Uri.parse('https://dev.example.com'));

  test('allows /m/* on the server origin', () {
    expect(
      policy.decide(Uri.parse('https://dev.example.com/m/session/abc')),
      NavigationDecision.allow,
    );
  });

  test('intercepts non-/m/ on the server origin', () {
    expect(
      policy.decide(Uri.parse('https://dev.example.com/sessions')),
      NavigationDecision.intercept,
    );
  });

  test('allows Cloudflare Access challenge URLs', () {
    expect(
      policy.decide(Uri.parse('https://example.cloudflareaccess.com/login')),
      NavigationDecision.allow,
    );
  });

  test('opens external links externally', () {
    expect(
      policy.decide(Uri.parse('https://github.com/btli/remote-dev')),
      NavigationDecision.interceptAndOpenExternally,
    );
  });
}
```

- [ ] **Step 3: Implement `WebViewFactory`**

A small class that produces an `InAppWebView` configured per spec §2.2 rules.

```dart
// mobile/lib/infrastructure/webview/webview_factory.dart
import 'package:flutter/foundation.dart';
import 'package:flutter_inappwebview/flutter_inappwebview.dart';

import 'navigation_policy.dart';

typedef OnLinkOpen = void Function(Uri uri);

class WebViewFactory {
  const WebViewFactory();

  /// Produces a configured `InAppWebView`. Caller supplies the policy and
  /// the [onLinkOpen] handler for intercepted links.
  ///
  /// Spec §2.2:
  /// - Rule 1: addJavaScriptHandler MUST be in onWebViewCreated. Caller
  ///   passes their handlers via [onWebViewCreated]; this factory does
  ///   not register handlers itself (Phase 2 wires the bridge).
  /// - Rule 4: WebView construction is deferred until biometric resolves
  ///   — caller's responsibility (this factory just builds the widget).
  /// - Rule 5: navigation policy enforced via shouldOverrideUrlLoading.
  InAppWebView build({
    required Uri initialUrl,
    required NavigationPolicy policy,
    required OnLinkOpen onLinkOpen,
    void Function(InAppWebViewController controller)? onWebViewCreated,
    void Function(InAppWebViewController controller, WebUri? url)? onLoadStop,
  }) {
    return InAppWebView(
      initialUrlRequest: URLRequest(url: WebUri(initialUrl.toString())),
      initialSettings: InAppWebViewSettings(
        // Spec §4: iOS keyboard
        keyboardDisplayRequiresUserAction: false,
        disallowOverScroll: true,
        // Spec §4: Android hybrid composition
        useHybridComposition: !kIsWeb,
        // UA suffix so the PWA can branch.
        applicationNameForUserAgent: 'RemoteDevMobile/0.1.0',
      ),
      onWebViewCreated: onWebViewCreated,
      onLoadStop: onLoadStop,
      shouldOverrideUrlLoading: (controller, action) async {
        final uri = action.request.url?.uriValue;
        if (uri == null) return NavigationActionPolicy.CANCEL;
        switch (policy.decide(uri)) {
          case NavigationDecision.allow:
            return NavigationActionPolicy.ALLOW;
          case NavigationDecision.intercept:
            return NavigationActionPolicy.CANCEL;
          case NavigationDecision.interceptAndOpenExternally:
            onLinkOpen(uri);
            return NavigationActionPolicy.CANCEL;
        }
      },
    );
  }
}
```

- [ ] **Step 4: Implement `WebViewHostScreen`**

The screen Flutter routes to once a server is selected. Wraps the WebView under the app's themed Scaffold. Phase 1 just shows the WebView; Phase 2 layers status bar / smart-keys / input bar above it.

```dart
// mobile/lib/presentation/screens/webview_host/webview_host_screen.dart
import 'package:flutter/material.dart';
import 'package:flutter_inappwebview/flutter_inappwebview.dart';

import '../../../infrastructure/webview/navigation_policy.dart';
import '../../../infrastructure/webview/webview_factory.dart';

class WebViewHostScreen extends StatelessWidget {
  const WebViewHostScreen({
    required this.initialUrl,
    required this.serverOrigin,
    super.key,
  });

  final Uri initialUrl;
  final Uri serverOrigin;

  @override
  Widget build(BuildContext context) {
    final policy = NavigationPolicy(serverOrigin: serverOrigin);
    return Scaffold(
      backgroundColor: const Color(0xFF1A1B26),
      body: SafeArea(
        child: const WebViewFactory().build(
          initialUrl: initialUrl,
          policy: policy,
          onLinkOpen: (uri) {
            // Phase 2: open via SFSafariViewController / Custom Tabs.
            debugPrint('External link suppressed: $uri');
          },
        ),
      ),
    );
  }
}
```

(Note: `debugPrint` is intentional — it's the canonical Flutter equivalent of `console.error` for client-side, OK in `presentation/`.)

- [ ] **Step 5: Run tests + analyze**

```bash
cd mobile && flutter test test/infrastructure/webview/ && flutter analyze
```

Expected: navigation policy 4 tests pass, 0 analyzer issues.

- [ ] **Step 6: Commit**

```bash
git add mobile/lib/infrastructure/webview/ mobile/lib/presentation/screens/webview_host/ mobile/test/infrastructure/webview/
git commit -m "feat(mobile): WebView host + navigation policy

- WebViewFactory produces InAppWebView with Phase 1 settings:
  * Spec §4: keyboardDisplayRequiresUserAction: false (iOS)
  * Spec §4: useHybridComposition: true (Android)
  * UA suffix RemoteDevMobile/<version>
- NavigationPolicy enforces /m/* allow-list + CF Access challenge passthrough
- WebViewHostScreen scaffolds the WebView in the app's Tokyo Night theme
- Pure-function navigation policy with 4 unit tests

Plan: docs/superpowers/plans/2026-05-08-flutter-app-phase-1-shell.md Task 4

Co-authored-by: Isaac"
```

---

## Task 5: CookieReader — extract `CF_Authorization` from WebView

**Wave:** 4 (parallel with P1.8; depends on P1.3 + P1.4)
**Worktree:** `../remote-dev-flutter-p1-cookie`
**Files:**
- `mobile/lib/application/ports/cookie_reader_port.dart`
- `mobile/lib/infrastructure/auth/cookie_reader.dart`
- `mobile/test/infrastructure/auth/cookie_reader_test.dart`

- [ ] **Step 1: Define `CookieReaderPort`**

```dart
// mobile/lib/application/ports/cookie_reader_port.dart
abstract class CookieReaderPort {
  /// Read the named cookie for [origin] from the underlying WebView store.
  /// Returns null if not present.
  Future<String?> readCookie({
    required String origin,
    required String name,
  });
}
```

- [ ] **Step 2: Implement `CookieReader` against `flutter_inappwebview`'s `CookieManager`**

```dart
// mobile/lib/infrastructure/auth/cookie_reader.dart
import 'package:flutter_inappwebview/flutter_inappwebview.dart';

import '../../application/ports/cookie_reader_port.dart';
import '../../application/ports/secure_storage_port.dart';

/// Bridges the WebView's CookieManager → flutter_secure_storage so Dio
/// (which has its own independent cookie jar) can read the same value.
///
/// Spec §3:
/// - On iOS WKWebView, getCookies is async via WKHTTPCookieStore. There
///   are documented timing flakes on iOS 14 and below where the store
///   isn't immediately populated post-onLoadStop. We retry with backoff.
/// - HttpOnly cookies ARE accessible via WKHTTPCookieStore from native
///   code (only JS is blocked).
class CookieReader implements CookieReaderPort {
  CookieReader({
    required this.storage,
    CookieManager? cookieManager,
  }) : _cookieManager = cookieManager ?? CookieManager.instance();

  final SecureStoragePort storage;
  final CookieManager _cookieManager;

  static const _retryDelays = [
    Duration(milliseconds: 200),
    Duration(milliseconds: 400),
    Duration(milliseconds: 800),
  ];

  @override
  Future<String?> readCookie({
    required String origin,
    required String name,
  }) async {
    final url = WebUri(origin);
    for (final delay in _retryDelays) {
      final cookies = await _cookieManager.getCookies(url: url);
      for (final cookie in cookies) {
        if (cookie.name == name) {
          final value = cookie.value as String?;
          if (value != null && value.isNotEmpty) return value;
        }
      }
      await Future<void>.delayed(delay);
    }
    return null;
  }

  /// Convenience: read CF_Authorization for a given server and persist it
  /// under that server's secure-storage namespace. Returns true on success.
  Future<bool> captureCfAuthorization({
    required String serverId,
    required Uri serverOrigin,
  }) async {
    final value = await readCookie(
      origin: serverOrigin.toString(),
      name: 'CF_Authorization',
    );
    if (value == null) return false;
    await storage.write(serverId, 'cf_authorization', value);
    return true;
  }
}
```

- [ ] **Step 3: Test (mock `CookieManager` via interface boundary)**

The vanilla `CookieManager.instance()` is a hard dependency on the plugin singleton. To unit-test we can either:
- (a) Inject a `CookieManager?` into the constructor (already done) and pass a mock.
- (b) Wrap `CookieManager` behind an even-thinner interface for testability.

Use (a). Mocktail can mock the `flutter_inappwebview` `CookieManager` through its method signatures, but if mocktail balks on the platform-channel methods, fall back to defining a small `_CookieManagerLike` typedef that exposes only `getCookies` and adapt.

```dart
// mobile/test/infrastructure/auth/cookie_reader_test.dart
import 'package:flutter_inappwebview/flutter_inappwebview.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:remote_dev/application/ports/secure_storage_port.dart';
import 'package:remote_dev/infrastructure/auth/cookie_reader.dart';

class _MockCookieManager extends Mock implements CookieManager {}
class _MockStorage extends Mock implements SecureStoragePort {}

void main() {
  setUpAll(() {
    registerFallbackValue(WebUri('https://example.com'));
  });

  test('returns the CF_Authorization cookie when present', () async {
    final cm = _MockCookieManager();
    final storage = _MockStorage();
    when(() => cm.getCookies(url: any(named: 'url'))).thenAnswer(
      (_) async => [
        Cookie(name: 'other', value: 'x'),
        Cookie(name: 'CF_Authorization', value: 'jwt-token'),
      ],
    );
    final reader = CookieReader(storage: storage, cookieManager: cm);

    final result = await reader.readCookie(
      origin: 'https://example.com',
      name: 'CF_Authorization',
    );

    expect(result, 'jwt-token');
  });

  test('retries when cookie is initially absent and persists on success', () async {
    final cm = _MockCookieManager();
    final storage = _MockStorage();
    var call = 0;
    when(() => cm.getCookies(url: any(named: 'url'))).thenAnswer((_) async {
      call += 1;
      return call >= 2
          ? [Cookie(name: 'CF_Authorization', value: 'jwt-token')]
          : <Cookie>[];
    });
    when(() => storage.write(any(), any(), any())).thenAnswer((_) async {});
    final reader = CookieReader(storage: storage, cookieManager: cm);

    final ok = await reader.captureCfAuthorization(
      serverId: 'srv-1',
      serverOrigin: Uri.parse('https://example.com'),
    );

    expect(ok, isTrue);
    verify(() => storage.write('srv-1', 'cf_authorization', 'jwt-token')).called(1);
  });
}
```

- [ ] **Step 4: Run + commit**

```bash
cd mobile && flutter test test/infrastructure/auth/ && flutter analyze
```

```bash
git add mobile/lib/application/ports/cookie_reader_port.dart mobile/lib/infrastructure/auth/cookie_reader.dart mobile/test/infrastructure/auth/
git commit -m "feat(mobile): CookieReader extracts CF_Authorization from WebView

- CookieReader wraps flutter_inappwebview CookieManager.getCookies()
- Retries (200/400/800ms) handle iOS WKHTTPCookieStore timing flakes
- captureCfAuthorization() persists to flutter_secure_storage scoped to serverId
- HttpOnly cookies are still accessible via native CookieManager (only JS is blocked)
- mocktail-driven unit tests for present, absent-then-present, and persistence paths

Plan: docs/superpowers/plans/2026-05-08-flutter-app-phase-1-shell.md Task 5

Co-authored-by: Isaac"
```

---

## Task 6: Dio API client + AuthInterceptor

**Wave:** 5 (sequential, after P1.5)
**Worktree:** `../remote-dev-flutter-p1-dio`
**Files:**
- `mobile/lib/application/ports/api_client_port.dart`
- `mobile/lib/infrastructure/api/auth_interceptor.dart`
- `mobile/lib/infrastructure/api/remote_dev_client.dart`
- `mobile/test/infrastructure/api/auth_interceptor_test.dart`

- [ ] **Step 1: Define `ApiClientPort`** (minimal Phase 1 surface; expand in Phase 3 for FCM register)

```dart
// mobile/lib/application/ports/api_client_port.dart
abstract class ApiClientPort {
  /// GET an arbitrary path on the active server with cookie auth.
  Future<dynamic> get(String path);
}
```

- [ ] **Step 2: Implement `AuthInterceptor`**

```dart
// mobile/lib/infrastructure/api/auth_interceptor.dart
import 'package:dio/dio.dart';

import '../../application/ports/secure_storage_port.dart';

/// Reads CF_Authorization from flutter_secure_storage on every outbound
/// request and injects it as a Cookie header. Spec §2.2 rule 3: Dio
/// NEVER reads from the WebView cookie store.
class AuthInterceptor extends Interceptor {
  AuthInterceptor({required this.storage, required this.serverId});

  final SecureStoragePort storage;
  final String serverId;

  @override
  Future<void> onRequest(
    RequestOptions options,
    RequestInterceptorHandler handler,
  ) async {
    final token = await storage.read(serverId, 'cf_authorization');
    if (token != null && token.isNotEmpty) {
      final existing = options.headers['Cookie'] as String?;
      final newCookie = 'CF_Authorization=$token';
      options.headers['Cookie'] = existing == null || existing.isEmpty
          ? newCookie
          : '$existing; $newCookie';
    }
    handler.next(options);
  }
}
```

- [ ] **Step 3: Implement `RemoteDevClient`**

```dart
// mobile/lib/infrastructure/api/remote_dev_client.dart
import 'package:dio/dio.dart';

import '../../application/ports/api_client_port.dart';
import '../../application/ports/secure_storage_port.dart';
import 'auth_interceptor.dart';

class RemoteDevClient implements ApiClientPort {
  RemoteDevClient({
    required this.serverOrigin,
    required this.serverId,
    required SecureStoragePort storage,
    Dio? dio,
  }) : _dio = dio ?? Dio() {
    _dio.options
      ..baseUrl = serverOrigin.toString()
      ..connectTimeout = const Duration(seconds: 15)
      ..receiveTimeout = const Duration(seconds: 30);
    _dio.interceptors.add(AuthInterceptor(storage: storage, serverId: serverId));
  }

  final Uri serverOrigin;
  final String serverId;
  final Dio _dio;

  @override
  Future<dynamic> get(String path) async {
    final response = await _dio.get<dynamic>(path);
    return response.data;
  }
}
```

- [ ] **Step 4: Test the interceptor**

```dart
// mobile/test/infrastructure/api/auth_interceptor_test.dart
import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:remote_dev/application/ports/secure_storage_port.dart';
import 'package:remote_dev/infrastructure/api/auth_interceptor.dart';

class _MockStorage extends Mock implements SecureStoragePort {}
class _MockHandler extends Mock implements RequestInterceptorHandler {}

void main() {
  late _MockStorage storage;
  late _MockHandler handler;
  late AuthInterceptor interceptor;

  setUp(() {
    storage = _MockStorage();
    handler = _MockHandler();
    interceptor = AuthInterceptor(storage: storage, serverId: 'srv-1');
    when(() => handler.next(any())).thenAnswer((_) {});
  });

  test('injects CF_Authorization cookie when stored', () async {
    when(() => storage.read('srv-1', 'cf_authorization'))
        .thenAnswer((_) async => 'jwt-token');
    final options = RequestOptions(path: '/api/sessions');

    await interceptor.onRequest(options, handler);

    expect(options.headers['Cookie'], 'CF_Authorization=jwt-token');
    verify(() => handler.next(options)).called(1);
  });

  test('does not set Cookie header when no token is stored', () async {
    when(() => storage.read('srv-1', 'cf_authorization'))
        .thenAnswer((_) async => null);
    final options = RequestOptions(path: '/api/sessions');

    await interceptor.onRequest(options, handler);

    expect(options.headers.containsKey('Cookie'), isFalse);
    verify(() => handler.next(options)).called(1);
  });

  test('appends to existing Cookie header', () async {
    when(() => storage.read('srv-1', 'cf_authorization'))
        .thenAnswer((_) async => 'jwt-token');
    final options = RequestOptions(
      path: '/api/sessions',
      headers: {'Cookie': 'foo=bar'},
    );

    await interceptor.onRequest(options, handler);

    expect(options.headers['Cookie'], 'foo=bar; CF_Authorization=jwt-token');
  });
}
```

- [ ] **Step 5: Run + commit**

```bash
cd mobile && flutter test test/infrastructure/api/ && flutter analyze
```

```bash
git add mobile/lib/application/ports/api_client_port.dart mobile/lib/infrastructure/api/ mobile/test/infrastructure/api/
git commit -m "feat(mobile): Dio RemoteDevClient + AuthInterceptor (cookie injection)

- ApiClientPort minimal Phase 1 surface (GET; expanded in Phase 3 for FCM)
- AuthInterceptor reads CF_Authorization from flutter_secure_storage and
  injects it as a Cookie header on every outbound request.
- LOAD-BEARING ARCHITECTURAL RULE (spec §2.2/3): Dio NEVER reads from
  WebView cookie store. flutter_secure_storage is the single source.
- 3 mocktail-driven unit tests for happy / no-token / append-to-existing.

Plan: docs/superpowers/plans/2026-05-08-flutter-app-phase-1-shell.md Task 6

Co-authored-by: Isaac"
```

---

## Task 7: 401 retry + re-authentication recovery flow

**Wave:** 6 (sequential, after P1.6)
**Worktree:** `../remote-dev-flutter-p1-reauth`
**Files:**
- `mobile/lib/infrastructure/api/auth_interceptor.dart` — extend with 401 handling
- `mobile/lib/presentation/screens/webview_host/reauth_screen.dart`
- `mobile/test/infrastructure/api/auth_interceptor_401_test.dart`

- [ ] **Step 1: Extend `AuthInterceptor` with `onError` handling**

When Dio receives a 401 from the server, the cookie is expired. We trigger a single in-flight reload of the WebView root URL (which re-runs CF Access challenge if needed), wait for `onLoadStop` to repopulate the cookie, retry the original request once. After 2 failures, surface a "re-auth needed" callback.

```dart
// in mobile/lib/infrastructure/api/auth_interceptor.dart, extending the class
//
// Add fields:
//   final Future<bool> Function() onUnauthorized;  // reload + recapture cookie
//   final void Function() onReauthRequired;        // surface UI after exhaustion
//   int _retryCount = 0;
//
// And:
@override
Future<void> onError(DioException err, ErrorInterceptorHandler handler) async {
  if (err.response?.statusCode != 401) {
    handler.next(err);
    return;
  }
  if (_retryCount >= 2) {
    _retryCount = 0;
    onReauthRequired();
    handler.next(err);
    return;
  }
  _retryCount += 1;
  final ok = await onUnauthorized();
  if (!ok) {
    onReauthRequired();
    handler.next(err);
    return;
  }
  // Retry the request with the (refreshed) cookie.
  try {
    final response = await Dio().fetch<dynamic>(err.requestOptions);
    _retryCount = 0;
    handler.resolve(response);
  } catch (e) {
    handler.next(err);
  }
}
```

(The interceptor's constructor accepts `onUnauthorized` and `onReauthRequired`. `onUnauthorized` is wired to a controller that reloads the WebView root and re-runs `CookieReader.captureCfAuthorization`.)

- [ ] **Step 2: Implement `ReauthScreen`** — minimal screen with "Re-authenticate" button that pops back to WebView host and reloads.

```dart
// mobile/lib/presentation/screens/webview_host/reauth_screen.dart
import 'package:flutter/material.dart';

class ReauthScreen extends StatelessWidget {
  const ReauthScreen({required this.onReauthenticate, super.key});

  final VoidCallback onReauthenticate;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF1A1B26),
      body: SafeArea(
        child: Center(
          child: Padding(
            padding: const EdgeInsets.all(32),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                const Icon(Icons.lock_outline, size: 64, color: Color(0xFF7AA2F7)),
                const SizedBox(height: 24),
                const Text(
                  'Authentication needed',
                  style: TextStyle(color: Colors.white, fontSize: 22),
                ),
                const SizedBox(height: 12),
                const Text(
                  'Your session expired. Sign in again to continue.',
                  textAlign: TextAlign.center,
                  style: TextStyle(color: Colors.white70),
                ),
                const SizedBox(height: 32),
                ElevatedButton(
                  onPressed: onReauthenticate,
                  child: const Text('Re-authenticate'),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
```

- [ ] **Step 3: Test the 401 retry path**

```dart
// mobile/test/infrastructure/api/auth_interceptor_401_test.dart
import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:remote_dev/application/ports/secure_storage_port.dart';
import 'package:remote_dev/infrastructure/api/auth_interceptor.dart';

class _MockStorage extends Mock implements SecureStoragePort {}
class _MockHandler extends Mock implements ErrorInterceptorHandler {}

void main() {
  setUpAll(() {
    registerFallbackValue(RequestOptions(path: '/'));
    registerFallbackValue(DioException(requestOptions: RequestOptions(path: '/')));
  });

  test('triggers onUnauthorized once, then onReauthRequired after 2 401s', () async {
    final storage = _MockStorage();
    final handler = _MockHandler();
    var unauthCalls = 0;
    var reauthCalls = 0;
    when(() => storage.read(any(), any())).thenAnswer((_) async => null);
    when(() => handler.next(any())).thenAnswer((_) {});
    when(() => handler.resolve(any())).thenAnswer((_) {});

    final interceptor = AuthInterceptor(
      storage: storage,
      serverId: 'srv-1',
      onUnauthorized: () async {
        unauthCalls += 1;
        return false; // simulate failure to recapture
      },
      onReauthRequired: () => reauthCalls += 1,
    );

    final err = DioException(
      requestOptions: RequestOptions(path: '/api/sessions'),
      response: Response(
        requestOptions: RequestOptions(path: '/api/sessions'),
        statusCode: 401,
      ),
    );

    await interceptor.onError(err, handler);
    await interceptor.onError(err, handler);
    await interceptor.onError(err, handler);

    expect(unauthCalls, 2); // first two 401s try to recapture
    expect(reauthCalls, greaterThanOrEqualTo(1));
  });
}
```

- [ ] **Step 4: Run + commit**

```bash
cd mobile && flutter test test/infrastructure/api/auth_interceptor_401_test.dart && flutter analyze
```

```bash
git add mobile/lib/infrastructure/api/auth_interceptor.dart mobile/lib/presentation/screens/webview_host/reauth_screen.dart mobile/test/infrastructure/api/auth_interceptor_401_test.dart
git commit -m "feat(mobile): 401 retry + re-authentication recovery flow

- AuthInterceptor.onError retries the failed request after invoking
  onUnauthorized (which reloads the WebView root + recaptures cookie).
- After 2 failed retries, onReauthRequired fires; the host shows
  ReauthScreen with a 'Re-authenticate' CTA that reloads the WebView.
- Spec §3 + §12.5 error-surface flow.

Plan: docs/superpowers/plans/2026-05-08-flutter-app-phase-1-shell.md Task 7

Co-authored-by: Isaac"
```

---

## Task 8: Server picker scaffold

**Wave:** 4 (parallel with P1.5)
**Worktree:** `../remote-dev-flutter-p1-server-picker`
**Files:**
- `mobile/lib/presentation/screens/server_picker/server_picker_screen.dart`
- `mobile/lib/presentation/screens/server_picker/add_server_screen.dart`
- `mobile/test/presentation/screens/server_picker/server_picker_screen_test.dart`

The server picker lists known servers, supports add / select / delete. Health-check probe (`GET /api/health`) on add is OPTIONAL; if the endpoint doesn't exist, just attempt the WebView load and let the auth flow surface failures. Phase 5 polishes the UI.

- [ ] **Step 1: Implement `ServerPickerScreen`**

```dart
// mobile/lib/presentation/screens/server_picker/server_picker_screen.dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../application/ports/server_config_store.dart';
import '../../../domain/server_config.dart';

// Provider wiring (typically in a separate providers file; for Phase 1
// we keep it inline for brevity).
final serverConfigStoreProvider = Provider<ServerConfigStore>((ref) {
  throw UnimplementedError(
    'ServerConfigStore must be overridden in main.dart with the impl wired '
    'to FlutterSecureStoragePort.',
  );
});

final serversProvider = FutureProvider<List<ServerConfig>>((ref) async {
  final store = ref.read(serverConfigStoreProvider);
  return store.loadAll();
});

class ServerPickerScreen extends ConsumerWidget {
  const ServerPickerScreen({
    required this.onSelect,
    required this.onAdd,
    super.key,
  });

  final void Function(ServerConfig) onSelect;
  final VoidCallback onAdd;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final asyncServers = ref.watch(serversProvider);
    return Scaffold(
      backgroundColor: const Color(0xFF1A1B26),
      appBar: AppBar(
        backgroundColor: const Color(0xFF1A1B26),
        title: const Text('Servers', style: TextStyle(color: Colors.white)),
        actions: [
          IconButton(
            icon: const Icon(Icons.add, color: Colors.white),
            onPressed: onAdd,
          ),
        ],
      ),
      body: asyncServers.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(
          child: Text('Failed to load servers: $e',
              style: const TextStyle(color: Colors.white70)),
        ),
        data: (servers) {
          if (servers.isEmpty) {
            return Center(
              child: Padding(
                padding: const EdgeInsets.all(32),
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    const Text(
                      'No servers yet.',
                      style: TextStyle(color: Colors.white, fontSize: 20),
                    ),
                    const SizedBox(height: 16),
                    ElevatedButton(
                      onPressed: onAdd,
                      child: const Text('Add a server'),
                    ),
                  ],
                ),
              ),
            );
          }
          return ListView.builder(
            itemCount: servers.length,
            itemBuilder: (context, i) {
              final server = servers[i];
              return ListTile(
                title: Text(server.label,
                    style: const TextStyle(color: Colors.white)),
                subtitle: Text(server.url,
                    style: const TextStyle(color: Colors.white70)),
                onTap: () => onSelect(server),
              );
            },
          );
        },
      ),
    );
  }
}
```

- [ ] **Step 2: Implement `AddServerScreen`** — simple form with URL + label fields, validates URL parses, saves via store, returns the new ServerConfig.

```dart
// mobile/lib/presentation/screens/server_picker/add_server_screen.dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uuid/uuid.dart';

import '../../../application/ports/server_config_store.dart';
import '../../../domain/server_config.dart';
import 'server_picker_screen.dart';

class AddServerScreen extends ConsumerStatefulWidget {
  const AddServerScreen({required this.onSaved, super.key});

  final void Function(ServerConfig) onSaved;

  @override
  ConsumerState<AddServerScreen> createState() => _AddServerScreenState();
}

class _AddServerScreenState extends ConsumerState<AddServerScreen> {
  final _formKey = GlobalKey<FormState>();
  final _urlCtrl = TextEditingController();
  final _labelCtrl = TextEditingController();
  bool _saving = false;

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _saving = true);
    try {
      final store = ref.read(serverConfigStoreProvider);
      final config = ServerConfig(
        id: const Uuid().v4(),
        label: _labelCtrl.text.trim(),
        url: _urlCtrl.text.trim(),
        lastUsedAt: DateTime.now(),
      );
      await store.upsert(config);
      await store.setActive(config.id);
      widget.onSaved(config);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF1A1B26),
      appBar: AppBar(
        backgroundColor: const Color(0xFF1A1B26),
        title: const Text('Add server', style: TextStyle(color: Colors.white)),
      ),
      body: Form(
        key: _formKey,
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            children: [
              TextFormField(
                controller: _urlCtrl,
                style: const TextStyle(color: Colors.white),
                decoration: const InputDecoration(
                  labelText: 'Server URL',
                  hintText: 'https://dev.example.com',
                ),
                validator: (v) {
                  final uri = Uri.tryParse(v ?? '');
                  if (uri == null || !uri.hasScheme || !uri.hasAuthority) {
                    return 'Enter a valid URL with scheme and host';
                  }
                  return null;
                },
              ),
              const SizedBox(height: 16),
              TextFormField(
                controller: _labelCtrl,
                style: const TextStyle(color: Colors.white),
                decoration: const InputDecoration(labelText: 'Label'),
                validator: (v) =>
                    (v == null || v.trim().isEmpty) ? 'Required' : null,
              ),
              const SizedBox(height: 32),
              ElevatedButton(
                onPressed: _saving ? null : _save,
                child: _saving
                    ? const SizedBox(
                        width: 16, height: 16,
                        child: CircularProgressIndicator(strokeWidth: 2))
                    : const Text('Save'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
```

- [ ] **Step 3: Widget test for empty + populated states**

```dart
// mobile/test/presentation/screens/server_picker/server_picker_screen_test.dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:remote_dev/application/ports/server_config_store.dart';
import 'package:remote_dev/domain/server_config.dart';
import 'package:remote_dev/presentation/screens/server_picker/server_picker_screen.dart';

class _MockStore extends Mock implements ServerConfigStore {}

void main() {
  testWidgets('empty state shows add CTA', (tester) async {
    final store = _MockStore();
    when(store.loadAll).thenAnswer((_) async => const []);

    await tester.pumpWidget(
      ProviderScope(
        overrides: [serverConfigStoreProvider.overrideWithValue(store)],
        child: MaterialApp(
          home: ServerPickerScreen(onSelect: (_) {}, onAdd: () {}),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('No servers yet.'), findsOneWidget);
    expect(find.text('Add a server'), findsOneWidget);
  });

  testWidgets('populated state shows the server list', (tester) async {
    final store = _MockStore();
    when(store.loadAll).thenAnswer((_) async => [
          ServerConfig(
            id: 'a',
            label: 'Work',
            url: 'https://dev.example.com',
            lastUsedAt: DateTime(2026, 5, 8),
          ),
        ]);

    await tester.pumpWidget(
      ProviderScope(
        overrides: [serverConfigStoreProvider.overrideWithValue(store)],
        child: MaterialApp(
          home: ServerPickerScreen(onSelect: (_) {}, onAdd: () {}),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Work'), findsOneWidget);
    expect(find.text('https://dev.example.com'), findsOneWidget);
  });
}
```

- [ ] **Step 4: Run + commit**

```bash
cd mobile && flutter test test/presentation/screens/server_picker/ && flutter analyze
```

```bash
git add mobile/lib/presentation/screens/server_picker/ mobile/test/presentation/screens/server_picker/
git commit -m "feat(mobile): server picker scaffold (add / select / list)

- ServerPickerScreen lists saved servers with empty-state CTA
- AddServerScreen validates URL + label, persists via ServerConfigStore
- Riverpod providers for the store + servers list
- Widget tests for empty + populated states using ProviderScope overrides

Plan: docs/superpowers/plans/2026-05-08-flutter-app-phase-1-shell.md Task 8

Co-authored-by: Isaac"
```

---

## Task 9: AppRouter + AppRoute sealed class + go_router adapter

**Wave:** 2 (parallel)
**Worktree:** `../remote-dev-flutter-p1-router`
**Files:**
- `mobile/lib/presentation/router/app_route.dart`
- `mobile/lib/presentation/router/app_router.dart`
- `mobile/test/presentation/router/app_router_test.dart`

- [ ] **Step 1: Implement `AppRoute` sealed class**

```dart
// mobile/lib/presentation/router/app_route.dart

sealed class AppRoute {
  const AppRoute();

  const factory AppRoute.serverPicker() = ServerPickerRoute;
  const factory AppRoute.addServer() = AddServerRoute;
  const factory AppRoute.session(String id) = SessionRoute;
  const factory AppRoute.channel(String id) = ChannelRoute;
  const factory AppRoute.recording(String id) = RecordingRoute;
  const factory AppRoute.notifications() = NotificationsRoute;
  const factory AppRoute.reauth() = ReauthRoute;

  String toPath() => switch (this) {
        ServerPickerRoute() => '/servers',
        AddServerRoute() => '/servers/add',
        SessionRoute(:final id) => '/m/session/$id',
        ChannelRoute(:final id) => '/m/channel/$id',
        RecordingRoute(:final id) => '/m/recording/$id',
        NotificationsRoute() => '/notifications',
        ReauthRoute() => '/reauth',
      };
}

final class ServerPickerRoute extends AppRoute {
  const ServerPickerRoute();
}
final class AddServerRoute extends AppRoute {
  const AddServerRoute();
}
final class SessionRoute extends AppRoute {
  const SessionRoute(this.id);
  final String id;
}
final class ChannelRoute extends AppRoute {
  const ChannelRoute(this.id);
  final String id;
}
final class RecordingRoute extends AppRoute {
  const RecordingRoute(this.id);
  final String id;
}
final class NotificationsRoute extends AppRoute {
  const NotificationsRoute();
}
final class ReauthRoute extends AppRoute {
  const ReauthRoute();
}
```

- [ ] **Step 2: Implement `AppRouter`** that wraps `go_router` and exposes a `navigateTo(AppRoute)` method.

```dart
// mobile/lib/presentation/router/app_router.dart
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../screens/server_picker/server_picker_screen.dart';
import '../screens/server_picker/add_server_screen.dart';
import '../screens/webview_host/webview_host_screen.dart';
import '../screens/webview_host/reauth_screen.dart';
import 'app_route.dart';

class AppRouter {
  AppRouter() : _config = _buildRouter();

  final GoRouter _config;
  GoRouter get config => _config;

  void navigateTo(AppRoute route) {
    _config.go(route.toPath());
  }

  static GoRouter _buildRouter() {
    return GoRouter(
      initialLocation: const ServerPickerRoute().toPath(),
      routes: [
        GoRoute(
          path: '/servers',
          builder: (context, state) => ServerPickerScreen(
            onSelect: (server) {
              // Phase 1: route to webview host with the server's URL.
              final route = SessionRoute('placeholder'); // Phase 2 picks real id
              context.go(route.toPath(), extra: server.url);
            },
            onAdd: () => context.go(const AddServerRoute().toPath()),
          ),
        ),
        GoRoute(
          path: '/servers/add',
          builder: (context, state) => AddServerScreen(
            onSaved: (server) =>
                context.go(const ServerPickerRoute().toPath()),
          ),
        ),
        // Phase 1 just shows the WebView host wired to whatever URL was passed.
        // Phase 2 differentiates session/channel/recording.
        GoRoute(
          path: '/m/session/:id',
          builder: (context, state) {
            final url = state.extra as String? ?? 'http://localhost:6001';
            return WebViewHostScreen(
              initialUrl: Uri.parse('$url/m/session/${state.pathParameters['id']}'),
              serverOrigin: Uri.parse(url),
            );
          },
        ),
        GoRoute(
          path: '/reauth',
          builder: (context, state) => ReauthScreen(
            onReauthenticate: () => context.go(const ServerPickerRoute().toPath()),
          ),
        ),
      ],
    );
  }
}
```

- [ ] **Step 3: Test `AppRoute.toPath`**

```dart
// mobile/test/presentation/router/app_router_test.dart
import 'package:flutter_test/flutter_test.dart';
import 'package:remote_dev/presentation/router/app_route.dart';

void main() {
  test('AppRoute.toPath maps each variant to the right path', () {
    expect(const AppRoute.serverPicker().toPath(), '/servers');
    expect(const AppRoute.addServer().toPath(), '/servers/add');
    expect(const AppRoute.session('abc').toPath(), '/m/session/abc');
    expect(const AppRoute.channel('xyz').toPath(), '/m/channel/xyz');
    expect(const AppRoute.recording('123').toPath(), '/m/recording/123');
    expect(const AppRoute.notifications().toPath(), '/notifications');
    expect(const AppRoute.reauth().toPath(), '/reauth');
  });
}
```

- [ ] **Step 4: Wire `AppRouter` into `app.dart`**

Update `mobile/lib/app.dart` to use `MaterialApp.router`:

```dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'presentation/router/app_router.dart';

final appRouterProvider = Provider<AppRouter>((ref) => AppRouter());

class RemoteDevApp extends ConsumerWidget {
  const RemoteDevApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final router = ref.watch(appRouterProvider);
    return MaterialApp.router(
      title: 'Remote Dev',
      theme: ThemeData(
        useMaterial3: true,
        colorSchemeSeed: const Color(0xFF7AA2F7),
        brightness: Brightness.dark,
        scaffoldBackgroundColor: const Color(0xFF1A1B26),
      ),
      routerConfig: router.config,
    );
  }
}
```

- [ ] **Step 5: Run + commit**

```bash
cd mobile && flutter test test/presentation/router/ && flutter analyze
```

```bash
git add mobile/lib/presentation/router/ mobile/lib/app.dart mobile/test/presentation/router/
git commit -m "feat(mobile): AppRouter + AppRoute sealed class + go_router adapter

- AppRoute Dart 3 sealed class with factories for each surface
- AppRoute.toPath() maps each variant to a go_router path string
- AppRouter exposes navigateTo(AppRoute) for the FCM tap + deep-link
  handlers to converge on (Phase 3+ wires those callers)
- MaterialApp.router wires the GoRouter config
- Pure-function path mapping with comprehensive unit test

Plan: docs/superpowers/plans/2026-05-08-flutter-app-phase-1-shell.md Task 9

Co-authored-by: Isaac"
```

---

## Task 10: GitHub Actions workflow for mobile-v* tag (Android first)

**Wave:** 2 (parallel)
**Worktree:** `../remote-dev-flutter-p1-ci`
**Files:**
- `.github/workflows/mobile-release.yml`
- `mobile/android/app/build.gradle.kts` (or `build.gradle`) — read keystore from `RDV_ANDROID_*` env vars
- `mobile/android/key.properties.example`

- [ ] **Step 1: Configure Android signing in `mobile/android/app/build.gradle.kts`**

(Project may use Groovy `build.gradle` or Kotlin `build.gradle.kts` depending on the Flutter create version. Adapt syntax accordingly.)

In Kotlin DSL:

```kotlin
import java.io.FileInputStream
import java.util.Properties

val keystoreProperties = Properties()
val keystorePropertiesFile = rootProject.file("key.properties")
if (keystorePropertiesFile.exists()) {
    keystoreProperties.load(FileInputStream(keystorePropertiesFile))
}

android {
    // ... existing config ...

    signingConfigs {
        create("release") {
            // Env vars take precedence over key.properties
            storeFile = (System.getenv("RDV_ANDROID_KEYSTORE_PATH")
                ?: keystoreProperties.getProperty("storeFile"))?.let { file(it) }
            storePassword = System.getenv("RDV_ANDROID_KEYSTORE_PASSWORD")
                ?: keystoreProperties.getProperty("storePassword")
            keyAlias = System.getenv("RDV_ANDROID_KEY_ALIAS")
                ?: keystoreProperties.getProperty("keyAlias")
            keyPassword = System.getenv("RDV_ANDROID_KEY_PASSWORD")
                ?: keystoreProperties.getProperty("keyPassword")
        }
    }

    buildTypes {
        getByName("release") {
            // No fallback to debug keystore — fail the build if no signing
            // config is provided (matches deprecated app's behavior).
            signingConfig = signingConfigs.getByName("release")
        }
    }
}
```

- [ ] **Step 2: Add `mobile/android/key.properties.example`** documenting the local-dev fallback (real `key.properties` is gitignored).

```
storeFile=/absolute/path/to/remote-dev-release.jks
storePassword=your-keystore-password
keyAlias=remote-dev
keyPassword=your-key-password
```

Update `mobile/.gitignore` (or root `.gitignore`) to include `mobile/android/key.properties` (NOT the `.example`).

- [ ] **Step 3: Write `.github/workflows/mobile-release.yml`**

```yaml
name: Mobile Release (Android)

on:
  push:
    tags:
      - "mobile-v*"
  workflow_dispatch:

jobs:
  android-bundle:
    name: Build signed Android App Bundle
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v4

      - uses: subosito/flutter-action@v2
        with:
          channel: stable

      - name: Cache pub
        uses: actions/cache@v4
        with:
          path: |
            ~/.pub-cache
            mobile/.dart_tool
          key: pub-${{ runner.os }}-${{ hashFiles('mobile/pubspec.lock') }}

      - name: Restore Android keystore
        env:
          RDV_ANDROID_KEYSTORE_BASE64: ${{ secrets.RDV_ANDROID_KEYSTORE_BASE64 }}
        run: |
          echo "$RDV_ANDROID_KEYSTORE_BASE64" | base64 --decode > /tmp/remote-dev-release.jks
          echo "RDV_ANDROID_KEYSTORE_PATH=/tmp/remote-dev-release.jks" >> $GITHUB_ENV

      - name: Pub get
        working-directory: mobile
        run: flutter pub get

      - name: Build App Bundle
        working-directory: mobile
        env:
          RDV_ANDROID_KEYSTORE_PATH: /tmp/remote-dev-release.jks
          RDV_ANDROID_KEYSTORE_PASSWORD: ${{ secrets.RDV_ANDROID_KEYSTORE_PASSWORD }}
          RDV_ANDROID_KEY_ALIAS: ${{ secrets.RDV_ANDROID_KEY_ALIAS }}
          RDV_ANDROID_KEY_PASSWORD: ${{ secrets.RDV_ANDROID_KEY_PASSWORD }}
        run: flutter build appbundle --release

      - name: Upload App Bundle artifact
        uses: actions/upload-artifact@v4
        with:
          name: remote-dev-${{ github.ref_name }}.aab
          path: mobile/build/app/outputs/bundle/release/app-release.aab
          if-no-files-found: error
```

- [ ] **Step 4: Document required GitHub secrets**

Add a brief note at the top of `mobile/README.md`:

```
## Release secrets (for tag-driven builds)

The `mobile-release` GitHub Actions workflow expects these repository secrets:

- `RDV_ANDROID_KEYSTORE_BASE64` — base64-encoded keystore JKS file
- `RDV_ANDROID_KEYSTORE_PASSWORD`
- `RDV_ANDROID_KEY_ALIAS`
- `RDV_ANDROID_KEY_PASSWORD`

Locally, drop the keystore at any path and either set the same `RDV_ANDROID_*` env vars OR populate `mobile/android/key.properties` (gitignored).
```

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/mobile-release.yml mobile/android/app/build.gradle.kts mobile/android/key.properties.example mobile/README.md mobile/.gitignore
git commit -m "ci(mobile): GitHub Actions workflow for tag mobile-v* (Android App Bundle)

- Reads RDV_ANDROID_KEYSTORE_PATH/PASSWORD/KEY_ALIAS/KEY_PASSWORD env
  vars (preserved contract from deprecated app's CI).
- No fallback to debug keystore — release builds fail without signing
  config, matching the deprecated app's intentional safety.
- Local-dev key.properties.example documented; real file gitignored.
- iOS IPA workflow deferred to Phase 5 (needs ASC API key).

Plan: docs/superpowers/plans/2026-05-08-flutter-app-phase-1-shell.md Task 10

Co-authored-by: Isaac"
```

---

## Phase 1 ship gate

After all 10 tasks land on `feat/mobile-phase-1`:

- [ ] `cd mobile && flutter analyze` — 0 issues
- [ ] `cd mobile && flutter test` — all tests passing (combined: ~30+ unit + widget tests)
- [ ] `cd mobile && flutter build apk --release` — produces a signed APK (using a local debug keystore for the gate test, or production keystore via env vars). Requires the local Android SDK + Java 17+.
- [ ] APK installs to a physical Android device or emulator and boots into the server picker without crashing.
- [ ] Manually adding a test server URL navigates to the WebView host screen and the WebView attempts to load `<url>/m/session/...` (fails to load is OK in this gate — auth flow validation is Phase 1.5).
- [ ] Open PR `feat/mobile-phase-1 → master` titled `feat(mobile): Phase 1 — Flutter shell + WebView host + in-WebView CF Access auth`. Smoke test the APK build artifact from CI on a physical device.
- [ ] After merge, the `/global:ship-it` skill runs the production deploy webhook (Next.js side) — but Phase 1 doesn't change the Next.js side, so the deploy is a no-op other than commit propagation.

## Self-review checklist (the implementer should run this)

- [ ] Every task's commit lands on `feat/mobile-phase-1` (no stranded commits in worktrees).
- [ ] `mobile/pubspec.lock` is committed.
- [ ] `flutter analyze` is clean from `mobile/`.
- [ ] All unit + widget tests pass.
- [ ] APK builds and signs correctly with the env-var contract.
- [ ] No `print` calls in source (use `debugPrint` in `presentation/`, throw exceptions in lower layers).
- [ ] `addJavaScriptHandler` registrations are in `onWebViewCreated`-only places (architectural rule 1) — Phase 1 doesn't add any handlers but the convention is established by where in `WebViewFactory` the hook lives.
- [ ] No code path lets Dio read from the WebView cookie store (architectural rule 3) — only `flutter_secure_storage` via `AuthInterceptor`.

## Out of scope — deferred to later plans

- Bridge round-trip validation (Phase 1.5 — separate plan).
- Native session-view chrome (status bar, smart-keys, input bar) — Phase 2.
- Push notifications (FCM) — Phase 3.
- Native Notifications/Channels/Profile tabs + deep links — Phase 4.
- Biometric lock + multi-server polish + recording playback + store metadata + iOS CI — Phase 5.
