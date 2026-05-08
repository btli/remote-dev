# Remote Dev Mobile

Flutter client for connecting to Remote Dev servers from Android and iOS.

## Local development

```bash
cd mobile
flutter pub get
flutter run
```

## Android release signing

Release builds require a dedicated keystore. The app no longer falls back to the
debug keystore for `release`.

Provide signing secrets in one of these ways:

1. Environment variables

```bash
export RDV_ANDROID_KEYSTORE_PATH=/absolute/path/to/remote-dev-release.jks
export RDV_ANDROID_KEYSTORE_PASSWORD=...
export RDV_ANDROID_KEY_ALIAS=remote-dev
export RDV_ANDROID_KEY_PASSWORD=...
```

2. A local `mobile/android/key.properties` file

```properties
storeFile=/absolute/path/to/remote-dev-release.jks
storePassword=...
keyAlias=remote-dev
keyPassword=...
```

If both are present, the environment variables win.

Do not commit `mobile/android/key.properties` or the keystore itself. In CI,
write the keystore to a temporary path from secret storage, then export the
same `RDV_ANDROID_*` variables before running the release build.

With signing configured, build the Android release artifact with:

```bash
cd mobile
flutter build appbundle --release
```
