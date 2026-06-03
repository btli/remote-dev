import 'dart:convert';

import 'package:uuid/uuid.dart';

import '../../application/ports/host_workspace_store.dart';
import '../../application/ports/secure_storage_port.dart';
import '../../domain/host_config.dart';
import '../../domain/server_config.dart';
import '../../domain/workspace_config.dart';
import '../auth/mobile_credentials.dart';

/// Secure-storage-backed [HostWorkspaceStore].
///
/// Host/workspace lists and the active-workspace pointer live in the shared
/// `__meta__` namespace (same convention as [ServerConfigStoreImpl]).
/// Credentials are delegated to [MobileCredentialsStore] (`host.<id>` /
/// `workspace.<id>` namespaces).
class HostWorkspaceStoreImpl implements HostWorkspaceStore {
  HostWorkspaceStoreImpl(this._storage, {Uuid? uuid})
      : _creds = MobileCredentialsStore(_storage),
        _uuid = uuid ?? const Uuid();

  final SecureStoragePort _storage;
  final MobileCredentialsStore _creds;
  final Uuid _uuid;

  // Meta namespace + keys (mirrors ServerConfigStoreImpl).
  static const _metaId = '__meta__';
  static const _hostsKey = 'hosts';
  static const _workspacesKey = 'workspaces';
  static const _activeWorkspaceKey = 'active_workspace_id';
  static const _schemaVersionKey = 'schema_version';

  // Legacy keys (must match ServerConfigStoreImpl).
  static const _legacyServersKey = 'servers';
  static const _legacyActiveServerKey = 'active_server_id';

  static const _currentSchemaVersion = 2;

  // --- Hosts ---------------------------------------------------------------

  @override
  Future<List<HostConfig>> loadHosts() async {
    final raw = await _storage.read(_metaId, _hostsKey);
    if (raw == null || raw.isEmpty) return const [];
    final list = (jsonDecode(raw) as List).cast<Map<String, dynamic>>();
    return list.map(HostConfig.fromJson).toList(growable: false);
  }

  @override
  Future<HostConfig?> loadHost(String hostId) async {
    for (final h in await loadHosts()) {
      if (h.id == hostId) return h;
    }
    return null;
  }

  @override
  Future<void> upsertHost(HostConfig host) async {
    final list = await loadHosts();
    final updated = [
      ...list.where((h) => h.id != host.id),
      host,
    ]..sort((a, b) => b.lastUsedAt.compareTo(a.lastUsedAt));
    await _writeHosts(updated);
  }

  @override
  Future<void> removeHost(String hostId) async {
    // Cascade: drop every workspace under this host (clearing its creds), then
    // drop the host row and its host-wide creds.
    final workspaces = await loadWorkspaces();
    for (final ws in workspaces.where((w) => w.hostId == hostId)) {
      await removeWorkspace(ws.id);
    }

    final hosts = await loadHosts();
    await _writeHosts(hosts.where((h) => h.id != hostId).toList());
    await _creds.clearHost(hostId);
  }

  // --- Workspaces ----------------------------------------------------------

  @override
  Future<List<WorkspaceConfig>> loadWorkspaces({String? hostId}) async {
    final raw = await _storage.read(_metaId, _workspacesKey);
    if (raw == null || raw.isEmpty) return const [];
    final list = (jsonDecode(raw) as List).cast<Map<String, dynamic>>();
    final all = list.map(WorkspaceConfig.fromJson);
    final filtered = hostId == null ? all : all.where((w) => w.hostId == hostId);
    return filtered.toList(growable: false);
  }

  @override
  Future<WorkspaceConfig?> loadActiveWorkspace() async {
    final id = await _storage.read(_metaId, _activeWorkspaceKey);
    if (id == null) return null;
    for (final ws in await loadWorkspaces()) {
      if (ws.id == id) return ws;
    }
    return null;
  }

  @override
  Future<void> upsertWorkspace(WorkspaceConfig ws) async {
    final list = await loadWorkspaces();
    final updated = [
      ...list.where((w) => w.id != ws.id),
      ws,
    ]..sort((a, b) => b.lastUsedAt.compareTo(a.lastUsedAt));
    await _writeWorkspaces(updated);
  }

  @override
  Future<void> setActiveWorkspace(String workspaceId) =>
      _storage.write(_metaId, _activeWorkspaceKey, workspaceId);

  @override
  Future<void> removeWorkspace(String workspaceId) async {
    final list = await loadWorkspaces();
    final updated = list.where((w) => w.id != workspaceId).toList();
    await _writeWorkspaces(updated);
    await _creds.clearWorkspace(workspaceId);

    final activeId = await _storage.read(_metaId, _activeWorkspaceKey);
    if (activeId == workspaceId) {
      if (updated.isNotEmpty) {
        await setActiveWorkspace(updated.first.id);
      } else {
        await _storage.delete(_metaId, _activeWorkspaceKey);
      }
    }
  }

  // --- Migration -----------------------------------------------------------

  @override
  Future<void> migrateLegacyServersIfNeeded() async {
    final versionRaw = await _storage.read(_metaId, _schemaVersionKey);
    final version = int.tryParse(versionRaw ?? '') ?? 0;
    if (version >= _currentSchemaVersion) return;

    // Build the migrated state in memory first; only commit (and stamp the
    // schema version) once everything succeeds. On any error we rethrow
    // WITHOUT touching schema_version or the legacy keys, so a later run can
    // resume from scratch.
    final legacyServers = await _loadLegacyServers();
    final legacyActiveServerId =
        await _storage.read(_metaId, _legacyActiveServerKey);

    final hosts = <HostConfig>[];
    final workspaces = <WorkspaceConfig>[];
    // Deferred credential writes: workspace/host id -> token. Applied only
    // after the host/workspace lists persist successfully.
    final hostCfTokens = <String, String>{};
    final workspaceApiKeys = <String, String>{};
    String? activeWorkspaceId;

    for (final server in legacyServers) {
      final uri = Uri.parse(server.url);
      final origin =
          '${uri.scheme}://${uri.host}${uri.hasPort ? ':${uri.port}' : ''}';
      // Strip any trailing slash from the path; "" when at the root.
      var path = uri.path;
      while (path.endsWith('/')) {
        path = path.substring(0, path.length - 1);
      }
      final basePath = path; // "" or "/<slug>"
      final slug = path.startsWith('/') ? path.substring(1) : path;

      final hostId = _uuid.v4();
      final workspaceId = _uuid.v4();

      hosts.add(
        HostConfig(
          id: hostId,
          label: server.label,
          origin: origin,
          kind: HostKind.singleWorkspace,
          createdAt: server.lastUsedAt,
          lastUsedAt: server.lastUsedAt,
        ),
      );
      workspaces.add(
        WorkspaceConfig(
          id: workspaceId,
          hostId: hostId,
          slug: slug,
          basePath: basePath,
          displayName: server.label,
          status: null,
          lastUsedAt: server.lastUsedAt,
        ),
      );

      // Carry over legacy per-server credentials. readCfToken handles the
      // legacy `cf_authorization` fallback transparently.
      final cf = await _creds.readCfToken(server.id);
      if (cf != null && cf.isNotEmpty) hostCfTokens[hostId] = cf;
      final apiKey = await _creds.readApiKey(server.id);
      if (apiKey != null && apiKey.isNotEmpty) {
        workspaceApiKeys[workspaceId] = apiKey;
      }

      if (server.id == legacyActiveServerId) {
        activeWorkspaceId = workspaceId;
      }
    }

    // Commit. Order: lists first, then creds, then active pointer, then stamp.
    await _writeHosts(hosts);
    await _writeWorkspaces(workspaces);
    for (final entry in hostCfTokens.entries) {
      await _creds.setHostCfToken(entry.key, entry.value);
    }
    for (final entry in workspaceApiKeys.entries) {
      await _creds.setWorkspaceApiKey(entry.key, entry.value);
    }
    if (activeWorkspaceId != null) {
      await setActiveWorkspace(activeWorkspaceId);
    }
    await _storage.write(
      _metaId,
      _schemaVersionKey,
      '$_currentSchemaVersion',
    );
  }

  Future<List<ServerConfig>> _loadLegacyServers() async {
    final raw = await _storage.read(_metaId, _legacyServersKey);
    if (raw == null || raw.isEmpty) return const [];
    final list = (jsonDecode(raw) as List).cast<Map<String, dynamic>>();
    return list.map(ServerConfig.fromJson).toList(growable: false);
  }

  // --- Persistence helpers -------------------------------------------------

  Future<void> _writeHosts(List<HostConfig> hosts) => _storage.write(
        _metaId,
        _hostsKey,
        jsonEncode(hosts.map((h) => h.toJson()).toList()),
      );

  Future<void> _writeWorkspaces(List<WorkspaceConfig> workspaces) =>
      _storage.write(
        _metaId,
        _workspacesKey,
        jsonEncode(workspaces.map((w) => w.toJson()).toList()),
      );
}
