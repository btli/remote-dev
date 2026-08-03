import 'dart:async';

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
  const _StubAgentCli({
    this.installed = const [
      InstalledAgent(provider: 'claude', label: 'Claude Code'),
    ],
  });

  final List<InstalledAgent> installed;

  @override
  Future<List<InstalledAgent>> listInstalled() async => installed;
}

class _PendingRefreshAgentCli implements AgentCliPort {
  final refresh = Completer<List<InstalledAgent>>();
  var calls = 0;

  @override
  Future<List<InstalledAgent>> listInstalled() {
    calls += 1;
    return refresh.future;
  }
}

List<Override> _overrides(
  SessionsApi api, {
  List<InstalledAgent>? installedAgents,
  AgentCliPort? agentCli,
}) => [
      sessionsApiProvider.overrideWithValue(api),
      projectTreeApiProvider.overrideWithValue(_StubProjectTree()),
      agentCliApiProvider.overrideWithValue(
        agentCli ??
            _StubAgentCli(installed: installedAgents ?? const [
              InstalledAgent(provider: 'claude', label: 'Claude Code'),
            ]),
      ),
    ];

/// Helper: drives the project picker so the Create button enables.
Future<void> _pickProject(WidgetTester tester) async {
  await tester.tap(find.text('Pick a project'));
  await tester.pumpAndSettle();
  await tester.tap(find.text('remote-dev'));
  await tester.pumpAndSettle();
}

Finder _dropdownWithLabel(String label) => find.byWidgetPredicate(
      (widget) =>
          widget is DropdownButtonFormField<String> &&
          widget.decoration.labelText == label,
    );

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
    expect(find.text('New Cursor Agent'), findsOneWidget);
    expect(find.text('Create'), findsOneWidget);
  });

  testWidgets('Cursor quick start creates an auto-launched agent session',
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
        id: 'cursor-1',
        name: 'cursor-mobile',
        tmuxSessionName: 'rdv-cursor-1',
        status: SessionStatus.active,
      ),
    );

    await tester.pumpWidget(
      ProviderScope(
        overrides: _overrides(
          api,
          installedAgents: const [
            InstalledAgent(provider: 'claude', label: 'Claude Code'),
            InstalledAgent(provider: 'cursor', label: 'Cursor'),
          ],
        ),
        child: const MaterialApp(home: Scaffold(body: NewSessionSheet())),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('New Cursor Agent'));
    await tester.pumpAndSettle();
    expect(
      tester.state<FormFieldState<String>>(_dropdownWithLabel('Agent')).value,
      'cursor',
    );

    await tester.enterText(
      find.widgetWithText(TextFormField, 'Name'),
      'cursor-mobile',
    );
    await _pickProject(tester);
    await tester.tap(find.text('Create'));
    await tester.pumpAndSettle();

    verify(
      () => api.create(
        name: 'cursor-mobile',
        terminalType: 'agent',
        projectId: 'p1',
        initialCommand: null,
        agentProvider: 'cursor',
        autoLaunchAgent: true,
      ),
    ).called(1);
  });

  testWidgets('Cursor shortcut replaces an existing Claude selection',
      (tester) async {
    final api = _MockApi();
    await tester.pumpWidget(
      ProviderScope(
        overrides: _overrides(
          api,
          installedAgents: const [
            InstalledAgent(provider: 'claude', label: 'Claude Code'),
            InstalledAgent(provider: 'cursor', label: 'Cursor'),
          ],
        ),
        child: const MaterialApp(home: Scaffold(body: NewSessionSheet())),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(_dropdownWithLabel('Type'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Agent').last);
    await tester.pumpAndSettle();
    expect(
      tester.state<FormFieldState<String>>(_dropdownWithLabel('Agent')).value,
      'claude',
    );

    await tester.tap(find.text('New Cursor Agent'));
    await tester.pumpAndSettle();
    expect(
      tester.state<FormFieldState<String>>(_dropdownWithLabel('Agent')).value,
      'cursor',
    );
  });

  testWidgets('Cursor shortcut reports when the agent CLI is not installed',
      (tester) async {
    final api = _MockApi();
    await tester.pumpWidget(
      ProviderScope(
        overrides: _overrides(api, installedAgents: const []),
        child: const MaterialApp(home: Scaffold(body: NewSessionSheet())),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('New Cursor Agent'));
    await tester.pumpAndSettle();

    expect(
      find.text('Cursor Agent CLI is not installed on this server'),
      findsOneWidget,
    );
    expect(find.text('No agents installed'), findsOneWidget);
  });

  testWidgets('stale Cursor refresh cannot replace a newer agent choice',
      (tester) async {
    final api = _MockApi();
    final agentCli = _PendingRefreshAgentCli();
    await tester.pumpWidget(
      ProviderScope(
        overrides: _overrides(api, agentCli: agentCli),
        child: const MaterialApp(home: Scaffold(body: NewSessionSheet())),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('New Cursor Agent'));
    await tester.pump();
    expect(agentCli.calls, 1);
    await tester.tap(_dropdownWithLabel('Type'));
    await tester.pump(const Duration(seconds: 1));
    await tester.tap(find.text('Shell').last);
    await tester.pump();
    await tester.tap(_dropdownWithLabel('Type'));
    await tester.pump(const Duration(seconds: 1));
    await tester.tap(find.text('Agent').last);
    await tester.pump();

    agentCli.refresh.complete(const [
      InstalledAgent(provider: 'claude', label: 'Claude Code'),
      InstalledAgent(provider: 'cursor', label: 'Cursor'),
    ]);
    await tester.pumpAndSettle();

    expect(
      tester.state<FormFieldState<String>>(_dropdownWithLabel('Agent')).value,
      'claude',
    );
  });

  testWidgets('Cursor quick start is scrollable on a compact phone viewport',
      (tester) async {
    tester.view.physicalSize = const Size(390, 480);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(() {
      tester.view.resetPhysicalSize();
      tester.view.resetDevicePixelRatio();
    });

    final api = _MockApi();
    await tester.pumpWidget(
      ProviderScope(
        overrides: _overrides(
          api,
          installedAgents: const [
            InstalledAgent(provider: 'cursor', label: 'Cursor'),
          ],
        ),
        child: const MaterialApp(home: Scaffold(body: NewSessionSheet())),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('New Cursor Agent'));
    await tester.pumpAndSettle();

    expect(tester.takeException(), isNull);
    await tester.ensureVisible(find.text('Create'));
    await tester.pumpAndSettle();
    expect(find.text('Create').hitTestable(), findsOneWidget);
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
