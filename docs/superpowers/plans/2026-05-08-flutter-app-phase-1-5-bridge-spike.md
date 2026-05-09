# Flutter App — Phase 1.5: Bridge Smoke-Test Spike

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development`. Subagents work in worktrees branched off `master`. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** De-risk Phase 2 by proving the JS bridge round-trip works end-to-end and that the keyboard-layout pattern from spec §4 doesn't reflow the WebView terminal. Lands as a tiny POC screen + a reusable controller + keyboard-layout pattern.

**Architecture:** A throwaway "BridgeSpikeScreen" that mounts an `InAppWebView` at `<server>/m/session/<id>` with a single native `TextField` below it. On submit, native calls `controller.evaluateJavascript("window.rdvBridge.input(...)")`. A native handler registered in `onWebViewCreated` listens for `onTerminalReady` from the PWA and unlocks input via a queue (the `BridgeController`). The keyboard layout uses `Scaffold(resizeToAvoidBottomInset: false)` + manual `MediaQuery.viewInsetsOf(...).bottom` math to avoid the WebView resize → xterm reflow → PTY SIGWINCH chain.

**Tech Stack:** Same as Phase 1.

**Spec:** §2.2 rules, §4 keyboard layout pattern, §12 Phase 1.5 ship gate.

**Out of scope:** P1.5.4 (manual device testing) is documented as a test-plan script in this PR for the human reviewer to run on iOS + Android physical devices. It does NOT block PR merge — but the loop's "APK runs without issue" gate requires a human pass.

---

## File Structure

**New files:**
- `mobile/lib/infrastructure/webview/bridge_controller.dart` — queues native→WebView calls until `onTerminalReady` fires
- `mobile/lib/presentation/screens/bridge_spike/bridge_spike_screen.dart` — POC screen
- `mobile/test/infrastructure/webview/bridge_controller_test.dart` — unit tests for queue behavior
- `mobile/test/presentation/screens/bridge_spike/bridge_spike_screen_test.dart` — widget test with mocked WebView
- `docs/mobile-bridge-spike-test-plan.md` — manual test plan for the human

**Modified files:**
- `mobile/lib/presentation/router/app_route.dart` — add `BridgeSpikeRoute`
- `mobile/lib/presentation/router/app_router.dart` — add `/spike` route
- `mobile/lib/presentation/screens/server_picker/server_picker_screen.dart` — add a "Test bridge" button in the AppBar that navigates to `/spike`

---

## Worktree strategy

Single feature branch `feat/mobile-phase-1-5-bridge-spike` off `master`. Three parallel subagents in their own worktrees:
- P1.5.1 POC screen → `feat/mobile-phase-1-5-poc`
- P1.5.2 Controller queue → `feat/mobile-phase-1-5-queue`
- P1.5.3 Keyboard layout (depends on P1.5.1; runs after merge)

P1.5.4 is documentation only (test plan).

---

## Task 1 (P1.5.1): Build minimal POC screen — single TextField + WebView

**Worktree:** `../remote-dev-flutter-p15-poc` on branch `feat/mobile-phase-1-5-poc`
**Files:**
- Create: `mobile/lib/presentation/screens/bridge_spike/bridge_spike_screen.dart`
- Modify: `mobile/lib/presentation/router/app_route.dart` — add `BridgeSpikeRoute`
- Modify: `mobile/lib/presentation/router/app_router.dart` — add `/spike` route
- Modify: `mobile/lib/presentation/screens/server_picker/server_picker_screen.dart` — entry button

### Step 1: Add `BridgeSpikeRoute` to `app_route.dart`

Add a factory + final class for the route:

```dart
const factory AppRoute.bridgeSpike() = BridgeSpikeRoute;

// at the bottom:
final class BridgeSpikeRoute extends AppRoute {
  const BridgeSpikeRoute();
}
```

Update the `toPath()` switch to include `BridgeSpikeRoute() => '/spike'`.

### Step 2: Implement `BridgeSpikeScreen`

```dart
import 'package:flutter/material.dart';
import 'package:flutter_inappwebview/flutter_inappwebview.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../infrastructure/webview/bridge_controller.dart';
import '../../../infrastructure/webview/navigation_policy.dart';
import '../../../infrastructure/webview/webview_factory.dart';
import '../webview_host/session_route_host.dart' show activeServerProvider;

/// Throwaway POC screen for Phase 1.5: a native TextField below an
/// embedded WebView, both wired through the bridge. Goal: prove the
/// round-trip works on iOS + Android physical devices and that the
/// keyboard doesn't reflow the WebView terminal.
class BridgeSpikeScreen extends ConsumerStatefulWidget {
  const BridgeSpikeScreen({super.key});

  @override
  ConsumerState<BridgeSpikeScreen> createState() => _BridgeSpikeScreenState();
}

class _BridgeSpikeScreenState extends ConsumerState<BridgeSpikeScreen> {
  final _inputCtrl = TextEditingController();
  BridgeController? _bridge;
  bool _ready = false;

  @override
  void dispose() {
    _inputCtrl.dispose();
    super.dispose();
  }

  void _send() {
    final text = _inputCtrl.text;
    if (text.isEmpty) return;
    _bridge?.input(text);
    _inputCtrl.clear();
  }

  @override
  Widget build(BuildContext context) {
    final asyncServer = ref.watch(activeServerProvider);
    return asyncServer.when(
      loading: () => const _Loading(),
      error: (e, _) => _ErrorBox(message: 'Failed to load server: $e'),
      data: (server) {
        if (server == null) {
          return const _ErrorBox(
            message: 'No active server. Pick one from the server list first.',
          );
        }
        final origin = Uri.parse(server.url);
        final url = Uri.parse('${server.url}/m/session/spike-test');
        // Spec §4: own the layout math; do NOT let Scaffold resize.
        final keyboardInset = MediaQuery.viewInsetsOf(context).bottom;
        return Scaffold(
          backgroundColor: const Color(0xFF1A1B26),
          resizeToAvoidBottomInset: false,
          appBar: AppBar(
            backgroundColor: const Color(0xFF1A1B26),
            title: const Text('Bridge spike',
                style: TextStyle(color: Colors.white)),
          ),
          body: Column(
            children: [
              Expanded(
                child: const WebViewFactory().build(
                  initialUrl: url,
                  policy: NavigationPolicy(serverOrigin: origin),
                  onLinkOpen: (_) {},
                  onWebViewCreated: (controller) {
                    // Spec §2.2 rule 1: register handlers in onWebViewCreated.
                    final bridge = BridgeController(controller: controller);
                    controller.addJavaScriptHandler(
                      handlerName: 'onTerminalReady',
                      callback: (_) {
                        bridge.markReady();
                        if (mounted) setState(() => _ready = true);
                      },
                    );
                    setState(() => _bridge = bridge);
                  },
                ),
              ),
              SafeArea(
                top: false,
                child: Padding(
                  padding: EdgeInsets.only(bottom: keyboardInset),
                  child: Container(
                    color: const Color(0xFF24283B),
                    padding: const EdgeInsets.all(8),
                    child: Row(
                      children: [
                        Container(
                          width: 8,
                          height: 8,
                          decoration: BoxDecoration(
                            shape: BoxShape.circle,
                            color: _ready
                                ? const Color(0xFF9ECE6A)
                                : const Color(0xFFE0AF68),
                          ),
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: TextField(
                            controller: _inputCtrl,
                            enabled: _ready,
                            style: const TextStyle(color: Colors.white),
                            decoration: InputDecoration(
                              hintText: _ready ? 'send to terminal' : 'connecting…',
                              hintStyle: const TextStyle(color: Colors.white54),
                              border: InputBorder.none,
                            ),
                            onSubmitted: (_) => _send(),
                          ),
                        ),
                        IconButton(
                          icon: const Icon(Icons.send, color: Colors.white),
                          onPressed: _ready ? _send : null,
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}

class _Loading extends StatelessWidget {
  const _Loading();
  @override
  Widget build(BuildContext context) {
    return const Scaffold(
      backgroundColor: Color(0xFF1A1B26),
      body: Center(child: CircularProgressIndicator()),
    );
  }
}

class _ErrorBox extends StatelessWidget {
  const _ErrorBox({required this.message});
  final String message;
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF1A1B26),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Text(message, style: const TextStyle(color: Colors.white70)),
        ),
      ),
    );
  }
}
```

### Step 3: Wire `/spike` into the router

Add a `GoRoute` mapping `/spike` to `Consumer(builder: (_, ref, __) => const BridgeSpikeScreen())`.

### Step 4: Add a "Test bridge" entry in the server picker

Add an `IconButton(icon: Icon(Icons.bug_report))` in the `ServerPickerScreen` AppBar `actions` that calls `context.go('/spike')`.

### Step 5: Run + commit

`flutter analyze` clean. Smoke widget test passes. Commit with message:

```
feat(mobile/spike): minimum POC screen for bridge round-trip

- BridgeSpikeScreen: WebView at /m/session/spike-test + native TextField
- Wired via /spike route, accessible from server picker AppBar
- Spec §4 keyboard layout pattern: resizeToAvoidBottomInset: false +
  manual viewInsetsOf math
- onTerminalReady handler registered in onWebViewCreated

Plan: docs/superpowers/plans/2026-05-08-flutter-app-phase-1-5-bridge-spike.md Task 1

Co-authored-by: Isaac
```

---

## Task 2 (P1.5.2): Implement `BridgeController` queue

**Worktree:** `../remote-dev-flutter-p15-queue` on branch `feat/mobile-phase-1-5-queue`
**Files:**
- Create: `mobile/lib/infrastructure/webview/bridge_controller.dart`
- Create: `mobile/test/infrastructure/webview/bridge_controller_test.dart`

### Step 1: Implement `BridgeController`

Spec §2.2 rule 2: native-to-WebView calls are gated on a "ready" event. Queue calls until `markReady()` fires, then drain. Calls during navigation are dropped (not re-queued — this is Phase 2's concern; for Phase 1.5 we just stop accepting after `markUnready()` until `markReady` again).

```dart
import 'package:flutter_inappwebview/flutter_inappwebview.dart';

/// Queues `evaluateJavascript` invocations until [markReady] fires,
/// then drains. After [markReady] subsequent calls go through
/// immediately. [markUnready] re-locks the gate (used during
/// navigation; Phase 2 wires the lifecycle).
///
/// Spec §2.2 rule 2.
class BridgeController {
  BridgeController({required this.controller});

  final InAppWebViewController controller;
  final List<String> _queue = [];
  bool _ready = false;

  bool get isReady => _ready;

  void markReady() {
    _ready = true;
    while (_queue.isNotEmpty) {
      final js = _queue.removeAt(0);
      controller.evaluateJavascript(source: js);
    }
  }

  void markUnready() {
    _ready = false;
  }

  /// Equivalent to `window.rdvBridge.input(text)`.
  void input(String text) => _exec("window.rdvBridge.input(${_q(text)})");

  /// Equivalent to `window.rdvBridge.key(name, mods)`.
  void key(String name, Map<String, bool> mods) {
    final modsJson = '{${mods.entries.map((e) => '"${e.key}":${e.value}').join(',')}}';
    _exec('window.rdvBridge.key(${_q(name)},$modsJson)');
  }

  /// Equivalent to `window.rdvBridge.scrollToBottom()`.
  void scrollToBottom() => _exec('window.rdvBridge.scrollToBottom()');

  void _exec(String js) {
    if (_ready) {
      controller.evaluateJavascript(source: js);
    } else {
      _queue.add(js);
    }
  }

  /// Quote a string for safe interpolation into JS source.
  static String _q(String value) {
    final escaped = value
        .replaceAll(r'\', r'\\')
        .replaceAll("'", r"\'")
        .replaceAll('\n', r'\n')
        .replaceAll('\r', r'\r');
    return "'$escaped'";
  }
}
```

### Step 2: Test the queue behavior

```dart
import 'package:flutter_inappwebview/flutter_inappwebview.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:remote_dev/infrastructure/webview/bridge_controller.dart';

class _MockController extends Mock implements InAppWebViewController {}

void main() {
  late _MockController ctl;
  late BridgeController bridge;

  setUp(() {
    ctl = _MockController();
    when(() => ctl.evaluateJavascript(source: any(named: 'source')))
        .thenAnswer((_) async => null);
    bridge = BridgeController(controller: ctl);
  });

  test('input queues while not ready', () {
    bridge.input('hi');
    bridge.input('there');
    verifyNever(() => ctl.evaluateJavascript(source: any(named: 'source')));
  });

  test('markReady drains the queue in order', () {
    bridge.input('first');
    bridge.input('second');
    bridge.markReady();
    final captured = verify(
      () => ctl.evaluateJavascript(source: captureAny(named: 'source')),
    ).captured;
    expect(captured, hasLength(2));
    expect(captured[0], contains("window.rdvBridge.input('first')"));
    expect(captured[1], contains("window.rdvBridge.input('second')"));
  });

  test('post-ready calls go through immediately', () {
    bridge.markReady();
    bridge.input('immediate');
    verify(() => ctl.evaluateJavascript(
            source: "window.rdvBridge.input('immediate')")).called(1);
  });

  test('escapes special characters in input', () {
    bridge.markReady();
    bridge.input("don't \\ \n");
    final captured = verify(() => ctl.evaluateJavascript(
        source: captureAny(named: 'source'))).captured.single as String;
    expect(captured, contains(r"don\'t \\"));
    expect(captured, contains(r'\n'));
  });

  test('key serializes modifiers as JSON', () {
    bridge.markReady();
    bridge.key('Tab', {'ctrl': true, 'shift': false});
    verify(() => ctl.evaluateJavascript(
            source: 'window.rdvBridge.key(\'Tab\',{"ctrl":true,"shift":false})'))
        .called(1);
  });
}
```

### Step 3: Run + commit

```
feat(mobile/spike): BridgeController queues native→WebView calls until ready

- Spec §2.2 rule 2: queue evaluateJavascript invocations until markReady
- Drains on markReady; post-ready calls go through immediately
- Escapes single quotes / backslashes / newlines in input strings
- Serializes key modifier maps as JSON

Plan: docs/superpowers/plans/2026-05-08-flutter-app-phase-1-5-bridge-spike.md Task 2

Co-authored-by: Isaac
```

---

## Task 3 (P1.5.3): Implement keyboard layout pattern (mandatory)

**Worktree:** `../remote-dev-flutter-p15-keyboard` (after Task 1 + 2 land on `feat/mobile-phase-1-5-bridge-spike`)
**Files:**
- Modify: `mobile/lib/presentation/screens/bridge_spike/bridge_spike_screen.dart` — verify `resizeToAvoidBottomInset: false` + `viewInsetsOf` bottom; add explicit constrained-height for the WebView block
- Create: `mobile/test/presentation/screens/bridge_spike/bridge_spike_screen_test.dart` — widget test that pumps the screen with a fake `MediaQuery` simulating keyboard rise, asserts the WebView's parent constraints don't shrink

The implementation in Task 1 already follows the pattern. This task tightens it:

### Step 1: Verify `Scaffold(resizeToAvoidBottomInset: false)`

Already in Task 1's code. Add a code comment explaining the architectural rule.

### Step 2: Verify `MediaQuery.viewInsetsOf(context).bottom`

Already in Task 1's code. Add the comment.

### Step 3: Wrap the WebView in a `LayoutBuilder` to assert constraints don't shrink under the keyboard

Replace the `Expanded(...)` wrapping `WebViewFactory().build(...)` with:

```dart
LayoutBuilder(builder: (context, constraints) {
  // The WebView gets the full remaining height minus the input row.
  // Crucially, this height is NOT affected by viewInsetsOf — that
  // value is consumed entirely by the input bar's bottom padding.
  return SizedBox(
    height: constraints.maxHeight,
    child: const WebViewFactory().build(...),
  );
}),
```

(Adapt to the existing structure; the key change is making the height an explicit constraint, not `Expanded`.)

### Step 4: Widget test — keyboard rise doesn't shrink WebView area

Use `MediaQueryData(viewInsets: EdgeInsets.only(bottom: 300))` to simulate keyboard. Pump the screen and use `tester.getSize(find.byType(InAppWebView))` to verify the WebView's height EQUALS the available height before and after keyboard rise.

(Note: `InAppWebView` may not render under the test renderer — use a finder for the parent `SizedBox` or stub `WebViewFactory` for the test.)

### Step 5: Run + commit

```
feat(mobile/spike): tighten keyboard layout pattern (spec §4)

- Scaffold(resizeToAvoidBottomInset: false) — own the math
- WebView wrapped in explicit-height LayoutBuilder/SizedBox; height is
  total - input bar - keyboard inset (consumed by input bar's bottom pad)
- Widget test asserts WebView area constant before/after keyboard rise

Plan: docs/superpowers/plans/2026-05-08-flutter-app-phase-1-5-bridge-spike.md Task 3

Co-authored-by: Isaac
```

---

## Task 4 (P1.5.4): Document the manual device-test plan

**Files:**
- Create: `docs/mobile-bridge-spike-test-plan.md`

Manual test that the human reviewer runs on a physical iPhone + Android device after merging this PR. Result documented in a follow-up commit / issue, NOT in this PR.

```markdown
# Phase 1.5 — Bridge Smoke-Test Plan (manual, physical devices)

Run these steps on at least one physical iPhone (iOS 15+) and one physical Android device (Android 8+) after the Phase 1.5 PR merges.

## Setup

1. Pull `master` and `cd mobile && flutter pub get`.
2. Connect a physical device via USB (or wirelessly). Confirm `flutter devices` lists it.
3. Have a Remote Dev server URL handy that's reachable from the device's network.

## iOS

1. `flutter run -d <ios-device-id>` from `mobile/`.
2. Sign in via CF Access in the WebView (any /m/* URL).
3. Tap the **bug-report icon** in the server picker AppBar to open the bridge spike screen.
4. Wait for the green dot in the bottom-left of the input bar (`onTerminalReady` arrived).
5. Type `ls`, hit send. Verify `ls` runs in the terminal inside the WebView.
6. Type a long string, hit send. Verify it reaches the terminal verbatim (no truncation).
7. Tap the input field; verify the keyboard rises **and the terminal area does NOT reflow** (no SIGWINCH-style cursor jumping).
8. Dismiss the keyboard; verify the layout snaps back without re-rendering the terminal.
9. Type `clear`, send; verify the terminal clears.
10. Use special characters: `echo "don't \\ test"` and verify the escaping survived.

## Android

Repeat steps 1–10 with `flutter run -d <android-device-id>`.

## Expected outcomes

- ✅ Bridge round-trip works.
- ✅ `onTerminalReady` arrives in Dart within ~2 s of the WebView loading.
- ✅ Keyboard rise/fall does NOT reflow the terminal.
- ✅ Special characters (quotes, backslash, newline) are preserved end-to-end.

## If anything fails

File a bd issue with title `P1.5 spike: <symptom>` linked to `remote-dev-h4rv`. Capture device model, OS version, exact reproduction steps, and a screen recording.
```

### Step 5: Commit

```
docs(mobile): manual bridge-spike test plan for physical devices

- Step-by-step iOS + Android validation procedure
- Linked from Phase 1.5 plan + bd issue h4rv
- Result captured in a follow-up commit by the human reviewer

Plan: docs/superpowers/plans/2026-05-08-flutter-app-phase-1-5-bridge-spike.md Task 4

Co-authored-by: Isaac
```

---

## Phase 1.5 ship gate

After all 4 tasks land on `feat/mobile-phase-1-5-bridge-spike`:

- [ ] `flutter analyze` clean
- [ ] `flutter test` passes (existing 25 + new bridge_controller tests + spike widget test)
- [ ] `flutter build apk --debug` succeeds
- [ ] PR merged → auto-deploy
- [ ] (Manual, post-merge) `docs/mobile-bridge-spike-test-plan.md` validated on physical iPhone + Android by the human reviewer

The manual device test is the loop's "runs without issue" gate — tracked separately, doesn't block code merge.
