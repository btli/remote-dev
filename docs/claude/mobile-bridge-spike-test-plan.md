# Phase 1.5 — Bridge Smoke-Test Plan (manual, physical devices)

> **Status: Completed spike, retained for history.** This is an internal,
> one-time manual validation procedure from the Flutter redesign (Phase 1.5). The
> native ↔ WebView bridge it validated is the **shipped** mobile architecture —
> the app renders the terminal in an embedded WebView and crosses input via
> `window.rdvBridge`. Kept as the record of *why* that boundary is trusted; it is
> not a doc a new reader needs to run again. Original close-out was recorded via
> `bd close remote-dev-kahi --reason="..."`.

## What this validates

Spec [`docs/superpowers/specs/2026-05-08-flutter-app-redesign-design.md`](superpowers/specs/2026-05-08-flutter-app-redesign-design.md) §2.2 + §4:
- The Native ↔ WebView JS bridge round-trips correctly: native `evaluateJavascript("window.rdvBridge.input(...)")` reaches xterm.js inside the WebView.
- The PWA-side `notifyToNative("onTerminalReady", {})` reaches Dart via `flutter_inappwebview`'s `addJavaScriptHandler`.
- The keyboard-layout pattern (`Scaffold(resizeToAvoidBottomInset: false)` + explicit `SizedBox` height for the WebView) prevents `xterm.js` from firing a resize event when the soft keyboard rises.
- Special characters (single quote, backslash, newline) survive the JS-string encoding round-trip.

This is the **last gate** before Phase 2 builds the full native session-view chrome.

## Prerequisites

- Pull `master` and ensure `mobile/` is at the latest commit.
- macOS with the Flutter SDK installed (`flutter --version` ≥ 3.22).
- For iOS: an Apple Developer account, Xcode installed, and a physical iPhone (iOS 15+).
- For Android: a physical Android device (Android 8+, API 26+) with USB debugging enabled.
- Reach a Remote Dev server URL from the device's network (e.g., a Cloudflare Tunnel or local Wi-Fi).

## Setup

```bash
cd mobile
flutter pub get
flutter devices
```

`flutter devices` should list at least one connected device.

## iOS run

```bash
cd mobile
flutter run -d <ios-device-id>
```

1. App boots into the **Servers** screen.
2. Tap the **+** icon (top right) → enter your Remote Dev server URL + a label → tap **Save**.
3. The list now shows the server. Tap the **bug-report icon** in the AppBar to open the **Bridge spike** screen.
4. The WebView loads `<server>/m/session/spike-test` and either:
   - Authenticates inline via Cloudflare Access (CF challenge appears in the WebView), or
   - Renders the terminal (if you're already signed in via the WebView's cookie jar).
5. **Wait for the green dot** in the bottom-left of the input bar — that's `onTerminalReady` arriving from the PWA via `addJavaScriptHandler`.
6. Type `ls` → tap the send icon. Verify `ls` runs in the terminal inside the WebView.
7. Type a longer string (`echo hello world`) → send. Verify the entire string reaches the terminal.
8. Tap the input field. **Verify the keyboard rises and the terminal area does NOT reflow** — no cursor jumps, no SIGWINCH-style redraws inside the terminal.
9. Dismiss the keyboard (drag down, tap outside, or tap "Done"). Verify the layout returns to the pre-keyboard state without re-rendering the terminal.
10. Type `clear`, send. Verify the terminal clears.
11. Type `echo "don't \\ test"`, send. Verify the special characters (single quote, backslash) survive end-to-end and the terminal shows the literal output.

## Android run

```bash
cd mobile
flutter run -d <android-device-id>
```

Repeat steps 1–11 from the iOS section.

## Pass / Fail criteria

PASS — every step above completes successfully:

- ✅ `onTerminalReady` arrives in Dart within ~2 seconds of the WebView loading.
- ✅ `rdvBridge.input(text)` round-trips and renders in the terminal.
- ✅ Keyboard rise/fall does NOT reflow the terminal.
- ✅ Special characters preserved end-to-end.

If ANY step fails, file a bd issue with title `P1.5 spike: <symptom>` linked to `remote-dev-h4rv` (Phase 1.5 epic). Capture:

- Device model + OS version.
- Exact reproduction steps.
- Screen recording (iOS: Control Center → screen record; Android: `adb shell screenrecord`).

## Recording the result

After PASS on both platforms:

```bash
bd close remote-dev-kahi --reason="Manually validated on iPhone <model> iOS <version> + Pixel <model> Android <version> on <YYYY-MM-DD>; round-trip + onTerminalReady + keyboard pattern + special chars all PASS"
```

After this, Phase 1.5 epic (`remote-dev-h4rv`) is unblocked for closure and Phase 2 (`remote-dev-ytl0`) can begin.

## Why this is manual

The bridge round-trip touches native WKWebView/Android WebView code paths that don't run under Flutter's test environment. xterm.js running inside a real WebView with a real WebSocket to a real Remote Dev server is genuinely platform behavior — no automated test substitutes for a physical-device pass. Phase 2 builds the production session-view chrome on top of this foundation, so confidence in the spike is the prerequisite for proceeding.
