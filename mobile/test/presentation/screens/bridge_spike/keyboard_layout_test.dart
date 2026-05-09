// Spec §4 verification: BridgeSpikeScreen MUST keep the WebView area's
// height constant when the soft keyboard rises. The pattern is
// `Scaffold(resizeToAvoidBottomInset: false)` + an explicitly
// constrained WebView height (NOT `Expanded`), with the input bar
// floating above the keyboard via Stack + Positioned.
//
// We pump the screen with a fake `MediaQuery` simulating keyboard
// rise (viewInsets.bottom = 0 → 300) and assert the WebView's
// SizedBox (keyed `webview-frame`) reports the same height in both
// states.
//
// InAppWebView may not mount under the test renderer; if the keyed
// SizedBox can't be located, we mark the test skipped per spec.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:remote_dev/domain/server_config.dart';
import 'package:remote_dev/presentation/screens/bridge_spike/bridge_spike_screen.dart';
import 'package:remote_dev/presentation/screens/webview_host/session_route_host.dart';

void main() {
  testWidgets(
    'WebView SizedBox height is constant before/after keyboard rise',
    (tester) async {
      // Suppress the expected `InAppWebViewPlatform.instance != null`
      // assertion that fires under the test renderer (no platform
      // plugin). We still want to inspect the widget tree to verify
      // the keyed SizedBox's geometry — the assertion happens during
      // InAppWebView's constructor, but the parent SizedBox is built
      // before that, so its layout proceeds.
      final originalOnError = FlutterError.onError;
      var sawWebViewPlatformError = false;
      FlutterError.onError = (details) {
        if (details.exceptionAsString().contains(
              'InAppWebViewPlatform',
            )) {
          sawWebViewPlatformError = true;
          return;
        }
        originalOnError?.call(details);
      };
      addTearDown(() => FlutterError.onError = originalOnError);

      Widget framed(double keyboardInset) => ProviderScope(
            overrides: [
              activeServerProvider.overrideWith(
                (ref) async => ServerConfig(
                  id: 'test',
                  label: 'Test',
                  url: 'https://example.com',
                  lastUsedAt: DateTime(2026, 5, 8),
                ),
              ),
            ],
            child: MaterialApp(
              home: MediaQuery(
                data: MediaQueryData(
                  size: const Size(400, 800),
                  viewInsets: EdgeInsets.only(bottom: keyboardInset),
                ),
                child: const BridgeSpikeScreen(),
              ),
            ),
          );

      await tester.pumpWidget(framed(0));
      // Settle the FutureProvider for activeServerProvider; do not use
      // pumpAndSettle because InAppWebView may schedule a long-running
      // async load. A bounded number of pumps is enough to flush the
      // microtask that resolves the override.
      for (var i = 0; i < 5; i++) {
        await tester.pump(const Duration(milliseconds: 16));
      }

      final keyFinder = find.byKey(const Key('webview-frame'));
      if (keyFinder.evaluate().isEmpty) {
        markTestSkipped(
          'BridgeSpikeScreen did not render the keyed SizedBox under '
          'the test renderer (sawWebViewPlatformError=$sawWebViewPlatformError). '
          'Manual verification required on devices.',
        );
        return;
      }
      final size0 = tester.getSize(keyFinder);

      // Keyboard rises: viewInsets.bottom goes 0 → 300.
      await tester.pumpWidget(framed(300));
      for (var i = 0; i < 5; i++) {
        await tester.pump(const Duration(milliseconds: 16));
      }
      final size300 = tester.getSize(keyFinder);

      expect(
        size300.height,
        equals(size0.height),
        reason:
            'Spec §4: WebView height MUST NOT change when the keyboard '
            'rises. Found ${size0.height} → ${size300.height}.',
      );
    },
  );
}
