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
    bridge.markReady();
  });

  test('paste invokes window.rdvBridge.paste with escaped string', () {
    bridge.paste("don't");
    verify(
      () => ctl.evaluateJavascript(
        source: r"window.rdvBridge.paste('don\'t')",
      ),
    ).called(1);
  });

  test('setFontSize invokes window.rdvBridge.setFontSize', () {
    bridge.setFontSize(14);
    verify(
      () => ctl.evaluateJavascript(
        source: 'window.rdvBridge.setFontSize(14)',
      ),
    ).called(1);
  });

  test('paste queues while not ready, drains on markReady', () {
    final ctl2 = _MockController();
    when(() => ctl2.evaluateJavascript(source: any(named: 'source')))
        .thenAnswer((_) async => null);
    final bridge2 = BridgeController(controller: ctl2);
    bridge2.paste('hello');
    verifyNever(() => ctl2.evaluateJavascript(source: any(named: 'source')));
    bridge2.markReady();
    verify(
      () => ctl2.evaluateJavascript(
        source: "window.rdvBridge.paste('hello')",
      ),
    ).called(1);
  });

  test('markUnready re-locks the gate', () {
    bridge.markUnready();
    bridge.setFontSize(16);
    // Did not go through immediately.
    verifyNever(
      () => ctl.evaluateJavascript(
        source: 'window.rdvBridge.setFontSize(16)',
      ),
    );
    bridge.markReady();
    verify(
      () => ctl.evaluateJavascript(
        source: 'window.rdvBridge.setFontSize(16)',
      ),
    ).called(1);
  });
}
