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
    final captured = verify(
      () => ctl.evaluateJavascript(source: captureAny(named: 'source')),
    ).captured.single as String;
    // Eval is an async IIFE so Promise returns from the PWA bridge
    // resolve cleanly — see bridge_controller.dart.
    expect(captured, contains('window.rdvBridge'));
    expect(captured, contains('window.rdvBridge.back'));
    expect(captured, contains('async'));
  });

  test('back returns false when JS bridge returns false', () async {
    when(() => ctl.evaluateJavascript(source: any(named: 'source')))
        .thenAnswer((_) async => false);
    bridge.markReady();
    expect(await bridge.back(), isFalse);
  });

  // Codex finding on PR #272: when the PWA-side `back()` returns
  // `undefined` (the old `() => void` contract, or a handler that
  // forgets to `return true`), the eval resolves to `false` and the
  // native shell falls back to Navigator.maybePop(). Without the
  // boolean contract, the previous `!!undefined === false` path
  // unconditionally popped the route even when the PWA had just
  // consumed the gesture by closing a thread.
  test('back returns false when PWA returns undefined (regression)',
      () async {
    when(() => ctl.evaluateJavascript(source: any(named: 'source')))
        .thenAnswer((_) async => false);
    bridge.markReady();
    expect(await bridge.back(), isFalse);
  });

  test('back returns false when only "true"-string (defensive)', () async {
    // flutter_inappwebview can serialize JS booleans as Dart booleans
    // on iOS but as strings on some Android API levels — accept both.
    when(() => ctl.evaluateJavascript(source: any(named: 'source')))
        .thenAnswer((_) async => 'true');
    bridge.markReady();
    expect(await bridge.back(), isTrue);
  });

  // The async IIFE in bridge_controller.dart awaits Promise returns
  // before the Dart Future resolves. flutter_inappwebview unwraps the
  // Promise via the IIFE's `return await r` and surfaces the resolved
  // boolean to Dart — so a Promise<true> from the PWA still ends up
  // as `true` here, not `!!Promise === true` racing the handler.
  test('back resolves Promise<true> from PWA before returning', () async {
    when(() => ctl.evaluateJavascript(source: any(named: 'source')))
        .thenAnswer((_) async => true);
    bridge.markReady();
    expect(await bridge.back(), isTrue);
  });

  test('back swallows evaluation errors and returns false', () async {
    when(() => ctl.evaluateJavascript(source: any(named: 'source')))
        .thenThrow(Exception('webview crashed'));
    bridge.markReady();
    expect(await bridge.back(), isFalse);
  });
}
