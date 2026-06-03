import 'package:freezed_annotation/freezed_annotation.dart';

part 'workspace_config.freezed.dart';
part 'workspace_config.g.dart';

/// A workspace within a [HostConfig]. For a single-workspace host this is the
/// host itself with an empty [slug]/[basePath]; for a multi-workspace host it
/// is one path-prefixed instance discovered via `GET /api/instances`.
@freezed
class WorkspaceConfig with _$WorkspaceConfig {
  const factory WorkspaceConfig({
    required String id,
    required String hostId,

    /// Instance slug, e.g. `demo`. Empty string for single-workspace hosts.
    required String slug,

    /// `""` or `/<slug>` — prepended to every API/WebView path.
    required String basePath,
    required String displayName,

    /// Last-known instance status; null for single-workspace hosts.
    String? status,
    required DateTime lastUsedAt,
  }) = _WorkspaceConfig;

  factory WorkspaceConfig.fromJson(Map<String, dynamic> json) =>
      _$WorkspaceConfigFromJson(json);
}
