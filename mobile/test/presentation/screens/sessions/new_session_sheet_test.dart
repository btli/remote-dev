import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:remote_dev/application/ports/agent_cli_port.dart';
import 'package:remote_dev/application/ports/project_tree_port.dart';
import 'package:remote_dev/domain/group.dart';
import 'package:remote_dev/domain/project.dart';
import 'package:remote_dev/domain/session_summary.dart';
import 'package:remote_dev/infrastructure/api/sessions_api.dart';
import 'package:remote_dev/presentation/screens/sessions/new_session_sheet.dart';
import 'package:remote_dev/presentation/screens/sessions/project_tree_sheet.dart';
import 'package:remote_dev/presentation/screens/sessions/sessions_tab_screen.dart';

class _MockApi extends Mock implements SessionsApi {}

class _StubProjectTree implements ProjectTreePort {
  @override
  Future<List<Group>> listGroups() async => const [
        Group(id: 'g1', name: 'Work', sortOrder: 0),
      ];

  @override
  Future<List<Project>> listProjects() async => const [
        Project(id: 'p1', name: 'remote-dev', groupId: 'g1'),
      ];
}

class _StubAgentCli implements AgentCliPort {
  @override
  Future<List<InstalledAgent>> listInstalled() async => const [
        InstalledAgent(provider: 'claude', label: 'Claude Code'),
      ];
}

List<Override> _overrides(SessionsApi api) => [
      sessionsApiProvider.overrideWithValue(api),
      projectTreeApiProvider.overrideWithValue(_StubProjectTree()),
      agentCliApiProvider.overrideWithValue(_StubAgentCli()),
    ];

/// Helper: drives the project picker so the Create button enables.
Future<void> _pickProject(WidgetTester tester) async {
  await tester.tap(find.text('Pick a project'));
  await tester.pumpAndSettle();
  await tester.tap(find.text('remote-dev'));
  await tester.pumpAndSettle();
}

void main() {
  setUpAll(() {
    registerFallbackValue(<String, dynamic>{});
  });

  testWidgets('renders form fields', (tester) async {
    final api = _MockApi();
    await tester.pumpWidget(
      ProviderScope(
        overrides: _overrides(api),
        child: const MaterialApp(home: Scaffold(body: NewSessionSheet())),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('New session'), findsOneWidget);
    expect(find.text('Name'), findsOneWidget);
    expect(find.text('Create'), findsOneWidget);
  });

  testWidgets('Create button is disabled until a project is picked',
      (tester) async {
    final api = _MockApi();
    await tester.pumpWidget(
      ProviderScope(
        overrides: _overrides(api),
        child: const MaterialApp(home: Scaffold(body: NewSessionSheet())),
      ),
    );
    await tester.pumpAndSettle();

    final ElevatedButton btn = tester.widget(find.byType(ElevatedButton));
    expect(btn.onPressed, isNull);

    verifyNever(
      () => api.create(
        name: any(named: 'name'),
        terminalType: any(named: 'terminalType'),
        projectId: any(named: 'projectId'),
        initialCommand: any(named: 'initialCommand'),
        agentProvider: any(named: 'agentProvider'),
        autoLaunchAgent: any(named: 'autoLaunchAgent'),
      ),
    );
  });

  testWidgets('Create button validates Name is required once project is picked',
      (tester) async {
    final api = _MockApi();
    await tester.pumpWidget(
      ProviderScope(
        overrides: _overrides(api),
        child: const MaterialApp(home: Scaffold(body: NewSessionSheet())),
      ),
    );
    await tester.pumpAndSettle();

    await _pickProject(tester);

    await tester.tap(find.text('Create'));
    await tester.pumpAndSettle();
    expect(find.text('Required'), findsOneWidget);
    verifyNever(
      () => api.create(
        name: any(named: 'name'),
        terminalType: any(named: 'terminalType'),
        projectId: any(named: 'projectId'),
        initialCommand: any(named: 'initialCommand'),
        agentProvider: any(named: 'agentProvider'),
        autoLaunchAgent: any(named: 'autoLaunchAgent'),
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
        agentProvider: any(named: 'agentProvider'),
        autoLaunchAgent: any(named: 'autoLaunchAgent'),
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
        overrides: _overrides(api),
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
    await _pickProject(tester);
    // The picker bottom-sheet pops the modal but the new-session sheet
    // itself remains; the Create button now has the project label.
    expect(find.text('remote-dev'), findsOneWidget);
    await tester.tap(find.text('Create'));
    await tester.pumpAndSettle();
    expect(popped?.id, 'new-1');
  });
}
