# Mobile App Store Submission

This document captures the one-time human-only setup for releasing the Remote Dev mobile app to the App Store (iOS) and Google Play (Android). Code-side prerequisites (PrivacyInfo manifest, signing config, CI workflow) are already in place — these steps are about Apple Developer / Google Play Console accounts, screenshots, and metadata.

## Common prerequisites

- App icon at 1024×1024 (place at `mobile/assets/app_icon.png`; Phase 5 polish generates platform-specific sizes via `flutter_launcher_icons`).
- Marketing screenshots — produce by running the app on physical devices and capturing the required sizes (see platform sections below).
- Privacy policy URL hosted somewhere (the project's marketing site or a GitHub Pages page).

---

## App Store (iOS)

### Apple Developer enrollment

1. Enroll in the Apple Developer Program ($99/year). Must be a paid account to ship to TestFlight + App Store.
2. From Apple Developer Console → Certificates → create a Distribution certificate (.p12). Export with a password.
3. From Apple Developer Console → Identifiers → register `com.remotedev.app` with capabilities:
   - Push Notifications
   - Associated Domains (for Universal Links — Phase 4)
   - Sign In with Apple (skip; not used)
4. From Apple Developer Console → Profiles → create an App Store Distribution provisioning profile for `com.remotedev.app`. Download the `.mobileprovision` file.
5. Upload an APNs auth key (.p8) to Firebase Console → Cloud Messaging (already covered in `docs/mobile-firebase-setup.md`).

### App Store Connect record

1. App Store Connect → My Apps → `+` → New App.
2. Bundle ID: `com.remotedev.app`. SKU: free-form (e.g., `remote-dev-001`). Primary language: English.
3. Fill in the App Information page (Name, Subtitle, Privacy Policy URL, Category).
4. Pricing: Free.

### Privacy nutrition labels

Match `PrivacyInfo.xcprivacy` exactly. From the App Privacy section:

- Data NOT collected from this app:
  - (none of the standard tracking categories)
- Data collected and linked to user:
  - Email address (for account / authorization)
- Tracking: No (matches `<key>NSPrivacyTracking</key><false/>`)

### Screenshots required

| Device | Size | Count |
|---|---|---|
| 6.7" iPhone (Pro Max) | 1290×2796 | 3-10 |
| 6.5" iPhone | 1284×2778 or 1242×2688 | 3-10 |
| 5.5" iPhone | 1242×2208 | 3-10 |
| 12.9" iPad Pro | 2048×2732 | 3-10 |

Capture by running `flutter run` on each device class. Suggested set:
1. Server picker
2. Sessions tab with a populated list
3. SessionViewScreen with a live terminal
4. Channels tab
5. Notifications tab

### TestFlight upload

CI's `ios-ipa` job uploads the `.ipa` to App Store Connect via `xcrun altool` or `fastlane pilot upload`. Phase 5's CI workflow uses the cert + profile flow (no upload step yet — extend in a follow-up).

Manual fallback: open the `.ipa` artifact from CI, drag it into Transporter.app on macOS.

### App Store submission

After at least one TestFlight build is approved by Apple's automated review, submit for App Store review:
1. App Store Connect → Version → Submit for Review.
2. Answer the export-compliance question (typically: "Does your app use encryption? Yes — only standard encryption" → "Yes" → "Yes" — covered by Apple's standard exemption).

---

## Google Play (Android)

### Play Console enrollment

1. Enroll in Google Play Developer ($25 one-time). Verify identity.
2. Set up a developer account profile.

### Play Console app record

1. Play Console → All apps → Create app.
2. App name: Remote Dev. Default language: English (US).
3. App type: App. Free or paid: Free.

### Play App Signing

Play Console → Setup → App integrity → App signing. Two options:

- **Recommended**: Use Play App Signing — Google manages the signing key. You upload an "upload key" (the same `RDV_ANDROID_*` keystore CI uses) and Play re-signs with the actual app signing key.
- **Manual**: Bring your own signing key. Use the keystore CI uses directly as the app signing key. Less recoverable if lost.

### `assetlinks.json` SHA fingerprints

After Play App Signing is set up, Play Console → Setup → App signing shows two fingerprints:
- App signing key fingerprint (the one users actually verify against)
- Upload key fingerprint

For App Links (`docs/mobile-deep-links.md`'s `assetlinks.json`), use the **app signing key fingerprint** (NOT the upload key).

```json
[{
  "relation": ["delegate_permission/common.handle_all_urls"],
  "target": {
    "namespace": "android_app",
    "package_name": "com.remotedev.app",
    "sha256_cert_fingerprints": ["AA:BB:CC:..."]
  }
}]
```

Deploy to `https://dev.bryanli.net/.well-known/assetlinks.json` (server change — out of mobile scope, document in the platform team's deployment runbook).

### Screenshots required

| Type | Size | Count |
|---|---|---|
| Phone | 16:9 (e.g., 1080×1920) | 2-8 |
| 7" tablet | 1024×600 or larger | up to 8 |
| 10" tablet | 1280×800 or larger | up to 8 |

Same content as App Store screenshots.

### Data safety form

Play Console → App content → Data safety. Mirror the App Store privacy nutrition labels. Key items:
- Data collected: Email address (for account/authorization).
- No third-party tracking SDKs (other than Firebase, which is for push only).
- Data is encrypted in transit (HTTPS).
- Users can request data deletion via the in-app sign-out + server-side account deletion (out of scope here).

### Play Internal track first

1. Upload `.aab` artifact from CI's `android-bundle` job (or run `flutter build appbundle --release` locally).
2. Play Console → Release → Internal testing → Create new release. Upload the .aab.
3. Add internal testers (Google Group or up to 100 individual emails).
4. Roll out → Save → Review → Roll out.

After 1-2 weeks of internal testing, promote to Production.

### Production release

1. Play Console → Release → Production → Create new release.
2. Promote the existing internal release artifact (faster than re-uploading).
3. Roll out to a staged percentage (5% → 20% → 100% over a few days).

---

## Phase 5 verification checklist

- [ ] `mobile/android/app/build.gradle.kts` reads `RDV_ANDROID_KEYSTORE_PATH` env var first, falls back to `key.properties`. NO debug fallback for release.
- [ ] `mobile/android/key.properties.example` exists; real `key.properties` is gitignored.
- [ ] `.github/workflows/mobile-release.yml` uses the right secrets for both Android (`RDV_ANDROID_*`) and iOS (`APPLE_CERT_*`, `KEYCHAIN_PASSWORD`).
- [ ] `mobile/ios/Runner/PrivacyInfo.xcprivacy` exists and is included in the Runner target.
- [ ] `mobile/ios/Runner/Info.plist` has `NSFaceIDUsageDescription` + `UIBackgroundModes: [remote-notification]`.
- [ ] `mobile/ios/Runner/Runner.entitlements` has `aps-environment`, `applinks:dev.bryanli.net`, `com.apple.developer.associated-domains`.
- [ ] `docs/mobile-firebase-setup.md` has been run by the team owner; real `google-services.json` and `GoogleService-Info.plist` are in place locally.
- [ ] `docs/mobile-deep-links.md`'s server-side `apple-app-site-association` and `assetlinks.json` are deployed to `https://dev.bryanli.net/.well-known/`.

After all of the above, the first `git tag mobile-v0.1.0 && git push origin mobile-v0.1.0` should kick off CI which produces signed Android `.aab` + iOS `.ipa` artifacts ready for store submission.
