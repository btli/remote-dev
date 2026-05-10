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
  void input(String text) => _exec('window.rdvBridge.input(${_q(text)})');

  /// Equivalent to `window.rdvBridge.key(name, mods)`.
  void key(String name, Map<String, bool> mods) {
    final modsJson = '{${mods.entries.map((e) => '"${e.key}":${e.value}').join(',')}}';
    _exec('window.rdvBridge.key(${_q(name)},$modsJson)');
  }

  /// Equivalent to `window.rdvBridge.scrollToBottom()`.
  void scrollToBottom() => _exec('window.rdvBridge.scrollToBottom()');

  /// Equivalent to `window.rdvBridge.paste(text)`.
  void paste(String text) => _exec('window.rdvBridge.paste(${_q(text)})');

  /// Equivalent to `window.rdvBridge.setFontSize(px)`.
  void setFontSize(int px) => _exec('window.rdvBridge.setFontSize($px)');

  /// Equivalent to `window.rdvBridge.setFontScale(scale)`. The PWA listens
  /// and updates the `--rdv-font-scale` CSS variable so terminal +
  /// channel content visually scales.
  void setFontScale(double scale) =>
      _exec('window.rdvBridge.setFontScale($scale)');

  /// Equivalent to `window.rdvBridge.setCursorBlink(blink)`. Toggles
  /// xterm.js's `cursorBlink` option inside the session embed; other
  /// embeds accept the call as a no-op.
  void setCursorBlink(bool blink) =>
      _exec('window.rdvBridge.setCursorBlink(${blink ? 'true' : 'false'})');

  /// Asks the embedded PWA to handle a back gesture. Returns `true` when
  /// the PWA reports it consumed the gesture (e.g. closed an open thread,
  /// dismissed a modal, popped an in-WebView route) and `false` otherwise
  /// — including when the bridge isn't ready yet, evaluation throws, the
  /// JS surface is missing, or `back()` returns `undefined`/falsy.
  ///
  /// The PWA-side contract is `back: () => boolean` (see
  /// `src/lib/rdv-bridge.ts`). Implementations MUST return `true` only
  /// when they actually consumed the gesture so the native shell skips
  /// its own `Navigator.maybePop()`. Returning `undefined` (the
  /// pre-fix behavior) coerces to `false` here, which means native pops
  /// — preserving today's behavior for any bridge build still on the
  /// old contract.
  ///
  /// The eval is wrapped in an async IIFE so that if a future bridge
  /// build returns `Promise<boolean>` we still resolve the actual
  /// boolean before signaling Dart, instead of `!!Promise === true`
  /// racing the JS handler. `flutter_inappwebview`'s
  /// `evaluateJavascript` awaits returned promises automatically.
  Future<bool> back() async {
    if (!_ready) return false;
    try {
      final result = await controller.evaluateJavascript(
        source: '''
(async () => {
  if (!window.rdvBridge || !window.rdvBridge.back) return false;
  try {
    const r = window.rdvBridge.back();
    if (r && typeof r.then === 'function') return (await r) === true;
    return r === true;
  } catch (_) {
    return false;
  }
})()
''',
      );
      return result == true || result == 'true' || result == 1;
    } catch (_) {
      return false;
    }
  }

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
