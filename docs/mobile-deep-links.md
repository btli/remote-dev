# Mobile Deep Links

The Remote Dev mobile app supports deep linking from `https://dev.example.com/m/*` URLs into the native Flutter app on both iOS and Android. When a user taps such a link in Mail, Slack, Messages, etc., the OS opens the native app directly (rather than the browser) and routes to the appropriate screen.

URL scheme:

```
https://dev.example.com/m/<route>
```

Examples:

- `https://dev.example.com/m/channels/<channelId>` — open a channel
- `https://dev.example.com/m/notifications` — open notifications
- `https://dev.example.com/m/sessions/<sessionId>` — open a session

For the OS to route the link to the app (rather than the browser), the server must publish two static JSON files under `/.well-known/`:

- `apple-app-site-association` (iOS Universal Links)
- `assetlinks.json` (Android App Links)

Both files must be served over HTTPS, with `Content-Type: application/json`, and **without** any redirects.

## iOS — Universal Links

iOS uses the `Associated Domains` entitlement together with the `apple-app-site-association` (AASA) file at `https://dev.example.com/.well-known/apple-app-site-association`.

### App-side configuration

The iOS app declares the associated domain in the Xcode project / `Runner.entitlements`:

```xml
<key>com.apple.developer.associated-domains</key>
<array>
    <string>applinks:dev.example.com</string>
</array>
```

### Server-side `apple-app-site-association`

```json
{
  "applinks": {
    "details": [
      {
        "appIDs": ["<TEAM_ID>.com.remotedev.app"],
        "components": [
          {
            "/": "/m/*",
            "comment": "Matches every path under /m/"
          }
        ]
      }
    ]
  }
}
```

- `<TEAM_ID>` is the 10-character Apple Developer Team ID. This is obtained in Phase 5 once the app is registered on App Store Connect.
- The bundle identifier (`com.remotedev.app`) must match the iOS app's `PRODUCT_BUNDLE_IDENTIFIER`.
- iOS fetches and caches AASA on app install; updates require a reinstall (or use of the CDN-served variant on iOS 14+).

## Android — App Links

Android uses the `<intent-filter android:autoVerify="true">` directive together with an `assetlinks.json` file at `https://dev.example.com/.well-known/assetlinks.json`.

### App-side configuration

The Flutter app's `mobile/android/app/src/main/AndroidManifest.xml` adds an autoVerified intent-filter to `MainActivity`:

```xml
<intent-filter android:autoVerify="true">
    <action android:name="android.intent.action.VIEW" />
    <category android:name="android.intent.category.DEFAULT" />
    <category android:name="android.intent.category.BROWSABLE" />
    <data android:scheme="https"
          android:host="dev.example.com"
          android:pathPrefix="/m/" />
</intent-filter>
```

`autoVerify="true"` instructs Android to fetch the server's `assetlinks.json` on install and verify the app is associated with the domain. If verification succeeds, links open directly in the app. If it fails (missing file, fingerprint mismatch, redirect, etc.), links still work but go through the system's "Open with…" chooser.

### Server-side `assetlinks.json`

```json
[
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
      "namespace": "android_app",
      "package_name": "com.remotedev.app",
      "sha256_cert_fingerprints": [
        "<APP_SIGNING_SHA256>"
      ]
    }
  }
]
```

- `package_name` must match the Android app's `applicationId` from `mobile/android/app/build.gradle.kts` (currently `com.remotedev.app`).
- `<APP_SIGNING_SHA256>` is the SHA-256 fingerprint of the certificate that signs the APK installed on devices. For Play-Store-distributed apps this is the **Play App Signing** certificate (visible in Play Console → App integrity), not the upload certificate. For sideload/dev builds, it's the local debug or release keystore fingerprint.
- Multiple fingerprints can be listed (e.g., debug + release + Play App Signing) — Android verifies if **any** match.
- Get a local fingerprint via:

  ```bash
  keytool -list -v -keystore <keystore.jks> -alias <alias> | grep SHA256
  ```

- Verify the configuration with Google's validator:

  ```
  https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://dev.example.com&relation=delegate_permission/common.handle_all_urls
  ```

### Troubleshooting verification

- `adb shell pm get-app-links com.remotedev.app` shows the verification state for an installed build.
- If status is `verified`, App Links route directly. If `legacy_failure` or anything else, links fall back to the chooser.
- Fix: ensure no redirects on the JSON file, correct `Content-Type: application/json`, correct package name, and a fingerprint that matches whatever signs the installed APK.

## Phase 5 follow-ups

- [ ] Obtain Apple Team ID once the app is registered, finalize AASA.
- [ ] Obtain Play App Signing SHA-256 once the app is uploaded to Play Console, finalize `assetlinks.json`.
- [ ] Land both files on `dev.example.com` under `/.well-known/`.
- [ ] Re-test on physical devices that links open the app directly (not the browser).
