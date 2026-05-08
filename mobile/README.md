# remote_dev (mobile)

New Flutter mobile app for Remote Dev — replaces the deprecated `archive/mobile-flutter/`.

## Dev setup

```bash
cd mobile
flutter pub get
flutter run
```

## Test commands

```bash
flutter test       # widget + unit tests
flutter analyze    # static analysis (lib/ + test/ must be clean)
```

## Release secrets (for tag-driven builds)

The `mobile-release` GitHub Actions workflow expects these repository secrets:

- `RDV_ANDROID_KEYSTORE_BASE64` — base64-encoded keystore JKS file
- `RDV_ANDROID_KEYSTORE_PASSWORD`
- `RDV_ANDROID_KEY_ALIAS`
- `RDV_ANDROID_KEY_PASSWORD`

Locally, drop the keystore at any path and either set the same `RDV_ANDROID_*` env vars OR populate `mobile/android/key.properties` (gitignored — see `key.properties.example`).

Trigger a release build by pushing a tag matching `mobile-v*` (e.g. `mobile-v0.1.0`) or via `workflow_dispatch`.

## References

- Design spec: `docs/superpowers/specs/2026-05-08-flutter-app-redesign-design.md`
- Phase 1 plan: `docs/superpowers/plans/2026-05-08-flutter-app-phase-1-shell.md`
- Bundle id: `com.remotedev.app` (preserved from the deprecated app)
