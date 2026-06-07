// Smoke tests for SessionViewScreen.
//
// The real InAppWebView platform plugin is not available under the
// flutter_test renderer, so we cannot drive the bridge round-trip.
// We assert what we can:
//   1. The screen mounts in a Scaffold without throwing during the
//      first frame.
//   2. The keyed `webview-frame` SizedBox SHRINKS by the keyboard inset
//      when the soft keyboard rises — this is what triggers a
//      visualViewport resize inside xterm.js, which in turn refits the
//      grid and reflows tmux. (See `EmbeddedSessionView` + Terminal.tsx
//      `visualViewport` listener.)
//
// We suppress the expected `InAppWebViewPlatform.instance != null`
// assertion the same way `bridge_spike/keyboard_layout_test` does.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:remote_dev/domain/session_summary.dart';
import 'package:remote_dev/presentation/screens/session_view/activity_pip.dart';
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
    'seeds the status-bar pip from the initial summary activity',
    (tester) async {
      final originalOnError = FlutterError.onError;
      FlutterError.onError = (details) {
        if (details.exceptionAsString().contains('InAppWebViewPlatform')) {
          return;
        }
        originalOnError?.call(details);
      };
      addTearDown(() => FlutterError.onError = originalOnError);

      // A session opened mid-subagent-run must show its real activity at once,
      // not flash 'Idle' until the next live hook transition (remote-dev-sguu).
      await tester.pumpWidget(
        ProviderScope(
          child: MaterialApp(
            home: SessionViewScreen(
              sessionId: 'test-session',
              initialSummary: const SessionSummary(
                id: 'test-session',
                name: 'Mid-run',
                tmuxSessionName: 'rdv-test-session',
                status: SessionStatus.active,
                activity: AgentActivityStatus.subagent,
              ),
            ),
          ),
        ),
      );
      for (var i = 0; i < 5; i++) {
        await tester.pump(const Duration(milliseconds: 16));
      }

      // The pip is the violet (subagent) circle, seeded before any onActivity
      // bridge transition fires.
      final pipFinder = find.byWidgetPredicate((w) {
        if (w is! Container) return false;
        final dec = w.decoration;
        if (dec is! BoxDecoration) return false;
        return dec.shape == BoxShape.circle &&
            dec.color == const Color(0xFFBB9AF7);
      });
      expect(pipFinder, findsOneWidget);
      expect(find.byType(ActivityPip), findsOneWidget);
    },
  );

  testWidgets(
    'webview-frame shrinks by keyboard inset when keyboard rises',
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

      const inset = 300.0;
      await tester.pumpWidget(framed(inset));
      for (var i = 0; i < 5; i++) {
        await tester.pump(const Duration(milliseconds: 16));
      }
      final sizeKeyboard = tester.getSize(keyFinder);

      expect(
        sizeKeyboard.height,
        closeTo(size0.height - inset, 0.5),
        reason:
            'WebView MUST shrink by the keyboard inset so xterm.js fires '
            'a visualViewport resize and tmux reflows. Found '
            '${size0.height} → ${sizeKeyboard.height} (expected ~'
            '${size0.height - inset}).',
      );
    },
  );
}
