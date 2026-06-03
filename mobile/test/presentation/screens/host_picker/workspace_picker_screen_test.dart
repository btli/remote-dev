import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:remote_dev/application/ports/secure_storage_port.dart';
import 'package:remote_dev/domain/host_config.dart';
import 'package:remote_dev/domain/instance_summary.dart';
import 'package:remote_dev/domain/workspace_config.dart';
import 'package:remote_dev/infrastructure/auth/mobile_credentials.dart';
import 'package:remote_dev/infrastructure/storage/host_workspace_store_impl.dart';
import 'package:remote_dev/presentation/screens/host_picker/workspace_picker_screen.dart';
import 'package:remote_dev/presentation/screens/webview_host/session_route_host.dart'
    show hostWorkspaceStoreProvider, mobileCredentialsStoreProvider;

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

HostConfig _host() => HostConfig(
      id: 'h_1',
      label: 'Supervisor',
      origin: 'https://host.example.com',
      kind: HostKind.multiWorkspace,
      createdAt: DateTime(2024),
      lastUsedAt: DateTime(2024),
    );

void main() {
  Future<({_FakeStorage storage, HostWorkspaceStoreImpl store})> pump(
    WidgetTester tester, {
    required List<InstanceSummary> instances,
    WorkspaceLoginLauncher? login,
    void Function(WorkspaceConfig)? onActivated,
  }) async {
    final storage = _FakeStorage();
    final store = HostWorkspaceStoreImpl(storage);
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          hostWorkspaceStoreProvider.overrideWithValue(store),
          mobileCredentialsStoreProvider
              .overrideWithValue(MobileCredentialsStore(storage)),
        ],
        child: MaterialApp(
          home: WorkspacePickerScreen(
            host: _host(),
            instances: instances,
            onActivated: onActivated ?? (_) {},
            workspaceLoginLauncher: login,
          ),
        ),
      ),
    );
    return (storage: storage, store: store);
  }

  testWidgets(
    'ready instance is selectable; tapping mints + upserts + activates + '
    'fires onActivated',
    (tester) async {
      WorkspaceConfig? activated;
      Uri? capturedLoginUrl;

      final ctx = await pump(
        tester,
        instances: const [
          InstanceSummary(
            slug: 'demo',
            displayName: 'Demo',
            status: 'ready',
          ),
        ],
        login: (url) async {
          capturedLoginUrl = url;
          return const MobileCredentials(
            apiKey: 'sk-demo',
            cfToken: 'fresh-jwt',
          );
        },
        onActivated: (ws) => activated = ws,
      );

      await tester.tap(find.text('Demo'));
      await tester.pumpAndSettle();

      // Login launched against <origin>/<slug>.
      expect(capturedLoginUrl, Uri.parse('https://host.example.com/demo'));

      expect(activated, isNotNull);
      expect(activated!.slug, 'demo');
      expect(activated!.basePath, '/demo');
      expect(activated!.displayName, 'Demo');
      expect(activated!.status, 'ready');
      expect(activated!.id, 'w_h_1_demo');

      // Persisted + activated.
      final workspaces = await ctx.store.loadWorkspaces();
      expect(workspaces.single.basePath, '/demo');
      final active = await ctx.store.loadActiveWorkspace();
      expect(active!.id, 'w_h_1_demo');

      // Credentials: per-workspace API key + refreshed host CF token.
      final creds = MobileCredentialsStore(ctx.storage);
      expect(await creds.getWorkspaceApiKey('w_h_1_demo'), 'sk-demo');
      expect(await creds.getHostCfToken('h_1'), 'fresh-jwt');
    },
  );

  testWidgets(
    'non-ready instance is disabled and does not mint/activate on tap',
    (tester) async {
      var loginCalls = 0;
      WorkspaceConfig? activated;

      final ctx = await pump(
        tester,
        instances: const [
          InstanceSummary(
            slug: 'pending',
            displayName: 'Pending',
            status: 'provisioning',
          ),
        ],
        login: (_) async {
          loginCalls += 1;
          return const MobileCredentials(apiKey: 'x');
        },
        onActivated: (ws) => activated = ws,
      );

      // The row renders with its status; tapping it is a no-op.
      expect(find.text('Pending'), findsOneWidget);
      expect(find.text('provisioning'), findsOneWidget);

      await tester.tap(find.text('Pending'));
      await tester.pumpAndSettle();

      expect(loginCalls, 0);
      expect(activated, isNull);
      expect(await ctx.store.loadWorkspaces(), isEmpty);
      expect(await ctx.store.loadActiveWorkspace(), isNull);
    },
  );

  testWidgets(
    'empty instance list shows the friendly empty state',
    (tester) async {
      await pump(tester, instances: const []);
      await tester.pumpAndSettle();

      expect(find.text('No ready workspaces yet.'), findsOneWidget);
    },
  );
}
