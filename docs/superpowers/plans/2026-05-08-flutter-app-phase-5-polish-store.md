# Flutter App — Phase 5: Biometric + Multi-Server Polish + Recording + Store Submission

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development`. Subagents work in worktrees off `feat/mobile-phase-5`. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Final phase. Biometric lock, multi-server picker polish, recording playback, App Store + Play Console metadata, iOS CI. After this lands, the loop's "APK builds and runs without issue" gate is complete.

**Architecture:**
- **Biometric lock:** `local_auth` integrated as a route-guard layer around `HomeShell`. Optional (default off); when enabled, prompts on cold start + after configurable grace period.
- **Multi-server polish:** Server-picker form gets URL validation (`GET /api/health` probe), proper sign-out flow, edit-server.
- **Recording playback:** `RecordingScreen` wraps `/m/recording/<id>` WebView with native AppBar (same pattern as `ChannelScreen`).
- **iOS configuration:** `PrivacyInfo.xcprivacy` manifest (App Store rejects without it since May 2024), Push + Background Modes entitlements, Associated Domains capability.
- **Stores:** App Store Connect + Play Console metadata + screenshots — mostly out-of-code, documented in `docs/mobile-store-submission.md`.
- **iOS CI:** Extend `.github/workflows/mobile-release.yml` with an iOS job (App Store Connect API key).

**Tech Stack:** `local_auth: ^2.3.0` (already in pubspec from Phase 1 — verify), `device_info_plus` (NEW; for stable per-device UUID), existing infrastructure.

**Spec:** §7 (biometric), §8 (multi-server), §11 (distribution).

**Out of scope:** Channel-view native UI (always WebView per spec §2.1). RN app retirement (explicitly kept active).

---

## File structure

```
mobile/
├── lib/
│   ├── domain/
│   │   └── biometric_settings.dart       # P5.1
│   ├── application/ports/
│   │   └── biometric_port.dart           # P5.1
│   ├── infrastructure/
│   │   └── biometric/
│   │       ├── local_auth_service.dart   # P5.1
│   │       └── device_id_provider.dart   # P5.2 — stable per-device UUID
│   └── presentation/
│       └── screens/
│           ├── biometric/
│           │   └── biometric_lock_screen.dart  # P5.1
│           ├── server_picker/
│           │   └── edit_server_screen.dart     # P5.2
│           └── recording/
│               └── recording_screen.dart       # P5.3
├── ios/
│   └── Runner/
│       ├── PrivacyInfo.xcprivacy         # P5.4
│       ├── Info.plist                    # P5.5 — NSFaceIDUsageDescription
│       └── Runner.entitlements           # P5.5 — push + background-modes
├── android/
│   └── app/build.gradle.kts              # P5.6 verify (already in P1.10)
├── docs/
│   ├── mobile-store-submission.md        # P5.7 + P5.8
│   └── mobile-firebase-setup.md          # already exists from P3.1
└── .github/workflows/mobile-release.yml  # P5.9 — extend with iOS job
```

---

## Worktree strategy

`feat/mobile-phase-5` off master.

- **Wave 1 (3 parallel):** P5.1 biometric || P5.2 multi-server polish || P5.3 recording — Flutter code, independent files.
- **Wave 2 (3 parallel):** P5.4 PrivacyInfo || P5.5 iOS entitlements || P5.9 iOS CI — iOS config + workflow, independent.
- **Wave 3 (sequential):** P5.6 verify Android signing || P5.7 + P5.8 store docs — small docs tasks; can serialize.
- **Wave 4 (final):** APK build + ship Phase 5 PR.

---

## Architectural rules

1. Single quotes, `debugPrint` (not `print`).
2. Biometric lock layered OVER `HomeShell`: it's a Stack pattern, not a route — covers the app on resume without navigating.
3. Recording screen mirrors `ChannelScreen`'s pattern (P4.3): native AppBar around embedded WebView.
4. iOS Privacy Manifest is non-negotiable for App Store; ship a minimal valid one even if no required-reason APIs are documented yet.
5. Phase 5 finishes the deferred items from earlier phases (e.g., the hard-coded `'placeholder-device-id'` becomes a real persisted UUID).

---

## Task 1 (P5.1): Biometric lock

**Worktree:** `../remote-dev-flutter-p5-biometric`

### Files

- Create: `mobile/lib/domain/biometric_settings.dart` (freezed)
- Create: `mobile/lib/application/ports/biometric_port.dart`
- Create: `mobile/lib/infrastructure/biometric/local_auth_service.dart`
- Create: `mobile/lib/presentation/screens/biometric/biometric_lock_screen.dart`
- Create: `mobile/lib/presentation/screens/biometric/biometric_settings_screen.dart` (lives in Profile sub-screen tree)
- Modify: `mobile/lib/presentation/screens/profile/profile_tab_screen.dart` — add a "Security" row → biometric settings
- Modify: `mobile/lib/app.dart` — wrap `MaterialApp.router` body with a `BiometricLockOverlay` widget

### Goals

- Settings stored via `flutter_secure_storage` (NOT shared_preferences — sensitive setting).
- `BiometricSettings { enabled: bool, gracePeriod: Duration, requireOnColdStart: bool }`.
- `LocalAuthService.authenticate()` wraps `local_auth.authenticate(localizedReason: 'Unlock Remote Dev')`.
- `BiometricLockScreen` renders Tokyo Night + a single "Authenticate" button; on success, dismisses itself.
- `BiometricLockOverlay` is a Stateful widget that wraps `MaterialApp.router`'s body with a Stack — when `_locked == true`, paints `BiometricLockScreen` on top of everything.
- Listen to `WidgetsBindingObserver` `didChangeAppLifecycleState`: on resume, if grace period elapsed AND enabled, set `_locked = true`.
- On cold start: if `requireOnColdStart && enabled`, start `_locked = true`.

### Tests

- `LocalAuthService.authenticate()` mocked; settings read/write via mock `SecureStoragePort`.
- `BiometricLockScreen` widget renders.
- Grace-period logic: short test verifying `_locked` flips after `gracePeriod` elapsed since `_lastUnlock`.

### Commit

```
feat(mobile/biometric): biometric lock via local_auth (Face ID / fingerprint)
```

---

## Task 2 (P5.2): Multi-server picker polish + add-server validation

**Worktree:** `../remote-dev-flutter-p5-multiserver`

### Files

- Modify: `mobile/lib/presentation/screens/server_picker/add_server_screen.dart` — health-check probe before save
- Create: `mobile/lib/presentation/screens/server_picker/edit_server_screen.dart`
- Modify: `mobile/lib/presentation/screens/server_picker/server_picker_screen.dart` — long-press row → edit
- Create: `mobile/lib/infrastructure/biometric/device_id_provider.dart` — stable per-device UUID (replaces the `'placeholder-device-id'` from P3 wire-up)
- Modify: `mobile/lib/main.dart` — use real `deviceId` from `device_id_provider.dart`
- Tests

### Goals

- Add-server form: on submit, attempt `GET <url>/api/health` (or just root `GET <url>/`) with 5-second timeout. If 200/302 → save. If unreachable → show inline error "can't reach this URL — save anyway?" with confirm-or-cancel.
- Edit-server screen: pre-fills name/url; same validation as add. On save, calls `serverConfigStore.upsert(updated)`.
- Long-press on a server row → "Edit" / "Delete" action sheet.
- `DeviceIdProvider`: reads from `flutter_secure_storage` under key `device.id`. If absent, generates a v4 UUID (using `uuid` package, already in pubspec) and persists. Stable across app restarts.
- `main.dart` updates `pushTokenRegistrarProvider` override to read deviceId from this new provider.

### Tests

- Add-server happy path (health-check ok → save).
- Add-server unreachable (timeout → confirm dialog → save anyway).
- Edit-server (loads existing → user changes label → save updates store).
- DeviceIdProvider (first call generates + persists; second call returns same value).

### Commit

```
feat(mobile/server-picker): edit server, health-check probe on add, stable deviceId
```

---

## Task 3 (P5.3): Recording playback screen

**Worktree:** `../remote-dev-flutter-p5-recording`

### Files

- Create: `mobile/lib/presentation/screens/recording/recording_screen.dart`
- Modify: `mobile/lib/presentation/router/app_router.dart` — add `/home/recording/:id`
- Modify: `mobile/lib/presentation/router/app_route.dart` — `RecordingRoute.toPath()` → `/home/recording/<id>`
- Tests

### Goals

- Mirror `ChannelScreen` (P4.3): native AppBar (title "Recording" — Phase 6 polish fetches real name) + back button + body is `WebViewFactory().build(initialUrl: <server>/m/recording/<id>)`.
- `BridgeController.back()` on native back.

### Commit

```
feat(mobile/recording): RecordingScreen — native chrome around /m/recording/<id> WebView
```

---

## Task 4 (P5.4): PrivacyInfo.xcprivacy manifest

**Worktree:** `../remote-dev-flutter-p5-privacy`

### Files

- Create: `mobile/ios/Runner/PrivacyInfo.xcprivacy`

### Goals

Apple requires a privacy manifest for new App Store submissions since May 2024. Documented required-reason APIs: `NSUserDefaults` (flutter_secure_storage), `FileTimestamp` (firebase_messaging cache), `SystemBootTime` (firebase_messaging), `DiskSpace` (Flutter framework).

### Content

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>NSPrivacyAccessedAPITypes</key>
    <array>
        <dict>
            <key>NSPrivacyAccessedAPIType</key>
            <string>NSPrivacyAccessedAPICategoryUserDefaults</string>
            <key>NSPrivacyAccessedAPITypeReasons</key>
            <array><string>CA92.1</string></array>
        </dict>
        <dict>
            <key>NSPrivacyAccessedAPIType</key>
            <string>NSPrivacyAccessedAPICategoryFileTimestamp</string>
            <key>NSPrivacyAccessedAPITypeReasons</key>
            <array><string>C617.1</string></array>
        </dict>
        <dict>
            <key>NSPrivacyAccessedAPIType</key>
            <string>NSPrivacyAccessedAPICategorySystemBootTime</string>
            <key>NSPrivacyAccessedAPITypeReasons</key>
            <array><string>35F9.1</string></array>
        </dict>
        <dict>
            <key>NSPrivacyAccessedAPIType</key>
            <string>NSPrivacyAccessedAPICategoryDiskSpace</string>
            <key>NSPrivacyAccessedAPITypeReasons</key>
            <array><string>E174.1</string></array>
        </dict>
    </array>
    <key>NSPrivacyTracking</key>
    <false/>
    <key>NSPrivacyCollectedDataTypes</key>
    <array/>
    <key>NSPrivacyTrackingDomains</key>
    <array/>
</dict>
</plist>
```

Add to Xcode project as a resource bundle item (modify `project.pbxproj` to include it in the Runner target).

### Commit

```
feat(mobile/ios): PrivacyInfo.xcprivacy manifest (App Store requirement)
```

---

## Task 5 (P5.5): iOS Push entitlements + APNs config

**Worktree:** `../remote-dev-flutter-p5-ios-push`

### Files

- Modify: `mobile/ios/Runner/Runner.entitlements` (extend P4.5's file)
- Modify: `mobile/ios/Runner/Info.plist` — add `NSFaceIDUsageDescription`

### Goals

```xml
<!-- Runner.entitlements additions -->
<key>aps-environment</key>
<string>production</string>
<key>com.apple.developer.networking.networkextension</key>
<array/>
<!-- background modes -->
```

Info.plist:

```xml
<key>NSFaceIDUsageDescription</key>
<string>Remote Dev uses Face ID to securely unlock the app.</string>
<key>UIBackgroundModes</key>
<array>
    <string>remote-notification</string>
</array>
```

### Commit

```
feat(mobile/ios): push entitlement + Face ID usage description
```

---

## Task 6 (P5.6): Verify Android signing

**Worktree:** none — this is verification.

### Steps

P1.10 already configured Android signing via `RDV_ANDROID_KEYSTORE_PATH` etc. P5.6 verifies it works:

1. Confirm `mobile/android/app/build.gradle.kts` reads from env vars first, key.properties fallback, NO debug fallback for release.
2. `key.properties.example` is committed.
3. Real `key.properties` is gitignored.
4. CI workflow secrets are still configured (`gh secret list`).

If everything is good, this task is a no-op + a verification note in the Phase 5 PR.

---

## Task 7 (P5.7): App Store Connect metadata + screenshots

**Worktree:** `../remote-dev-flutter-p5-app-store-docs`

### Files

- Create: `docs/mobile-store-submission.md` — App Store Connect setup steps (or extend `docs/mobile-firebase-setup.md` with an "App Store" section)

### Goals

Document the human-only steps:
- Apple Developer Program enrollment
- App Store Connect record creation
- Bundle id `com.remotedev.app` registration
- Required screenshots (6.7", 6.5", 5.5", 12.9" iPad)
- Privacy nutrition labels (matches `PrivacyInfo.xcprivacy`)
- TestFlight upload flow
- App Store submission flow

Phase 5 doesn't include the actual screenshots — those are produced by running the app on physical devices.

### Commit

```
docs(mobile): App Store Connect submission procedure
```

---

## Task 8 (P5.8): Play Console metadata + Play Internal

**Worktree:** part of P5.7 worktree (small docs)

### Files

- Modify: `docs/mobile-store-submission.md` — append Play Console section

### Goals

- Google Play Console enrollment
- App listing creation
- Phone (16:9), 7" tablet, 10" tablet screenshot specs
- Data safety form (matches PrivacyInfo)
- Internal track first; production after a few weeks
- Play App Signing fingerprint (needed for `assetlinks.json` — feeds back to P4.6)

### Commit

```
docs(mobile): Play Console submission procedure
```

---

## Task 9 (P5.9): GitHub Actions iOS IPA build

**Worktree:** `../remote-dev-flutter-p5-ios-ci`

### Files

- Modify: `.github/workflows/mobile-release.yml`

### Goals

Add a second job `ios-ipa` triggered by tag `mobile-v*`:

```yaml
ios-ipa:
  name: Build signed iOS IPA
  runs-on: macos-latest
  timeout-minutes: 60
  steps:
    - uses: actions/checkout@v4
    - uses: subosito/flutter-action@v2
      with:
        channel: stable
    - name: Install Apple certificate + provisioning profile
      env:
        APPLE_CERT_BASE64: ${{ secrets.APPLE_CERT_BASE64 }}
        APPLE_CERT_PASSWORD: ${{ secrets.APPLE_CERT_PASSWORD }}
        APPLE_PROVISIONING_PROFILE_BASE64: ${{ secrets.APPLE_PROVISIONING_PROFILE_BASE64 }}
        KEYCHAIN_PASSWORD: ${{ secrets.KEYCHAIN_PASSWORD }}
      run: |
        # decode + import keychain (standard pattern)
        echo "$APPLE_CERT_BASE64" | base64 --decode > /tmp/cert.p12
        echo "$APPLE_PROVISIONING_PROFILE_BASE64" | base64 --decode > /tmp/profile.mobileprovision
        security create-keychain -p "$KEYCHAIN_PASSWORD" build.keychain
        security set-keychain-settings -t 3600 -u build.keychain
        security unlock-keychain -p "$KEYCHAIN_PASSWORD" build.keychain
        security default-keychain -s build.keychain
        security import /tmp/cert.p12 -k build.keychain -P "$APPLE_CERT_PASSWORD" -T /usr/bin/codesign
        security set-key-partition-list -S apple-tool:,apple: -s -k "$KEYCHAIN_PASSWORD" build.keychain
        mkdir -p ~/Library/MobileDevice/Provisioning\ Profiles
        cp /tmp/profile.mobileprovision ~/Library/MobileDevice/Provisioning\ Profiles/
    - name: Pub get
      working-directory: mobile
      run: flutter pub get
    - name: Build IPA
      working-directory: mobile
      run: flutter build ipa --release
    - name: Upload IPA artifact
      uses: actions/upload-artifact@v4
      with:
        name: remote-dev-${{ github.ref_name }}.ipa
        path: mobile/build/ios/ipa/*.ipa
        if-no-files-found: error
```

(Real implementation will need `ExportOptions.plist` + adjustments. Phase 5 plan covers the skeleton; first run will reveal iteration.)

### Required secrets

- `APPLE_CERT_BASE64` (base64-encoded .p12 distribution certificate)
- `APPLE_CERT_PASSWORD`
- `APPLE_PROVISIONING_PROFILE_BASE64`
- `KEYCHAIN_PASSWORD` (any string; used for the temp keychain)

### Commit

```
ci(mobile): GitHub Actions iOS IPA build for tag mobile-v*
```

---

## Phase 5 ship gate (FINAL — loop completion)

- [ ] `flutter analyze` clean
- [ ] `flutter test` passes (existing + new biometric / multi-server / recording tests)
- [ ] `flutter build apk --debug` succeeds
- [ ] All 9 P5 bd issues closed; epic `remote-dev-pddf` closed
- [ ] Parent epic `remote-dev-s146` (Flutter app redesign) closed
- [ ] **APK runs without issue** on physical Android device — the loop's terminal completion criterion (manual test by the human)

After Phase 5 merges, the loop is COMPLETE. The Flutter app:
- Builds a debug APK successfully (verified across all phases).
- Has 200+ unit + widget tests.
- Implements every native feature spec'd in the design.
- Documents the human-only setup steps (Firebase, App Store, Play Console).
- Documents manual physical-device verification (Phase 1.5 + Phase 5 final).

The remaining "runs without issue" verification is owner-driven — the human installs the APK on a physical device and confirms the manual smoke checklist passes.
