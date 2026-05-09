// Smoke tests for SessionViewScreen.
//
// The real InAppWebView platform plugin is not available under the
// flutter_test renderer, so we cannot drive the bridge round-trip.
// We assert what we can:
//   1. The screen mounts in a Scaffold without throwing during the
//      first frame.
//   2. The keyed `webview-frame` SizedBox keeps a constant height when
//      the soft keyboard rises (Spec §4 — the input bar floats above
//      the keyboard via Stack + Positioned, the WebView area does NOT
//      reflow).
//
// We suppress the expected `InAppWebViewPlatform.instance != null`
// assertion the same way `bridge_spike/keyboard_layout_test` does.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:remote_dev/presentation/screens/session_view/session_view_screen.dart';

void main() {
  testWidgets('SessionViewScreen mounts in a Scaffold', (tester) async {
    final originalOnError = FlutterError.onError;
    FlutterError.onError = (details) {
      if (details.exceptionAsString().contains('InAppWebViewPlatform')) {
        return;
      }
      originalOnError?.call(details);
    };
    addTearDown(() => FlutterError.onError = originalOnError);

    await tester.pumpWidget(
      const ProviderScope(
        child: MaterialApp(
          home: SessionViewScreen(sessionId: 'test-session'),
        ),
      ),
    );
    // Don't pumpAndSettle — InAppWebView creates platform channels we
    // can't fulfill. A bounded number of pumps flushes the FutureBuilder
    // microtasks for the active-server lookup.
    for (var i = 0; i < 5; i++) {
      await tester.pump(const Duration(milliseconds: 16));
    }

    expect(find.byType(Scaffold), findsAtLeast(1));
  });

  testWidgets(
    'webview-frame height is constant before/after keyboard rise',
    (tester) async {
      final originalOnError = FlutterError.onError;
      FlutterError.onError = (details) {
        if (details.exceptionAsString().contains('InAppWebViewPlatform')) {
          return;
        }
        originalOnError?.call(details);
      };
      addTearDown(() => FlutterError.onError = originalOnError);

      Widget framed(double keyboardInset) => ProviderScope(
            child: MaterialApp(
              home: MediaQuery(
                data: MediaQueryData(
                  size: const Size(400, 800),
                  viewInsets: EdgeInsets.only(bottom: keyboardInset),
                ),
                child: const SessionViewScreen(sessionId: 'test-session'),
              ),
            ),
          );

      await tester.pumpWidget(framed(0));
      for (var i = 0; i < 5; i++) {
        await tester.pump(const Duration(milliseconds: 16));
      }

      final keyFinder = find.byKey(const Key('webview-frame'));
      if (keyFinder.evaluate().isEmpty) {
        markTestSkipped(
          'SessionViewScreen did not render the keyed SizedBox under '
          'the test renderer. Manual verification required on devices.',
        );
        return;
      }
      final size0 = tester.getSize(keyFinder);

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
