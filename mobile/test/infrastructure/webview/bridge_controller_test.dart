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
    verify(
      () => ctl.evaluateJavascript(
        source: "window.rdvBridge.input('immediate')",
      ),
    ).called(1);
  });

  test('escapes special characters in input', () {
    bridge.markReady();
    bridge.input("don't \\ \n");
    final captured = verify(
      () => ctl.evaluateJavascript(source: captureAny(named: 'source')),
    ).captured.single as String;
    expect(captured, contains(r"don\'t \\"));
    expect(captured, contains(r'\n'));
  });

  test('key serializes modifiers as JSON', () {
    bridge.markReady();
    bridge.key('Tab', {'ctrl': true, 'shift': false});
    verify(
      () => ctl.evaluateJavascript(
        source: 'window.rdvBridge.key(\'Tab\',{"ctrl":true,"shift":false})',
      ),
    ).called(1);
  });

  test('back returns false when bridge is not ready', () async {
    final result = await bridge.back();
    expect(result, isFalse);
    verifyNever(() => ctl.evaluateJavascript(source: any(named: 'source')));
  });

  test('back returns true when PWA reports it consumed the gesture', () async {
    when(() => ctl.evaluateJavascript(source: any(named: 'source')))
        .thenAnswer((_) async => true);
    bridge.markReady();
    final result = await bridge.back();
    expect(result, isTrue);
    verify(
      () => ctl.evaluateJavascript(
        source:
            'window.rdvBridge && window.rdvBridge.back ? !!window.rdvBridge.back() : false',
      ),
    ).called(1);
  });

  test('back returns false when JS bridge is missing or returns void',
      () async {
    when(() => ctl.evaluateJavascript(source: any(named: 'source')))
        .thenAnswer((_) async => false);
    bridge.markReady();
    expect(await bridge.back(), isFalse);
  });

  test('back swallows evaluation errors and returns false', () async {
    when(() => ctl.evaluateJavascript(source: any(named: 'source')))
        .thenThrow(Exception('webview crashed'));
    bridge.markReady();
    expect(await bridge.back(), isFalse);
  });
}
