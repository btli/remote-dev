import 'package:flutter_test/flutter_test.dart';
import 'package:remote_dev/application/ports/secure_storage_port.dart';
import 'package:remote_dev/domain/host_config.dart';
import 'package:remote_dev/domain/workspace_config.dart';
import 'package:remote_dev/infrastructure/auth/mobile_credentials.dart';
import 'package:remote_dev/infrastructure/storage/host_workspace_store_impl.dart';

/// Map-backed [SecureStoragePort] mirroring the real
/// `FlutterSecureStoragePort` key layout (`server.<serverId>.<key>`).
class _FakeStorage implements SecureStoragePort {
  final Map<String, String?> data = <String, String?>{};

  String _key(String serverId, String key) => 'server.$serverId.$key';

  @override
  Future<String?> read(String serverId, String key) async =>
      data[_key(serverId, key)];

  @override
  Future<void> write(String serverId, String key, String value) async {
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
  late _FakeStorage storage;
  late HostWorkspaceStoreImpl store;
  late MobileCredentialsStore creds;

  setUp(() {
    storage = _FakeStorage();
    store = HostWorkspaceStoreImpl(storage);
    creds = MobileCredentialsStore(storage);
  });

  HostConfig host(String id, {String label = 'Host', DateTime? at}) =>
      HostConfig(
        id: id,
        label: label,
        origin: 'https://$id.example.com',
        kind: HostKind.multiWorkspace,
        createdAt: at ?? DateTime.utc(2026, 5, 1),
        lastUsedAt: at ?? DateTime.utc(2026, 5, 1),
      );

  WorkspaceConfig workspace(
    String id,
    String hostId, {
    String slug = 'ws',
    DateTime? at,
  }) =>
      WorkspaceConfig(
        id: id,
        hostId: hostId,
        slug: slug,
        basePath: '/$slug',
        displayName: 'Workspace $id',
        status: 'running',
        lastUsedAt: at ?? DateTime.utc(2026, 5, 1),
      );

  group('hosts', () {
    test('upsert then load round-trips', () async {
      await store.upsertHost(host('h1', label: 'Alpha'));

      final hosts = await store.loadHosts();
      expect(hosts, hasLength(1));
      expect(hosts.single.label, 'Alpha');
      expect(hosts.single.kind, HostKind.multiWorkspace);
      expect(await store.loadHost('h1'), isNotNull);
      expect(await store.loadHost('missing'), isNull);
    });

    test('upsert replaces an existing host by id and sorts by lastUsedAt',
        () async {
      await store.upsertHost(host('h1', at: DateTime.utc(2026, 5, 1)));
      await store.upsertHost(host('h2', at: DateTime.utc(2026, 5, 9)));
      // Replace h1 (same id) with a newer timestamp + new label.
      await store.upsertHost(
        host('h1', label: 'Renamed', at: DateTime.utc(2026, 5, 10)),
      );

      final hosts = await store.loadHosts();
      expect(hosts, hasLength(2));
      // Newest first.
      expect(hosts.first.id, 'h1');
      expect(hosts.first.label, 'Renamed');
      expect(hosts.last.id, 'h2');
    });
  });

  group('workspaces', () {
    test('upsert/load and filter by hostId', () async {
      await store.upsertWorkspace(workspace('w1', 'h1'));
      await store.upsertWorkspace(workspace('w2', 'h1'));
      await store.upsertWorkspace(workspace('w3', 'h2'));

      expect(await store.loadWorkspaces(), hasLength(3));
      final h1 = await store.loadWorkspaces(hostId: 'h1');
      expect(h1.map((w) => w.id), unorderedEquals(['w1', 'w2']));
      final h2 = await store.loadWorkspaces(hostId: 'h2');
      expect(h2.map((w) => w.id), ['w3']);
    });

    test('setActiveWorkspace + loadActiveWorkspace round-trip', () async {
      await store.upsertWorkspace(workspace('w1', 'h1'));
      await store.upsertWorkspace(workspace('w2', 'h1'));

      expect(await store.loadActiveWorkspace(), isNull);
      await store.setActiveWorkspace('w2');
      expect((await store.loadActiveWorkspace())!.id, 'w2');
    });

    test('removeWorkspace drops the row and clears its API key', () async {
      await store.upsertWorkspace(workspace('w1', 'h1'));
      await creds.setWorkspaceApiKey('w1', 'key-1');

      await store.removeWorkspace('w1');

      expect(await store.loadWorkspaces(), isEmpty);
      expect(await creds.getWorkspaceApiKey('w1'), isNull);
    });

    test('removeWorkspace re-points active to the next remaining one',
        () async {
      await store.upsertWorkspace(
        workspace('w1', 'h1', at: DateTime.utc(2026, 5, 2)),
      );
      await store.upsertWorkspace(
        workspace('w2', 'h1', at: DateTime.utc(2026, 5, 1)),
      );
      await store.setActiveWorkspace('w1');

      await store.removeWorkspace('w1');

      // w2 is the only one left, so it becomes active.
      expect((await store.loadActiveWorkspace())!.id, 'w2');
    });

    test('removing the last active workspace clears the active pointer',
        () async {
      await store.upsertWorkspace(workspace('w1', 'h1'));
      await store.setActiveWorkspace('w1');

      await store.removeWorkspace('w1');

      expect(await store.loadActiveWorkspace(), isNull);
    });
  });

  group('removeHost cascade', () {
    test('removes the host, all its workspaces, and their credentials',
        () async {
      await store.upsertHost(host('h1'));
      await store.upsertHost(host('h2'));
      await store.upsertWorkspace(workspace('w1', 'h1'));
      await store.upsertWorkspace(workspace('w2', 'h1'));
      await store.upsertWorkspace(workspace('w3', 'h2'));
      await creds.setHostCfToken('h1', 'cf-h1');
      await creds.setWorkspaceApiKey('w1', 'key-1');
      await creds.setWorkspaceApiKey('w2', 'key-2');

      await store.removeHost('h1');

      // h1 gone, h2 remains.
      expect((await store.loadHosts()).map((h) => h.id), ['h2']);
      // Only h2's workspace remains.
      expect((await store.loadWorkspaces()).map((w) => w.id), ['w3']);
      // h1's host + workspace creds are cleared.
      expect(await creds.getHostCfToken('h1'), isNull);
      expect(await creds.getWorkspaceApiKey('w1'), isNull);
      expect(await creds.getWorkspaceApiKey('w2'), isNull);
    });

    test('cascade clears active when the active workspace belonged to the host',
        () async {
      await store.upsertHost(host('h1'));
      await store.upsertWorkspace(workspace('w1', 'h1'));
      await store.setActiveWorkspace('w1');

      await store.removeHost('h1');

      expect(await store.loadActiveWorkspace(), isNull);
    });
  });
}
