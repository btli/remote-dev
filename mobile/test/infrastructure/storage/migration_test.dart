import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:remote_dev/application/ports/secure_storage_port.dart';
import 'package:remote_dev/domain/host_config.dart';
import 'package:remote_dev/domain/server_config.dart';
import 'package:remote_dev/infrastructure/auth/mobile_credentials.dart';
import 'package:remote_dev/infrastructure/storage/host_workspace_store_impl.dart';

/// Map-backed [SecureStoragePort] mirroring the real
/// `FlutterSecureStoragePort` key layout (`server.<serverId>.<key>`).
class _FakeStorage implements SecureStoragePort {
  final Map<String, String?> data = <String, String?>{};

  /// When set, a `write(serverId, key, _)` whose logical key equals this value
  /// throws — used to simulate a mid-migration crash on a specific key.
  String? failWriteKey;

  String _key(String serverId, String key) => 'server.$serverId.$key';

  @override
  Future<String?> read(String serverId, String key) async =>
      data[_key(serverId, key)];

  @override
  Future<void> write(String serverId, String key, String value) async {
    if (key == failWriteKey) {
      throw StateError('simulated write failure for "$key"');
    }
    data[_key(serverId, key)] = value;
  }

  @override
  Future<void> delete(String serverId, String key) async {
    data.remove(_key(serverId, key));
  }

  @override
  Future<void> deleteAll(String serverId) async {
    data.removeWhere((k, _) => k.startsWith('server.$serverId.'));
  }
}

void main() {
  group('migrateLegacyServersIfNeeded', () {
    late _FakeStorage storage;
    late HostWorkspaceStoreImpl store;
    late MobileCredentialsStore creds;

    // Two legacy servers: one root URL, one with a /demo path. The active
    // server points at the /demo one.
    final rootServer = ServerConfig(
      id: 'srv-root',
      label: 'Root Server',
      url: 'https://h1',
      lastUsedAt: DateTime.utc(2026, 5, 1),
    );
    final demoServer = ServerConfig(
      id: 'srv-demo',
      label: 'Demo Server',
      url: 'https://h2/demo',
      lastUsedAt: DateTime.utc(2026, 5, 8),
    );

    void seedLegacy() {
      storage.data['server.__meta__.servers'] = jsonEncode([
        rootServer.toJson(),
        demoServer.toJson(),
      ]);
      storage.data['server.__meta__.active_server_id'] = 'srv-demo';
      // Legacy per-server credentials (server.<id>.<key>).
      storage.data['server.srv-root.api_key'] = 'root-api-key';
      storage.data['server.srv-root.cf_token'] = 'root-cf-token';
      storage.data['server.srv-demo.api_key'] = 'demo-api-key';
      storage.data['server.srv-demo.cf_token'] = 'demo-cf-token';
    }

    setUp(() {
      storage = _FakeStorage();
      store = HostWorkspaceStoreImpl(storage);
      creds = MobileCredentialsStore(storage);
      seedLegacy();
    });

    test('migrates two servers into two hosts + two workspaces', () async {
      await store.migrateLegacyServersIfNeeded();

      final hosts = await store.loadHosts();
      final workspaces = await store.loadWorkspaces();

      expect(hosts, hasLength(2));
      expect(workspaces, hasLength(2));

      // Every host is single-workspace and carries the legacy label/origin.
      expect(
        hosts.every((h) => h.kind == HostKind.singleWorkspace),
        isTrue,
      );
      final originsByLabel = {for (final h in hosts) h.label: h.origin};
      expect(originsByLabel['Root Server'], 'https://h1');
      expect(originsByLabel['Demo Server'], 'https://h2');
    });

    test('derives basePath/slug from the legacy URL path', () async {
      await store.migrateLegacyServersIfNeeded();

      final workspaces = await store.loadWorkspaces();
      final byName = {for (final w in workspaces) w.displayName: w};

      final root = byName['Root Server']!;
      expect(root.basePath, '');
      expect(root.slug, '');

      final demo = byName['Demo Server']!;
      expect(demo.basePath, '/demo');
      expect(demo.slug, 'demo');

      // Each workspace links back to a host of the same label.
      final hosts = await store.loadHosts();
      final hostById = {for (final h in hosts) h.id: h};
      expect(hostById[root.hostId]!.label, 'Root Server');
      expect(hostById[demo.hostId]!.label, 'Demo Server');
    });

    test('moves CF token to the host and API key to the workspace', () async {
      await store.migrateLegacyServersIfNeeded();

      final workspaces = await store.loadWorkspaces();
      final byName = {for (final w in workspaces) w.displayName: w};
      final root = byName['Root Server']!;
      final demo = byName['Demo Server']!;

      // API keys live on the new workspace namespace.
      expect(await creds.getWorkspaceApiKey(root.id), 'root-api-key');
      expect(await creds.getWorkspaceApiKey(demo.id), 'demo-api-key');

      // CF tokens live on the new host namespace.
      expect(await creds.getHostCfToken(root.hostId), 'root-cf-token');
      expect(await creds.getHostCfToken(demo.hostId), 'demo-cf-token');

      // Sanity: physical keys use the documented logical layout.
      expect(
        storage.data['server.workspace.${demo.id}.apiKey'],
        'demo-api-key',
      );
      expect(
        storage.data['server.host.${demo.hostId}.cfToken'],
        'demo-cf-token',
      );
    });

    test('maps active_server_id to the matching active workspace', () async {
      await store.migrateLegacyServersIfNeeded();

      final active = await store.loadActiveWorkspace();
      expect(active, isNotNull);
      // active_server_id pointed at srv-demo (the /demo path server).
      expect(active!.basePath, '/demo');
      expect(active.displayName, 'Demo Server');
    });

    test('stamps schema_version = 2', () async {
      await store.migrateLegacyServersIfNeeded();
      expect(storage.data['server.__meta__.schema_version'], '2');
    });

    test('second run is a no-op (idempotent)', () async {
      await store.migrateLegacyServersIfNeeded();

      final hostsAfterFirst = await store.loadHosts();
      final workspacesAfterFirst = await store.loadWorkspaces();
      final activeAfterFirst = await store.loadActiveWorkspace();
      final snapshot = Map<String, String?>.from(storage.data);

      await store.migrateLegacyServersIfNeeded();

      // No new hosts/workspaces, ids unchanged, storage byte-identical.
      expect(await store.loadHosts(), hostsAfterFirst);
      expect(await store.loadWorkspaces(), workspacesAfterFirst);
      expect((await store.loadActiveWorkspace())!.id, activeAfterFirst!.id);
      expect(storage.data, snapshot);
    });

    test('already-migrated store (schema_version>=2) skips immediately',
        () async {
      // Fresh store with the version already stamped and NO legacy servers.
      storage = _FakeStorage();
      store = HostWorkspaceStoreImpl(storage);
      storage.data['server.__meta__.schema_version'] = '2';

      await store.migrateLegacyServersIfNeeded();

      expect(await store.loadHosts(), isEmpty);
      expect(await store.loadWorkspaces(), isEmpty);
    });

    test('does not delete legacy server/cred keys after migration', () async {
      await store.migrateLegacyServersIfNeeded();

      // Migration is non-destructive: legacy data remains for rollback.
      expect(storage.data.containsKey('server.__meta__.servers'), isTrue);
      expect(storage.data['server.srv-demo.api_key'], 'demo-api-key');
      expect(storage.data['server.srv-root.cf_token'], 'root-cf-token');
    });

    test(
        'partial write failure leaves schema_version unset + legacy intact, '
        'and a clean re-run yields no duplicates or orphaned creds', () async {
      // Crash midway: writing the `workspaces` key throws (hosts already
      // written). schema_version must NOT be stamped.
      storage.failWriteKey = 'workspaces';
      await expectLater(
        store.migrateLegacyServersIfNeeded(),
        throwsA(isA<StateError>()),
      );

      expect(
        storage.data.containsKey('server.__meta__.schema_version'),
        isFalse,
        reason: 'schema_version must not be stamped on partial failure',
      );
      // Legacy data is untouched, so a later run can resume.
      expect(storage.data.containsKey('server.__meta__.servers'), isTrue);
      expect(storage.data['server.srv-demo.api_key'], 'demo-api-key');

      // Recover and re-run. Deterministic IDs make this an idempotent upsert.
      storage.failWriteKey = null;
      await store.migrateLegacyServersIfNeeded();

      final hosts = await store.loadHosts();
      final workspaces = await store.loadWorkspaces();
      expect(hosts, hasLength(2));
      expect(workspaces, hasLength(2));
      // IDs are derived from the legacy server id — no random duplicates.
      expect(
        hosts.map((h) => h.id),
        unorderedEquals(['h_srv-root', 'h_srv-demo']),
      );
      expect(
        workspaces.map((w) => w.id),
        unorderedEquals(['w_srv-root', 'w_srv-demo']),
      );
      // Creds live under exactly those deterministic namespaces (no orphans).
      expect(storage.data['server.host.h_srv-demo.cfToken'], 'demo-cf-token');
      expect(
        storage.data['server.workspace.w_srv-demo.apiKey'],
        'demo-api-key',
      );
      expect(storage.data['server.__meta__.schema_version'], '2');
    });

    test('strips trailing slashes from legacy URLs', () async {
      // Override the seed with trailing-slash variants.
      storage = _FakeStorage();
      store = HostWorkspaceStoreImpl(storage);
      storage.data['server.__meta__.servers'] = jsonEncode([
        ServerConfig(
          id: 'srv-root',
          label: 'Root',
          url: 'https://h1/',
          lastUsedAt: DateTime.utc(2026, 5, 1),
        ).toJson(),
        ServerConfig(
          id: 'srv-demo',
          label: 'Demo',
          url: 'https://h2/demo/',
          lastUsedAt: DateTime.utc(2026, 5, 2),
        ).toJson(),
      ]);

      await store.migrateLegacyServersIfNeeded();

      final byName = {
        for (final w in await store.loadWorkspaces()) w.displayName: w,
      };
      expect(byName['Root']!.basePath, '');
      expect(byName['Root']!.slug, '');
      expect(byName['Demo']!.basePath, '/demo');
      expect(byName['Demo']!.slug, 'demo');

      // origin is normalized too (no trailing slash, no path).
      final origins = {for (final h in await store.loadHosts()) h.label: h.origin};
      expect(origins['Root'], 'https://h1');
      expect(origins['Demo'], 'https://h2');
    });

    test('migrates a server with no stored credentials', () async {
      storage = _FakeStorage();
      store = HostWorkspaceStoreImpl(storage);
      final creds = MobileCredentialsStore(storage);
      // A single legacy server with NEITHER apiKey nor cfToken.
      storage.data['server.__meta__.servers'] = jsonEncode([
        ServerConfig(
          id: 'srv-bare',
          label: 'Bare',
          url: 'https://bare.example',
          lastUsedAt: DateTime.utc(2026, 5, 1),
        ).toJson(),
      ]);

      await store.migrateLegacyServersIfNeeded();

      // Host + workspace still created.
      final hosts = await store.loadHosts();
      final workspaces = await store.loadWorkspaces();
      expect(hosts.single.id, 'h_srv-bare');
      expect(workspaces.single.id, 'w_srv-bare');
      // No credentials written (false branch of both cred guards).
      expect(await creds.getHostCfToken('h_srv-bare'), isNull);
      expect(await creds.getWorkspaceApiKey('w_srv-bare'), isNull);
      // And the migration still completes / stamps the version.
      expect(storage.data['server.__meta__.schema_version'], '2');
    });
  });
}
