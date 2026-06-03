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

  factory InstanceSummary.fromJson(Map<String, dynamic> json) =>
      _$InstanceSummaryFromJson(json);

  /// Build from one element of the Supervisor's `instances` array, applying the
  /// [displayName] → [slug] fallback when the server value is absent or blank.
  /// Use this (not [fromJson]) when parsing the real `/api/instances` payload.
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
