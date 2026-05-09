// TEMPORARY STUB — P1.5.2 will replace this with the full queue-based
// implementation. This minimal version exists only so that P1.5.1's
// BridgeSpikeScreen can compile in this branch. When the integration
// branch merges P1.5.2, the merge will overwrite this file with the
// real implementation (see plan: docs/superpowers/plans/
// 2026-05-08-flutter-app-phase-1-5-bridge-spike.md Task 2).
import 'package:flutter_inappwebview/flutter_inappwebview.dart';

class BridgeController {
  BridgeController({required this.controller});

  final InAppWebViewController controller;
  bool _ready = false;

  bool get isReady => _ready;

  void markReady() {
    _ready = true;
  }

  void markUnready() {
    _ready = false;
  }

  void input(String text) {
    if (_ready) {
      controller.evaluateJavascript(
        source: "window.rdvBridge.input('$text')",
      );
    }
  }
}
