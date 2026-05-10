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

  /// Asks the embedded PWA to handle a back gesture. Returns `true` when
  /// the PWA reports it consumed the gesture (e.g. closed an open thread,
  /// dismissed a modal, popped an in-WebView route) and `false` otherwise
  /// — including when the bridge isn't ready yet, evaluation throws, or
  /// the PWA-side `back()` returns `void`/`undefined`.
  ///
  /// The Dart side is intentionally tolerant: existing PWA bridge builds
  /// declare `back: () => void`, so until the JS surface is updated to
  /// return a boolean (tracked separately from this `mobile/`-only PR)
  /// every call resolves to `false` and native callers simply fall back
  /// to `Navigator.pop`. Once the PWA returns truthy from `back()`, the
  /// expression below picks it up automatically.
  Future<bool> back() async {
    if (!_ready) return false;
    try {
      final result = await controller.evaluateJavascript(
        source:
            'window.rdvBridge && window.rdvBridge.back ? !!window.rdvBridge.back() : false',
      );
      return result == true;
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
