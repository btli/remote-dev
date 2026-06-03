import '../../domain/host_config.dart';
import '../../domain/workspace_config.dart';

/// Persistence port for the Host → Workspace hierarchy. Backed by secure
/// storage; credentials live in [MobileCredentialsStore] keyed by host /
/// workspace id.
abstract class HostWorkspaceStore {
  Future<List<HostConfig>> loadHosts();

  /// All workspaces, or only those belonging to [hostId] when provided.
  Future<List<WorkspaceConfig>> loadWorkspaces({String? hostId});

  Future<WorkspaceConfig?> loadActiveWorkspace();

  Future<HostConfig?> loadHost(String hostId);

  Future<void> upsertHost(HostConfig host);

  Future<void> upsertWorkspace(WorkspaceConfig ws);

  Future<void> setActiveWorkspace(String workspaceId);

  /// Removes a host, cascading to its workspaces and all related credentials.
  Future<void> removeHost(String hostId);

  Future<void> removeWorkspace(String workspaceId);

  /// One-time migration of legacy `servers` into hosts + workspaces.
  /// Idempotent; guarded by a persisted `schema_version`.
  Future<void> migrateLegacyServersIfNeeded();
}
