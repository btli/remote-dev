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

## References

- Design spec: `docs/superpowers/specs/2026-05-08-flutter-app-redesign-design.md`
- Phase 1 plan: `docs/superpowers/plans/2026-05-08-flutter-app-phase-1-shell.md`
- Bundle id: `com.remotedev.app` (preserved from the deprecated app)
