# Archived: Flutter Mobile App

**Status:** Archived as of 2026-05-08

This Flutter app is archived pending a redesign of the mobile experience. It is no longer built by CI and is not part of any release artifact. Source is preserved here for reference only.

## Preserved env var contract

The redesigned mobile app should adopt the same Android release-signing env var names so existing CI secrets continue to work without re-provisioning:

- `RDV_ANDROID_KEYSTORE_PATH` — path to the keystore file used at build time
- `RDV_ANDROID_KEYSTORE_PASSWORD` — password for the keystore
- `RDV_ANDROID_KEY_ALIAS` — alias of the signing key inside the keystore
- `RDV_ANDROID_KEY_PASSWORD` — password for that key

Keep these names. The redesign should consume them the same way (e.g. via Gradle `signingConfigs` reading from environment / a properties file) so the existing GitHub Actions secrets keep working.

## Unrelated mobile code (still active)

For clarity, these paths are NOT this archived app and are still in active use:

- `packages/mobile/` — React Native / Expo app
- `src/components/mobile/` — web mobile UI components
- `tests/mobile/restart-agent-api-client.test.ts` — tests the React Native client
