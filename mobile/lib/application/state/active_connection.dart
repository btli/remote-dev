import '../../domain/host_config.dart';
import '../../domain/workspace_config.dart';

/// The currently-active connection: a [WorkspaceConfig] paired with the
/// [HostConfig] it belongs to.
///
/// The host owns the origin + the host-wide CF Access token; the workspace
/// owns the base path + its per-instance API key. Downstream wiring (the Dio
/// client, the WebView cookie seeder) needs BOTH halves to build an
/// authenticated request, so they travel together.
///
/// For a migrated single-workspace install the workspace's [WorkspaceConfig.basePath]
/// is `''`, so `host.origin + workspace.basePath == host.origin` — i.e. the
/// effective URL is byte-identical to the pre-migration `ServerConfig.url`.
class ActiveConnection {
  const ActiveConnection({required this.host, required this.workspace});

  final HostConfig host;
  final WorkspaceConfig workspace;

  /// Effective base URL for API + WebView requests: `host.origin + basePath`.
  /// `''` base path (single-workspace) yields exactly `host.origin`.
  String get effectiveUrl => '${host.origin}${workspace.basePath}';

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is ActiveConnection &&
          other.host == host &&
          other.workspace == workspace;

  @override
  int get hashCode => Object.hash(host, workspace);
}
