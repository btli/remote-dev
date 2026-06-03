import 'package:freezed_annotation/freezed_annotation.dart';

part 'host_config.freezed.dart';
part 'host_config.g.dart';

/// Whether a host serves a single workspace (a plain Remote Dev server) or
/// multiple path-prefixed workspaces behind a Supervisor router.
enum HostKind { singleWorkspace, multiWorkspace }

/// A connection target. Owns the host-wide CF Access token; each of its
/// [WorkspaceConfig]s owns a slug/basePath + per-instance API key.
@freezed
class HostConfig with _$HostConfig {
  const factory HostConfig({
    required String id,
    required String label,

    /// `scheme://host[:port]` — NO trailing slash, NO path.
    required String origin,
    required HostKind kind,
    required DateTime createdAt,
    required DateTime lastUsedAt,
  }) = _HostConfig;

  factory HostConfig.fromJson(Map<String, dynamic> json) =>
      _$HostConfigFromJson(json);
}
