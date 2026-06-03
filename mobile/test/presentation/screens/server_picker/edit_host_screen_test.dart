import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:remote_dev/application/ports/secure_storage_port.dart';
import 'package:remote_dev/domain/host_config.dart';
import 'package:remote_dev/domain/workspace_config.dart';
import 'package:remote_dev/infrastructure/storage/host_workspace_store_impl.dart';
import 'package:remote_dev/presentation/screens/server_picker/edit_host_screen.dart';
import 'package:remote_dev/presentation/screens/webview_host/session_route_host.dart'
    show hostWorkspaceStoreProvider, secureStorageProvider;

/// Map-backed [SecureStoragePort] mirroring the production key layout so the
/// real [HostWorkspaceStoreImpl] persists against an in-memory store (the D2
/// test convention — no platform channel, no mocked store).
class _FakeStorage implements SecureStoragePort {
  final Map<String, String?> data = <String, String?>{};

  String _key(String ns, String key) => 'server.$ns.$key';

  @override
  Future<String?> read(String ns, String key) async => data[_key(ns, key)];

  @override
  Future<void> write(String ns, String key, String value) async {
    data[_key(ns, key)] = value;
  }

  @override
  Future<void> delete(String ns, String key) async {
    data.remove(_key(ns, key));
  }

  @override
  Future<void> deleteAll(String ns) async {
    data.removeWhere((k, _) => k.startsWith('server.$ns.'));
  }
}

void main() {
  final host = HostConfig(
    id: 'h1',
    label: 'Work',
    origin: 'https://dev.example.com',
    kind: HostKind.singleWorkspace,
    createdAt: DateTime(2026, 5, 1),
    lastUsedAt: DateTime(2026, 5, 1),
  );

  final workspace = WorkspaceConfig(
    id: 'w1',
    hostId: 'h1',
    slug: '',
    basePath: '',
    displayName: 'Work',
    status: null,
    lastUsedAt: DateTime(2026, 5, 1),
  );

  Future<HostWorkspaceStoreImpl> pump(
    WidgetTester tester, {
    required EditHostArgs args,
    VoidCallback? onSaved,
  }) async {
    final storage = _FakeStorage();
    final store = HostWorkspaceStoreImpl(storage);
    // Seed the host + workspace so upsert is a true update.
    await store.upsertHost(host);
    await store.upsertWorkspace(workspace);

    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          secureStorageProvider.overrideWith((_) => throw UnimplementedError()),
          hostWorkspaceStoreProvider.overrideWithValue(store),
        ],
        child: MaterialApp(
          home: EditHostScreen(args: args, onSaved: onSaved ?? () {}),
        ),
      ),
    );
    await tester.pumpAndSettle();
    return store;
  }

  testWidgets('pre-fills host label and workspace name', (tester) async {
    await pump(tester, args: EditHostArgs(host: host, workspace: workspace));

    // Both fields pre-filled with 'Work'.
    expect(find.widgetWithText(TextFormField, 'Host label'), findsOneWidget);
    expect(
      find.widgetWithText(TextFormField, 'Workspace name'),
      findsOneWidget,
    );
    expect(find.text('Work'), findsNWidgets(2));
    // Origin shown read-only.
    expect(find.text('https://dev.example.com'), findsOneWidget);
  });

  testWidgets(
    'save persists renamed host label + workspace display name, preserving ids',
    (tester) async {
      var savedCalled = false;
      final store = await pump(
        tester,
        args: EditHostArgs(host: host, workspace: workspace),
        onSaved: () => savedCalled = true,
      );

      await tester.enterText(
        find.widgetWithText(TextFormField, 'Host label'),
        'Work (renamed)',
      );
      await tester.enterText(
        find.widgetWithText(TextFormField, 'Workspace name'),
        'Primary',
      );
      await tester.tap(find.widgetWithText(ElevatedButton, 'Save'));
      await tester.pumpAndSettle();

      final hosts = await store.loadHosts();
      expect(hosts.single.id, 'h1');
      expect(hosts.single.label, 'Work (renamed)');
      expect(hosts.single.origin, 'https://dev.example.com');
      expect(hosts.single.lastUsedAt.isAfter(host.lastUsedAt), isTrue);

      final workspaces = await store.loadWorkspaces();
      expect(workspaces.single.id, 'w1');
      expect(workspaces.single.displayName, 'Primary');
      expect(workspaces.single.basePath, '');

      expect(savedCalled, isTrue);
    },
  );

  testWidgets(
    'host-only edit (no workspace) hides the workspace field',
    (tester) async {
      final store = await pump(tester, args: EditHostArgs(host: host));

      expect(find.widgetWithText(TextFormField, 'Host label'), findsOneWidget);
      expect(
        find.widgetWithText(TextFormField, 'Workspace name'),
        findsNothing,
      );

      await tester.enterText(
        find.widgetWithText(TextFormField, 'Host label'),
        'Renamed host',
      );
      await tester.tap(find.widgetWithText(ElevatedButton, 'Save'));
      await tester.pumpAndSettle();

      final hosts = await store.loadHosts();
      expect(hosts.single.label, 'Renamed host');
      // Workspace untouched.
      final workspaces = await store.loadWorkspaces();
      expect(workspaces.single.displayName, 'Work');
    },
  );

  testWidgets('empty host label keeps form open and does not persist',
      (tester) async {
    final store = await pump(
      tester,
      args: EditHostArgs(host: host, workspace: workspace),
    );

    await tester.enterText(
      find.widgetWithText(TextFormField, 'Host label'),
      '',
    );
    await tester.tap(find.widgetWithText(ElevatedButton, 'Save'));
    await tester.pumpAndSettle();

    expect(find.text('Required'), findsOneWidget);
    // Label unchanged in the store.
    final hosts = await store.loadHosts();
    expect(hosts.single.label, 'Work');
  });
}
