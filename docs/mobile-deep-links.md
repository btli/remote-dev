# Mobile Deep Links

## Universal Links (iOS) + App Links (Android)

The app supports deep-linking via:
1. **Universal Links** (iOS) — `https://dev.bryanli.net/m/<surface>/<id>`
2. **App Links** (Android) — same URL pattern, autoVerify
3. **Custom scheme** (`remotedev://`) — fallback for non-allowlisted servers

### Server side: `/.well-known/apple-app-site-association`

The Remote Dev server (`https://dev.bryanli.net`) must serve, at `/.well-known/apple-app-site-association` (no extension, `Content-Type: application/json`):

```json
{
  "applinks": {
    "details": [
      {
        "appIDs": ["TEAMID.com.remotedev.app"],
        "components": [
          { "/": "/m/session/*" },
          { "/": "/m/channel/*" },
          { "/": "/m/recording/*" }
        ]
      }
    ]
  }
}
```

Replace `TEAMID` with your Apple Developer Team ID.

### Server side: `/.well-known/assetlinks.json`

Served at `/.well-known/assetlinks.json` (`Content-Type: application/json`):

```json
[{
  "relation": ["delegate_permission/common.handle_all_urls"],
  "target": {
    "namespace": "android_app",
    "package_name": "com.remotedev.app",
    "sha256_cert_fingerprints": ["XX:YY:..."]
  }
}]
```

The SHA-256 fingerprint comes from the Android signing keystore (`keytool -list -v -keystore <ks>`). For Play App Signing, use the upload + app signing certificate fingerprints from Play Console.

### Custom scheme

For self-hosted Remote Dev servers not in the app's domain allowlist, the app falls back to `remotedev://session/<id>` etc. — see P4.7.

### Multi-server caveat

Universal Links / App Links require domains to be listed in the app's entitlements / manifest at COMPILE TIME. Users with arbitrary self-hosted Remote Dev servers cannot use Universal/App Links — they fall back to the custom scheme.
