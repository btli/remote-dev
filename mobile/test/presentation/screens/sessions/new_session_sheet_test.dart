import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:remote_dev/domain/session_summary.dart';
import 'package:remote_dev/infrastructure/api/sessions_api.dart';
import 'package:remote_dev/presentation/screens/sessions/new_session_sheet.dart';
import 'package:remote_dev/presentation/screens/sessions/sessions_tab_screen.dart';

class _MockApi extends Mock implements SessionsApi {}

void main() {
  setUpAll(() {
    registerFallbackValue(<String, dynamic>{});
  });

  testWidgets('renders form fields', (tester) async {
    final api = _MockApi();
    await tester.pumpWidget(
      ProviderScope(
        overrides: [sessionsApiProvider.overrideWithValue(api)],
        child: const MaterialApp(home: Scaffold(body: NewSessionSheet())),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('New session'), findsOneWidget);
    expect(find.text('Name'), findsOneWidget);
    expect(find.text('Create'), findsOneWidget);
  });

  testWidgets('Create button validates Name is required', (tester) async {
    final api = _MockApi();
    await tester.pumpWidget(
      ProviderScope(
        overrides: [sessionsApiProvider.overrideWithValue(api)],
        child: const MaterialApp(home: Scaffold(body: NewSessionSheet())),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('Create'));
    await tester.pumpAndSettle();
    expect(find.text('Required'), findsOneWidget);
    verifyNever(
      () => api.create(
        name: any(named: 'name'),
        terminalType: any(named: 'terminalType'),
        projectId: any(named: 'projectId'),
        initialCommand: any(named: 'initialCommand'),
      ),
    );
  });

  testWidgets('Create posts to API and pops with the new session',
      (tester) async {
    final api = _MockApi();
    when(
      () => api.create(
        name: any(named: 'name'),
        terminalType: any(named: 'terminalType'),
        projectId: any(named: 'projectId'),
        initialCommand: any(named: 'initialCommand'),
      ),
    ).thenAnswer(
      (_) async => const SessionSummary(
        id: 'new-1',
        name: 'feat/x',
        tmuxSessionName: 'rdv-new-1',
        status: SessionStatus.active,
      ),
    );

    SessionSummary? popped;
    await tester.pumpWidget(
      ProviderScope(
        overrides: [sessionsApiProvider.overrideWithValue(api)],
        child: MaterialApp(
          home: Builder(
            builder: (context) => Scaffold(
              body: ElevatedButton(
                onPressed: () async {
                  popped = await showNewSessionSheet(context);
                },
                child: const Text('open'),
              ),
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.widgetWithText(TextFormField, 'Name'),
      'feat/x',
    );
    await tester.tap(find.text('Create'));
    await tester.pumpAndSettle();
    expect(popped?.id, 'new-1');
  });
}
