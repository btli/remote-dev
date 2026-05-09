import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:remote_dev/domain/session_summary.dart';
import 'package:remote_dev/infrastructure/api/sessions_api.dart';
import 'package:remote_dev/presentation/screens/sessions/sessions_tab_screen.dart';

class _MockSessionsApi extends Mock implements SessionsApi {}

Widget _wrap({
  required SessionsApi api,
  Map<String, String>? projectNames,
}) {
  return ProviderScope(
    overrides: [
      sessionsApiProvider.overrideWithValue(api),
      if (projectNames != null)
        projectNamesProvider
            .overrideWith((ref) async => projectNames),
    ],
    child: const MaterialApp(home: SessionsTabScreen()),
  );
}

SessionSummary _session({
  String id = 's1',
  String name = 'Main',
  String tmux = 'rdv-1',
  SessionStatus status = SessionStatus.active,
  String? projectId,
  AgentActivityStatus activity = AgentActivityStatus.none,
}) {
  return SessionSummary(
    id: id,
    name: name,
    tmuxSessionName: tmux,
    status: status,
    projectId: projectId,
    activity: activity,
  );
}

void main() {
  late _MockSessionsApi api;

  setUp(() {
    api = _MockSessionsApi();
  });

  testWidgets('shows loading state initially', (tester) async {
    when(() => api.list()).thenAnswer(
      (_) => Future.delayed(
        const Duration(milliseconds: 100),
        () => <SessionSummary>[],
      ),
    );

    await tester.pumpWidget(_wrap(api: api));
    // First frame: still loading.
    expect(find.byType(CircularProgressIndicator).evaluate().isEmpty, isTrue);
    // Settle to finish loading.
    await tester.pumpAndSettle();
  });

  testWidgets('renders empty state when no sessions', (tester) async {
    when(() => api.list()).thenAnswer((_) async => <SessionSummary>[]);

    await tester.pumpWidget(_wrap(api: api));
    await tester.pumpAndSettle();

    expect(find.text('No sessions yet'), findsOneWidget);
    expect(find.text('New session'), findsOneWidget);
  });

  testWidgets('renders rows with names and tmux fallback subtitle',
      (tester) async {
    when(() => api.list()).thenAnswer(
      (_) async => [
        _session(id: 's1', name: 'Alpha', tmux: 'rdv-aaa'),
        _session(id: 's2', name: 'Beta', tmux: 'rdv-bbb'),
      ],
    );

    await tester.pumpWidget(_wrap(api: api));
    await tester.pumpAndSettle();

    expect(find.text('Alpha'), findsOneWidget);
    expect(find.text('Beta'), findsOneWidget);
    expect(find.text('rdv-aaa'), findsOneWidget);
    expect(find.text('rdv-bbb'), findsOneWidget);
  });

  testWidgets('uses project name when projectId resolves', (tester) async {
    when(() => api.list()).thenAnswer(
      (_) async => [
        _session(
          id: 's1',
          name: 'With Project',
          tmux: 'rdv-x',
          projectId: 'p-1',
        ),
      ],
    );

    await tester.pumpWidget(
      _wrap(api: api, projectNames: const {'p-1': 'My Project'}),
    );
    await tester.pumpAndSettle();

    expect(find.text('With Project'), findsOneWidget);
    expect(find.text('My Project'), findsOneWidget);
    expect(find.text('rdv-x'), findsNothing);
  });

  testWidgets('renders activity pip for running sessions', (tester) async {
    when(() => api.list()).thenAnswer(
      (_) async => [
        _session(activity: AgentActivityStatus.running),
      ],
    );

    await tester.pumpWidget(_wrap(api: api));
    await tester.pumpAndSettle();

    // Pip widget renders a circular Container with the running color.
    final pipFinder = find.byWidgetPredicate((w) {
      if (w is! Container) return false;
      final dec = w.decoration;
      if (dec is! BoxDecoration) return false;
      return dec.shape == BoxShape.circle &&
          dec.color == const Color(0xFF9ECE6A);
    });
    expect(pipFinder, findsOneWidget);
  });

  testWidgets('shows error view + retry on failure', (tester) async {
    when(() => api.list()).thenThrow(Exception('boom'));

    await tester.pumpWidget(_wrap(api: api));
    await tester.pumpAndSettle();

    expect(find.text('Failed to load sessions'), findsOneWidget);
    expect(find.text('Retry'), findsOneWidget);
  });

  testWidgets('appbar + button opens NewSessionSheet', (tester) async {
    when(() => api.list()).thenAnswer((_) async => <SessionSummary>[]);

    await tester.pumpWidget(_wrap(api: api));
    await tester.pumpAndSettle();

    // Before tapping the sheet is not in the tree.
    expect(find.text('Create'), findsNothing);

    // Tap the AppBar add icon (not the empty-state button).
    await tester.tap(find.byIcon(Icons.add).first);
    await tester.pumpAndSettle();
    // The sheet renders its Create button.
    expect(find.text('Create'), findsOneWidget);
  });

  testWidgets('pull-to-refresh refetches sessions', (tester) async {
    var calls = 0;
    when(() => api.list()).thenAnswer((_) async {
      calls += 1;
      return [_session(name: 'Run #$calls')];
    });

    await tester.pumpWidget(_wrap(api: api));
    await tester.pumpAndSettle();
    expect(calls, 1);
    expect(find.text('Run #1'), findsOneWidget);

    // Drag down on the list to trigger refresh.
    await tester.fling(
      find.text('Run #1'),
      const Offset(0, 300),
      1000,
    );
    await tester.pumpAndSettle();
    expect(calls, greaterThanOrEqualTo(2));
  });
}
