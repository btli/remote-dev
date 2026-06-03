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
    /// Build with [normalizeOrigin] to guarantee that invariant.
    required String origin,
    required HostKind kind,
    required DateTime createdAt,
    required DateTime lastUsedAt,
  }) = _HostConfig;

  factory HostConfig.fromJson(Map<String, dynamic> json) =>
      _$HostConfigFromJson(json);

  const HostConfig._();

  /// Normalize an arbitrary server URL into the `origin` contract:
  /// `scheme://host[:port]` with NO trailing slash and NO path/query/fragment.
  /// e.g. `https://h2/demo/` → `https://h2`, `http://h:8080` → `http://h:8080`.
  static String normalizeOrigin(String input) {
    final uri = Uri.parse(input.trim());
    return '${uri.scheme}://${uri.host}${uri.hasPort ? ':${uri.port}' : ''}';
  }
}
