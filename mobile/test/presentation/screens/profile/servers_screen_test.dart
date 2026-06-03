import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:remote_dev/application/ports/secure_storage_port.dart';
import 'package:remote_dev/domain/host_config.dart';
import 'package:remote_dev/domain/workspace_config.dart';
import 'package:remote_dev/infrastructure/storage/host_workspace_store_impl.dart';
import 'package:remote_dev/presentation/screens/profile/servers_screen.dart';
import 'package:remote_dev/presentation/screens/webview_host/session_route_host.dart'
    show hostWorkspaceStoreProvider, secureStorageProvider;

/// Map-backed [SecureStoragePort] (D2 convention) so the real
/// [HostWorkspaceStoreImpl] persists in-memory — `ServersScreen` now drives the
/// Host/Workspace store, not the legacy per-server store.
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

HostConfig _host({String id = 'h1', String label = 'Prod'}) => HostConfig(
      id: id,
      label: label,
      origin: 'https://prod.example.com',
      kind: HostKind.singleWorkspace,
      createdAt: DateTime.utc(2026, 1, 1),
      lastUsedAt: DateTime.utc(2026, 1, 1),
    );

WorkspaceConfig _ws({
  String id = 'w1',
  String hostId = 'h1',
  String displayName = 'Prod',
}) =>
    WorkspaceConfig(
      id: id,
      hostId: hostId,
      slug: '',
      basePath: '',
      displayName: displayName,
      status: null,
      lastUsedAt: DateTime.utc(2026, 1, 1),
    );

void main() {
  testWidgets(
    'ServersScreen mounts the server picker (empty state)',
    (tester) async {
      final store = HostWorkspaceStoreImpl(_FakeStorage());

      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            secureStorageProvider
                .overrideWith((_) => throw UnimplementedError()),
            hostWorkspaceStoreProvider.overrideWithValue(store),
          ],
          child: const MaterialApp(home: ServersScreen()),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('Servers'), findsOneWidget);
      expect(find.text('No servers yet.'), findsOneWidget);
      expect(find.text('Add a server'), findsOneWidget);
    },
  );

  // Tapping a row activates the workspace (NEW active pointer) and pops back to
  // whatever pushed us (here: the synthetic `/profile` root) rather than nuking
  // the Profile tab stack with go('/home').
  testWidgets(
    'tapping a workspace activates it and pops back to the previous route',
    (tester) async {
      final storage = _FakeStorage();
      final store = HostWorkspaceStoreImpl(storage);
      await store.upsertHost(_host());
      await store.upsertWorkspace(_ws());

      final router = GoRouter(
        initialLocation: '/profile',
        routes: [
          GoRoute(
            path: '/profile',
            builder: (context, _) => Scaffold(
              appBar: AppBar(title: const Text('profile-root')),
              body: Center(
                child: ElevatedButton(
                  onPressed: () => context.push('/profile/servers'),
                  child: const Text('open-servers'),
                ),
              ),
            ),
            routes: [
              GoRoute(
                path: 'servers',
                builder: (_, __) => const ServersScreen(),
              ),
            ],
          ),
          GoRoute(
            path: '/home',
            builder: (_, __) => const Scaffold(body: Text('home-root')),
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

      await tester.tap(find.text('open-servers'));
      await tester.pumpAndSettle();
      expect(find.text('Servers'), findsOneWidget);
      expect(find.text('Prod'), findsOneWidget);

      await tester.tap(find.text('Prod'));
      await tester.pumpAndSettle();

      // The NEW active pointer is set.
      expect((await store.loadActiveWorkspace())!.id, 'w1');

      // We popped back to /profile, not navigated to /home.
      expect(find.text('open-servers'), findsOneWidget);
      expect(find.text('home-root'), findsNothing);
    },
  );

  // canPop=false fallback: when ServersScreen is the initial route there is
  // nothing to pop, so selection falls back to `context.go('/home')`.
  testWidgets(
    'tapping a workspace falls back to /home when canPop is false',
    (tester) async {
      final storage = _FakeStorage();
      final store = HostWorkspaceStoreImpl(storage);
      await store.upsertHost(_host(id: 'h2', label: 'Staging'));
      await store.upsertWorkspace(
        _ws(id: 'w2', hostId: 'h2', displayName: 'Staging'),
      );

      final router = GoRouter(
        initialLocation: '/servers',
        routes: [
          GoRoute(
            path: '/servers',
            builder: (_, __) => const ServersScreen(),
          ),
          GoRoute(
            path: '/home',
            builder: (_, __) => const Scaffold(body: Text('home-root')),
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

      await tester.tap(find.text('Staging'));
      await tester.pumpAndSettle();

      expect((await store.loadActiveWorkspace())!.id, 'w2');
      expect(find.text('home-root'), findsOneWidget);
    },
  );
}
