// Regression tests for the "session header shows the UUID instead of the
// name" bug (Task F).
//
// `SessionViewScreen` used to set `_sessionName = widget.sessionId` as an
// explicit Phase-2 placeholder, so the header (`SessionStatusBar`) rendered
// the raw session UUID. The fix resolves the real name:
//   - immediately from `initialSummary` when the route carries one
//     (Sessions list / freshly-created session), or
//   - from the sessions list API for notification / deep-link cold-starts.
// Before resolution the header shows the neutral 'Session' label — NEVER the
// id.
//
// These widget tests can't drive the real InAppWebView (no platform plugin
// under the flutter_test renderer), so we suppress the expected
// `InAppWebViewPlatform.instance != null` assertion the same way
// `session_view_screen_test.dart` and `bridge_spike/keyboard_layout_test`
// do, and assert purely on the header text.
//
// Honors the known `_dyld_start` `flutter test` hang on this Mac: if the
// suite hangs at ~0% CPU it is the toolchain, not these tests.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:remote_dev/domain/session_summary.dart';
import 'package:remote_dev/infrastructure/api/sessions_api.dart';
import 'package:remote_dev/presentation/screens/sessions/sessions_tab_screen.dart'
    show sessionsApiProvider;
import 'package:remote_dev/presentation/screens/session_view/session_view_screen.dart';

class _MockSessionsApi extends Mock implements SessionsApi {}

// The id passed to the screen. The bug rendered THIS string in the header;
// every assertion below confirms it is never shown.
const _kSessionId = '5f3c1a2b-0000-4d4e-9aaa-deadbeefcafe';

SessionSummary _summary({
  String id = _kSessionId,
  String name = 'Build server',
}) {
  return SessionSummary(
    id: id,
    name: name,
    tmuxSessionName: 'rdv-$id',
    status: SessionStatus.active,
  );
}

Widget _wrap({
  required SessionsApi api,
  SessionSummary? initialSummary,
}) {
  return ProviderScope(
    overrides: [sessionsApiProvider.overrideWithValue(api)],
    child: MaterialApp(
      home: SessionViewScreen(
        sessionId: _kSessionId,
        initialSummary: initialSummary,
      ),
    ),
  );
}

/// Suppresses the expected InAppWebView platform assertion so the screen can
/// mount under the test renderer. Returns a teardown registrant.
void _suppressWebViewPlatformError(WidgetTester tester) {
  final original = FlutterError.onError;
  FlutterError.onError = (details) {
    if (details.exceptionAsString().contains('InAppWebViewPlatform')) {
      return;
    }
    original?.call(details);
  };
  addTearDown(() => FlutterError.onError = original);
}

void main() {
  setUpAll(() {
    registerFallbackValue(_summary());
  });

  testWidgets(
    'A: renders the name from initialSummary, never the id',
    (tester) async {
      _suppressWebViewPlatformError(tester);
      final api = _MockSessionsApi();
      // With a summary in hand the screen must NOT hit the list API.

      await tester.pumpWidget(
        _wrap(api: api, initialSummary: _summary(name: 'Build server')),
      );
      for (var i = 0; i < 5; i++) {
        await tester.pump(const Duration(milliseconds: 16));
      }

      expect(find.text('Build server'), findsOneWidget);
      expect(find.text(_kSessionId), findsNothing);
      // No summary → no resolution call needed.
      verifyNever(() => api.list());
    },
  );

  testWidgets(
    'B: resolves the name via list(); shows "Session" (never id) until then',
    (tester) async {
      _suppressWebViewPlatformError(tester);
      final api = _MockSessionsApi();
      // Delay the list so we can observe the pre-resolution header state.
      when(() => api.list()).thenAnswer(
        (_) => Future.delayed(
          const Duration(milliseconds: 200),
          () => [_summary(name: 'Build server')],
        ),
      );

      await tester.pumpWidget(_wrap(api: api));
      // A few frames in, resolution is still pending.
      for (var i = 0; i < 3; i++) {
        await tester.pump(const Duration(milliseconds: 16));
      }
      expect(
        find.text('Session'),
        findsOneWidget,
        reason: 'Header must show the neutral label before resolution.',
      );
      expect(
        find.text(_kSessionId),
        findsNothing,
        reason: 'The raw session id must NEVER be rendered.',
      );

      // Let the delayed list() complete and the setState flush.
      await tester.pump(const Duration(milliseconds: 200));
      await tester.pump();

      expect(find.text('Build server'), findsOneWidget);
      expect(find.text('Session'), findsNothing);
      expect(find.text(_kSessionId), findsNothing);
      verify(() => api.list()).called(1);
    },
  );

  testWidgets(
    'B2: list() failure leaves the neutral label, never the id',
    (tester) async {
      _suppressWebViewPlatformError(tester);
      final api = _MockSessionsApi();
      when(() => api.list()).thenThrow(Exception('unauthorized'));

      await tester.pumpWidget(_wrap(api: api));
      for (var i = 0; i < 5; i++) {
        await tester.pump(const Duration(milliseconds: 16));
      }

      expect(find.text('Session'), findsOneWidget);
      expect(find.text(_kSessionId), findsNothing);
    },
  );
}
