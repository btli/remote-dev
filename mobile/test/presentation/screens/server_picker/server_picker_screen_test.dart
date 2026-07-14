import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:remote_dev/application/ports/secure_storage_port.dart';
import 'package:remote_dev/domain/host_config.dart';
import 'package:remote_dev/domain/workspace_config.dart';
import 'package:remote_dev/infrastructure/auth/mobile_credentials.dart';
import 'package:remote_dev/infrastructure/storage/host_workspace_store_impl.dart';
import 'package:remote_dev/presentation/screens/server_picker/server_picker_screen.dart';
import 'package:remote_dev/presentation/screens/webview_host/session_route_host.dart'
    show
        activeWorkspaceProvider,
        hostWorkspaceStoreProvider,
        secureStorageProvider;

/// Map-backed [SecureStoragePort] mirroring the production key layout
/// (`server.<namespace>.<key>`) so the real [HostWorkspaceStoreImpl] +
/// [MobileCredentialsStore] resolve the `__meta__` / `host.<id>` /
/// `workspace.<id>` namespaces exactly as in production. This is the D2 test
/// convention: drive the REAL store over a fake storage, mock only navigation.
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

HostConfig _host({
  String id = 'h1',
  String label = 'Work',
  String origin = 'https://dev.example.com',
  HostKind kind = HostKind.singleWorkspace,
}) {
  return HostConfig(
    id: id,
    label: label,
    origin: origin,
    kind: kind,
    createdAt: DateTime(2026, 5, 1),
    lastUsedAt: DateTime(2026, 5, 1),
  );
}

WorkspaceConfig _ws({
  required String id,
  required String hostId,
  String slug = '',
  String basePath = '',
  String displayName = 'Work',
  String? status,
  DateTime? lastUsedAt,
}) {
  return WorkspaceConfig(
    id: id,
    hostId: hostId,
    slug: slug,
    basePath: basePath,
    displayName: displayName,
    status: status,
    lastUsedAt: lastUsedAt ?? DateTime(2026, 5, 1),
  );
}

/// Pumps the picker inside a real GoRouter (`/servers` → picker, `/home` →
/// stub) wired exactly like the production route: select sets the active
/// workspace via the store, invalidates [activeWorkspaceProvider], and
/// navigates `/home`.
Future<void> _pumpPicker(
  WidgetTester tester,
  HostWorkspaceStoreImpl store,
) async {
  final router = GoRouter(
    initialLocation: '/servers',
    routes: [
      GoRoute(
        path: '/servers',
        builder: (context, state) => Consumer(
          builder: (context, ref, _) => ServerPickerScreen(
            onSelectWorkspace: (workspace) async {
              await ref
                  .read(hostWorkspaceStoreProvider)
                  .setActiveWorkspace(workspace.id);
              ref.invalidate(activeWorkspaceProvider);
              ref.invalidate(serverPickerDataProvider);
              if (context.mounted) context.go('/home');
            },
            onAddHost: () {},
          ),
        ),
      ),
      GoRoute(
        path: '/home',
        builder: (_, __) => const Scaffold(
          body: Center(child: Text('HOME')),
        ),
      ),
    ],
  );

  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        secureStorageProvider.overrideWith((_) => throw UnimplementedError()),
        hostWorkspaceStoreProvider.overrideWithValue(store),
      ],
      child: MaterialApp.router(routerConfig: router),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  group('HostEntry.isSingleWorkspaceRow (single-instance routing decision)', () {
    test('singleWorkspace host with one empty-slug workspace → direct row', () {
      final entry = HostEntry(
        host: _host(kind: HostKind.singleWorkspace),
        workspaces: [_ws(id: 'w1', hostId: 'h1')],
      );
      expect(entry.isSingleWorkspaceRow, isTrue);
    });

    test(
      'singleWorkspace host with a NON-empty-slug workspace is STILL a direct '
      'row (kind is authoritative — opens /home, never the supervisor picker)',
      () {
        final entry = HostEntry(
          host: _host(kind: HostKind.singleWorkspace),
          workspaces: [_ws(id: 'w1', hostId: 'h1', slug: 'demo')],
        );
        expect(entry.isSingleWorkspaceRow, isTrue);
      },
    );

    test('multiWorkspace host with one empty-slug workspace → NOT a direct row',
        () {
      final entry = HostEntry(
        host: _host(kind: HostKind.multiWorkspace),
        workspaces: [_ws(id: 'w1', hostId: 'h1')],
      );
      expect(entry.isSingleWorkspaceRow, isFalse);
    });

    test('multiWorkspace host with several workspaces → NOT a direct row', () {
      final entry = HostEntry(
        host: _host(kind: HostKind.multiWorkspace),
        workspaces: [
          _ws(id: 'w1', hostId: 'h1', slug: 'demo'),
          _ws(id: 'w2', hostId: 'h1', slug: 'staging'),
        ],
      );
      expect(entry.isSingleWorkspaceRow, isFalse);
    });
  });

  testWidgets(
    'single-instance host with a non-empty slug opens DIRECTLY (/home) on tap '
    'and shows no "Open another workspace" affordance',
    (tester) async {
      final storage = _FakeStorage();
      final store = HostWorkspaceStoreImpl(storage);
      // A plain single instance whose sole workspace happens to carry a slug.
      await store.upsertHost(_host(id: 'h1', kind: HostKind.singleWorkspace));
      await store.upsertWorkspace(
        _ws(id: 'w1', hostId: 'h1', slug: 'demo', displayName: 'My Work'),
      );
      await store.setActiveWorkspace('w1');

      var openAnotherCalls = 0;
      final router = GoRouter(
        initialLocation: '/servers',
        routes: [
          GoRoute(
            path: '/servers',
            builder: (context, state) => Consumer(
              builder: (context, ref, _) => ServerPickerScreen(
                onSelectWorkspace: (ws) async {
                  await ref
                      .read(hostWorkspaceStoreProvider)
                      .setActiveWorkspace(ws.id);
                  ref.invalidate(activeWorkspaceProvider);
                  ref.invalidate(serverPickerDataProvider);
                  if (context.mounted) context.go('/home');
                },
                onAddHost: () {},
                onOpenAnotherWorkspace: (_) => openAnotherCalls += 1,
              ),
            ),
          ),
          GoRoute(
            path: '/home',
            builder: (_, __) =>
                const Scaffold(body: Center(child: Text('HOME'))),
          ),
        ],
      );

      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            secureStorageProvider
                .overrideWith((_) => throw UnimplementedError()),
            hostWorkspaceStoreProvider.overrideWithValue(store),
          ],
          child: MaterialApp.router(routerConfig: router),
        ),
      );
      await tester.pumpAndSettle();

      // Rendered as a direct single row (workspace name), not a supervisor
      // header with the "Open another workspace" picker button.
      expect(find.text('My Work'), findsOneWidget);
      expect(find.byTooltip('Open another workspace'), findsNothing);

      // Tapping opens the session directly (/home), not the workspace picker.
      await tester.tap(find.text('My Work'));
      await tester.pumpAndSettle();
      expect(find.text('HOME'), findsOneWidget);
      expect(openAnotherCalls, 0);
    },
  );

  testWidgets('empty state shows add CTA', (tester) async {
    final store = HostWorkspaceStoreImpl(_FakeStorage());

    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          secureStorageProvider
              .overrideWith((_) => throw UnimplementedError()),
          hostWorkspaceStoreProvider.overrideWithValue(store),
        ],
        child: MaterialApp(
          home: ServerPickerScreen(
            onSelectWorkspace: (_) {},
            onAddHost: () {},
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('No servers yet.'), findsOneWidget);
    expect(find.text('Add a server'), findsOneWidget);
  });

  testWidgets(
    'lists a single-workspace host as one row labelled by workspace name',
    (tester) async {
      final storage = _FakeStorage();
      final store = HostWorkspaceStoreImpl(storage);
      await store.upsertHost(_host());
      await store.upsertWorkspace(
        _ws(id: 'w1', hostId: 'h1', displayName: 'My Work'),
      );
      await store.setActiveWorkspace('w1');

      await _pumpPicker(tester, store);

      expect(find.text('My Work'), findsOneWidget);
      expect(find.text('https://dev.example.com'), findsOneWidget);
      // Active marker present.
      expect(find.byIcon(Icons.check_circle), findsOneWidget);
    },
  );

  testWidgets(
    'multi-workspace host renders a header plus its workspaces',
    (tester) async {
      final storage = _FakeStorage();
      final store = HostWorkspaceStoreImpl(storage);
      await store.upsertHost(
        _host(id: 'h2', label: 'Cluster', kind: HostKind.multiWorkspace),
      );
      await store.upsertWorkspace(
        _ws(
          id: 'w_demo',
          hostId: 'h2',
          slug: 'demo',
          basePath: '/demo',
          displayName: 'Demo',
          status: 'ready',
          lastUsedAt: DateTime(2026, 5, 2),
        ),
      );
      await store.upsertWorkspace(
        _ws(
          id: 'w_staging',
          hostId: 'h2',
          slug: 'staging',
          basePath: '/staging',
          displayName: 'Staging',
          status: 'ready',
          lastUsedAt: DateTime(2026, 5, 3),
        ),
      );
      await store.setActiveWorkspace('w_demo');

      await _pumpPicker(tester, store);

      // Host header label + both workspaces visible.
      expect(find.text('Cluster'), findsOneWidget);
      expect(find.text('Demo'), findsOneWidget);
      expect(find.text('Staging'), findsOneWidget);
      // Demo is active.
      expect(find.byIcon(Icons.check_circle), findsOneWidget);
    },
  );

  testWidgets(
    'selecting workspace B when A is active makes B active and lands /home',
    (tester) async {
      final storage = _FakeStorage();
      final store = HostWorkspaceStoreImpl(storage);
      // Two distinct single-workspace hosts (two connections).
      await store.upsertHost(_host(id: 'hA', label: 'Alpha', origin: 'https://a.example.com'));
      await store.upsertHost(_host(id: 'hB', label: 'Beta', origin: 'https://b.example.com'));
      await store.upsertWorkspace(
        _ws(id: 'wA', hostId: 'hA', displayName: 'Alpha'),
      );
      await store.upsertWorkspace(
        _ws(id: 'wB', hostId: 'hB', displayName: 'Beta'),
      );
      await store.setActiveWorkspace('wA');

      await _pumpPicker(tester, store);

      // Precondition: A is active.
      expect((await store.loadActiveWorkspace())!.id, 'wA');

      // Tap connection B.
      await tester.tap(find.text('Beta'));
      await tester.pumpAndSettle();

      // The NEW active pointer is now B — this is the switching-works proof.
      expect((await store.loadActiveWorkspace())!.id, 'wB');
      // And we navigated to /home.
      expect(find.text('HOME'), findsOneWidget);
    },
  );

  testWidgets(
    'long-press a single-workspace row → Delete removes the host (cascade) '
    'and re-points the active pointer',
    (tester) async {
      final storage = _FakeStorage();
      final store = HostWorkspaceStoreImpl(storage);
      await store.upsertHost(_host(id: 'hA', label: 'Alpha', origin: 'https://a.example.com'));
      await store.upsertHost(_host(id: 'hB', label: 'Beta', origin: 'https://b.example.com'));
      await store.upsertWorkspace(
        _ws(id: 'wA', hostId: 'hA', displayName: 'Alpha'),
      );
      await store.upsertWorkspace(
        _ws(id: 'wB', hostId: 'hB', displayName: 'Beta'),
      );
      await store.setActiveWorkspace('wA');
      // Seed a credential under host A so we can prove the cascade clears it.
      await MobileCredentialsStore(storage).setHostCfToken('hA', 'tokA');

      await _pumpPicker(tester, store);

      await tester.longPress(find.text('Alpha'));
      await tester.pumpAndSettle();
      expect(find.text('Edit'), findsOneWidget);
      await tester.tap(find.text('Delete'));
      await tester.pumpAndSettle();

      // Host A + its workspace gone; only B remains.
      final hosts = await store.loadHosts();
      expect(hosts.map((h) => h.id), ['hB']);
      final workspaces = await store.loadWorkspaces();
      expect(workspaces.map((w) => w.id), ['wB']);
      // Cascade cleared host A's credential.
      expect(
        await MobileCredentialsStore(storage).getHostCfToken('hA'),
        isNull,
      );
      // Active pointer re-pointed to the surviving workspace.
      expect((await store.loadActiveWorkspace())!.id, 'wB');
    },
  );

  testWidgets(
    'deleting the only connection clears the active pointer',
    (tester) async {
      final storage = _FakeStorage();
      final store = HostWorkspaceStoreImpl(storage);
      await store.upsertHost(_host(id: 'hA', label: 'Alpha'));
      await store.upsertWorkspace(
        _ws(id: 'wA', hostId: 'hA', displayName: 'Alpha'),
      );
      await store.setActiveWorkspace('wA');

      await _pumpPicker(tester, store);

      await tester.longPress(find.text('Alpha'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Delete'));
      await tester.pumpAndSettle();

      expect(await store.loadHosts(), isEmpty);
      expect(await store.loadActiveWorkspace(), isNull);
      // Picker falls back to the empty state.
      expect(find.text('No servers yet.'), findsOneWidget);
    },
  );

  testWidgets(
    'long-press a workspace under a multi host → Delete removes just that '
    'workspace and re-points active to the sibling',
    (tester) async {
      final storage = _FakeStorage();
      final store = HostWorkspaceStoreImpl(storage);
      await store.upsertHost(
        _host(id: 'h2', label: 'Cluster', kind: HostKind.multiWorkspace),
      );
      await store.upsertWorkspace(
        _ws(
          id: 'w_demo',
          hostId: 'h2',
          slug: 'demo',
          basePath: '/demo',
          displayName: 'Demo',
          status: 'ready',
          lastUsedAt: DateTime(2026, 5, 3),
        ),
      );
      await store.upsertWorkspace(
        _ws(
          id: 'w_staging',
          hostId: 'h2',
          slug: 'staging',
          basePath: '/staging',
          displayName: 'Staging',
          status: 'ready',
          lastUsedAt: DateTime(2026, 5, 2),
        ),
      );
      await store.setActiveWorkspace('w_demo');

      await _pumpPicker(tester, store);

      await tester.longPress(find.text('Demo'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Delete'));
      await tester.pumpAndSettle();

      // Only the staging workspace remains; the host survives.
      final workspaces = await store.loadWorkspaces();
      expect(workspaces.map((w) => w.id), ['w_staging']);
      expect((await store.loadHosts()).single.id, 'h2');
      // Active re-pointed to the surviving sibling.
      expect((await store.loadActiveWorkspace())!.id, 'w_staging');
    },
  );

  testWidgets('long-press opens action sheet with Edit/Delete', (tester) async {
    final storage = _FakeStorage();
    final store = HostWorkspaceStoreImpl(storage);
    await store.upsertHost(_host());
    await store.upsertWorkspace(_ws(id: 'w1', hostId: 'h1', displayName: 'Work'));
    await store.setActiveWorkspace('w1');

    HostConfig? editedHost;
    WorkspaceConfig? editedSoleWs;
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          secureStorageProvider
              .overrideWith((_) => throw UnimplementedError()),
          hostWorkspaceStoreProvider.overrideWithValue(store),
        ],
        child: MaterialApp(
          home: ServerPickerScreen(
            onSelectWorkspace: (_) {},
            onAddHost: () {},
            onEditHost: (host, soleWs) {
              editedHost = host;
              editedSoleWs = soleWs;
            },
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    await tester.longPress(find.text('Work'));
    await tester.pumpAndSettle();

    expect(find.text('Edit'), findsOneWidget);
    expect(find.text('Delete'), findsOneWidget);

    await tester.tap(find.text('Edit'));
    await tester.pumpAndSettle();

    // Single-workspace row edit carries the host AND its sole workspace.
    expect(editedHost?.id, 'h1');
    expect(editedSoleWs?.id, 'w1');
  });

  testWidgets(
    'each workspace row is wired with a Dismissible (swipe-to-delete)',
    (tester) async {
      final storage = _FakeStorage();
      final store = HostWorkspaceStoreImpl(storage);
      await store.upsertHost(_host());
      await store.upsertWorkspace(
        _ws(id: 'w1', hostId: 'h1', displayName: 'Work'),
      );
      await store.setActiveWorkspace('w1');

      await _pumpPicker(tester, store);

      expect(find.byType(Dismissible), findsOneWidget);
    },
  );
}
