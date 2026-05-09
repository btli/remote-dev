import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:remote_dev/domain/session_summary.dart';
import 'package:remote_dev/infrastructure/api/sessions_api.dart';
import 'package:remote_dev/presentation/screens/sessions/sessions_tab_screen.dart';
import 'package:remote_dev/presentation/screens/shell/home_shell.dart';

class _FakeSessionsApi extends Fake implements SessionsApi {
  _FakeSessionsApi(this._sessions);
  final List<SessionSummary> _sessions;

  @override
  Future<List<SessionSummary>> list() async => _sessions;

  @override
  Future<void> suspend(String id) async {}

  @override
  Future<void> close(String id) async {}
}

void main() {
  Widget wrap(Widget child, {List<SessionSummary>? sessions}) => ProviderScope(
        overrides: [
          sessionsApiProvider.overrideWithValue(
            _FakeSessionsApi(sessions ?? const []),
          ),
        ],
        child: MaterialApp(home: child),
      );

  testWidgets('renders 4 tab labels', (tester) async {
    await tester.pumpWidget(wrap(const HomeShell()));
    await tester.pumpAndSettle();
    expect(find.text('Sessions'), findsWidgets);
    expect(find.text('Channels'), findsOneWidget);
    expect(find.text('Notifications'), findsOneWidget);
    expect(find.text('Profile'), findsOneWidget);
  });

  testWidgets('initial body is sessions tab (empty state)', (tester) async {
    await tester.pumpWidget(wrap(const HomeShell()));
    await tester.pumpAndSettle();
    expect(find.text('No sessions yet'), findsOneWidget);
  });

  testWidgets('tap Channels switches body', (tester) async {
    await tester.pumpWidget(wrap(const HomeShell()));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Channels'));
    await tester.pumpAndSettle();
    expect(find.textContaining('Channels — coming in Phase 4'), findsOneWidget);
  });

  testWidgets('tap Notifications switches body', (tester) async {
    await tester.pumpWidget(wrap(const HomeShell()));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Notifications'));
    await tester.pumpAndSettle();
    expect(
      find.textContaining('Notifications — coming in Phase 4'),
      findsOneWidget,
    );
  });

  testWidgets('tap Profile switches body', (tester) async {
    await tester.pumpWidget(wrap(const HomeShell()));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Profile'));
    await tester.pumpAndSettle();
    expect(find.textContaining('Profile — coming in Phase 4'), findsOneWidget);
  });
}
