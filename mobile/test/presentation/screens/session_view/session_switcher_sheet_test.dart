import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:remote_dev/application/ports/host_workspace_store.dart';
import 'package:remote_dev/domain/host_config.dart';
import 'package:remote_dev/domain/session_summary.dart';
import 'package:remote_dev/domain/workspace_config.dart';
import 'package:remote_dev/infrastructure/api/sessions_api.dart';
import 'package:remote_dev/presentation/screens/session_view/session_switcher_sheet.dart';
import 'package:remote_dev/presentation/screens/webview_host/session_route_host.dart'
    show hostWorkspaceStoreProvider;

class _MockStore extends Mock implements HostWorkspaceStore {}

class _MockSessionsApi extends Mock implements SessionsApi {}

void main() {
  final now = DateTime(2026, 6, 5);

  HostConfig host(String id, String label) => HostConfig(
        id: id,
        label: label,
        origin: 'https://$label',
        kind: HostKind.singleWorkspace,
        createdAt: now,
        lastUsedAt: now,
      );

  WorkspaceConfig ws(String id, String hostId, String name) => WorkspaceConfig(
        id: id,
        hostId: hostId,
        slug: '',
        basePath: '',
        displayName: name,
        lastUsedAt: now,
      );

  SessionSummary sess(
    String id,
    String name, {
    AgentActivityStatus activity = AgentActivityStatus.idle,
  }) =>
      SessionSummary(
        id: id,
        name: name,
        tmuxSessionName: 'rdv-$id',
        status: SessionStatus.active,
        activity: activity,
      );

  late _MockStore store;
  late _MockSessionsApi apiA;
  late _MockSessionsApi apiB;

  setUp(() {
    store = _MockStore();
    apiA = _MockSessionsApi();
    apiB = _MockSessionsApi();
    final hostA = host('hA', 'serverA');
    final hostB = host('hB', 'serverB');
    final wsA = ws('wA', 'hA', 'Workspace A');
    final wsB = ws('wB', 'hB', 'Workspace B');
    when(store.loadHosts).thenAnswer((_) async => [hostA, hostB]);
    when(() => store.loadWorkspaces()).thenAnswer((_) async => [wsA, wsB]);
    when(store.loadActiveWorkspace).thenAnswer((_) async => wsA);
    when(() => store.loadHost('hA')).thenAnswer((_) async => hostA);
    when(() => store.loadHost('hB')).thenAnswer((_) async => hostB);
    when(apiA.list).thenAnswer(
      (_) async => [
        sess('s1', 'feature', activity: AgentActivityStatus.running),
        sess('s2', 'codex'),
      ],
    );
    when(apiB.list).thenAnswer((_) async => [sess('s3', 'remote-fix')]);
  });

  Widget harness({void Function(SessionSwitchTarget?)? onResult}) {
    return ProviderScope(
      overrides: [
        hostWorkspaceStoreProvider.overrideWithValue(store),
        switcherSessionsApiFactoryProvider.overrideWithValue(
          (h, w) => w.id == 'wA' ? apiA : apiB,
        ),
      ],
      child: MaterialApp(
        home: Scaffold(
          body: Builder(
            builder: (context) => Center(
              child: ElevatedButton(
                onPressed: () async {
                  final t = await showSessionSwitcher(
                    context,
                    currentSessionId: 's1',
                    currentWorkspaceId: 'wA',
                  );
                  onResult?.call(t);
                },
                child: const Text('open'),
              ),
            ),
          ),
        ),
      ),
    );
  }

  testWidgets('current workspace is expanded and marks the current session',
      (tester) async {
    await tester.pumpWidget(harness());
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();

    // Current workspace (A) expanded by default → its sessions visible.
    expect(find.text('feature'), findsOneWidget);
    expect(find.text('codex'), findsOneWidget);
    expect(find.text('current'), findsOneWidget); // s1 == currentSessionId
    // Workspace B collapsed → its body not rendered yet.
    expect(find.text('remote-fix'), findsNothing);
  });

  testWidgets('expanding another server reveals its sessions', (tester) async {
    await tester.pumpWidget(harness());
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Workspace B'));
    await tester.pumpAndSettle();

    expect(find.text('remote-fix'), findsOneWidget);
  });

  testWidgets('renders subagent activity pip in violet', (tester) async {
    when(apiA.list).thenAnswer(
      (_) async => [
        sess('s1', 'feature', activity: AgentActivityStatus.subagent),
      ],
    );

    await tester.pumpWidget(harness());
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();

    // Current workspace (A) is expanded → its subagent session pip is shown.
    final pipFinder = find.byWidgetPredicate((w) {
      if (w is! Container) return false;
      final dec = w.decoration;
      if (dec is! BoxDecoration) return false;
      return dec.shape == BoxShape.circle &&
          dec.color == const Color(0xFFBB9AF7);
    });
    expect(pipFinder, findsOneWidget);
  });

  testWidgets('renders compacting activity pip in blue', (tester) async {
    when(apiA.list).thenAnswer(
      (_) async => [
        sess('s1', 'feature', activity: AgentActivityStatus.compacting),
      ],
    );

    await tester.pumpWidget(harness());
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();

    // Current workspace (A) is expanded → its compacting session pip is shown.
    final pipFinder = find.byWidgetPredicate((w) {
      if (w is! Container) return false;
      final dec = w.decoration;
      if (dec is! BoxDecoration) return false;
      return dec.shape == BoxShape.circle &&
          dec.color == const Color(0xFF7AA2F7);
    });
    expect(pipFinder, findsOneWidget);
  });

  testWidgets('renders ended activity pip in idle grey', (tester) async {
    when(apiA.list).thenAnswer(
      (_) async => [
        sess('s1', 'feature', activity: AgentActivityStatus.ended),
      ],
    );

    await tester.pumpWidget(harness());
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();

    // Current workspace (A) is expanded → its ended session pip is shown.
    final pipFinder = find.byWidgetPredicate((w) {
      if (w is! Container) return false;
      final dec = w.decoration;
      if (dec is! BoxDecoration) return false;
      return dec.shape == BoxShape.circle &&
          dec.color == const Color(0xFF565F89);
    });
    expect(pipFinder, findsOneWidget);
  });

  testWidgets('tapping a session returns its switch target', (tester) async {
    SessionSwitchTarget? result;
    await tester.pumpWidget(harness(onResult: (t) => result = t));
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Workspace B'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('remote-fix'));
    await tester.pumpAndSettle();

    expect(result, isNotNull);
    expect(result!.session.id, 's3');
    expect(result!.workspace.id, 'wB');
    expect(result!.host.id, 'hB');
  });
}
