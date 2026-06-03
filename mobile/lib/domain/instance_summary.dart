import 'package:freezed_annotation/freezed_annotation.dart';

part 'instance_summary.freezed.dart';
part 'instance_summary.g.dart';

/// One workspace/instance discovered from a Supervisor host via
/// `GET /api/instances`.
///
/// The Supervisor returns `{ instances: [ <instance row>, ... ] }` where each
/// row is the full Drizzle `instance` record (see
/// `apps/supervisor/src/db/schema.ts`). The picker only needs three fields, so
/// this DTO intentionally maps just `slug`, `displayName`, and `status`
/// (YAGNI — `namespace`/`baseUrl`/`createdAt`/storage/resource columns are
/// deliberately dropped).
///
/// [status] is one of the server's `InstanceStatus` values
/// (`requested | provisioning | ready | suspended | terminating | deleted |
/// error`) kept as a plain `String` so a new server-side status can't crash an
/// older client.
@freezed
class InstanceSummary with _$InstanceSummary {
  const factory InstanceSummary({
    /// Instance slug, e.g. `demo`. Stable identifier + URL path segment.
    required String slug,

    /// Human label. The server column is NOT NULL, but we default it to [slug]
    /// (via [InstanceSummary.fromInstanceJson]) so a blank/missing value never
    /// renders an empty row in the picker.
    required String displayName,

    /// Raw lifecycle status string from the server.
    required String status,
  }) = _InstanceSummary;

  const InstanceSummary._();

  /// Strict json_serializable deserializer. It requires BOTH `slug` and
  /// `displayName` to be present (the generated code throws on a missing
  /// `displayName`) and does NOT apply the [displayName] → [slug] fallback.
  ///
  /// DUAL-FACTORY GUARD: for real server payloads from `GET /api/instances`
  /// (where `displayName` is nullable/blank) use [fromInstanceJson] instead —
  /// it is the only safe parser for the wire shape. This factory exists so
  /// json_serializable can round-trip the DTO and is marked
  /// `@visibleForTesting` so any production call site that should have used
  /// [fromInstanceJson] trips the analyzer instead of failing at runtime on a
  /// blank `displayName`.
  @visibleForTesting
  factory InstanceSummary.fromJson(Map<String, dynamic> json) =>
      _$InstanceSummaryFromJson(json);

  /// Build from one element of the Supervisor's `instances` array, applying the
  /// [displayName] → [slug] fallback when the server value is absent or blank.
  /// Use this (NOT [fromJson]) when parsing the real `/api/instances` payload.
  factory InstanceSummary.fromInstanceJson(Map<String, dynamic> json) {
    final slug = json['slug'] as String;
    final rawDisplayName = json['displayName'] as String?;
    final displayName = (rawDisplayName == null || rawDisplayName.isEmpty)
        ? slug
        : rawDisplayName;
    return InstanceSummary(
      slug: slug,
      displayName: displayName,
      status: json['status'] as String,
    );
  }
}
