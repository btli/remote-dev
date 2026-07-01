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

The server wires a `PushNotificationGateway` in `src/infrastructure/container.ts`.
When both variables below are set it uses `FcmPushGateway`; otherwise it falls
back to a `NullPushGateway` (push silently disabled — which is why the app runs
fine without any of this). To send real pushes, set:
- `FCM_PROJECT_ID` — the Firebase project ID (from Firebase project settings).
- `FCM_SERVICE_ACCOUNT_PATH` — a **filesystem path** to the Firebase Admin SDK
  service-account JSON key file. The server reads the file at this path; it is not
  the JSON contents inlined into the variable.

## 6. Verify

1. Build + run the app. `flutter doctor` should still be clean.
2. The app's debug log should show `[Push] Initialized successfully` once a server is selected.
3. Send a test push from Firebase Console → Cloud Messaging → New campaign → Test message → enter the device's FCM token from the app log.
