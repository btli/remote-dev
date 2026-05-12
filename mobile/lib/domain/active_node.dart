// ignore_for_file: invalid_annotation_target

import 'package:freezed_annotation/freezed_annotation.dart';

part 'active_node.freezed.dart';
part 'active_node.g.dart';

/// Discriminator for the two kinds of node the user can pin/activate:
/// a project group (container) or a project (leaf). Mirrors the server
/// schema's `active_node_type` / `pinned_node_type` column.
enum ActiveNodeType {
  @JsonValue('group')
  group,
  @JsonValue('project')
  project,
}

/// Snapshot of the user's currently-active or pinned node, sourced from
/// `GET /api/preferences` (combining `pinnedNode*` if set, else
/// `activeNode*`). `name` is populated from the server's `activeFolder`
/// response field when available.
@freezed
class ActiveNode with _$ActiveNode {
  const factory ActiveNode({
    required String id,
    required ActiveNodeType type,
    String? name,
  }) = _ActiveNode;

  factory ActiveNode.fromJson(Map<String, dynamic> json) =>
      _$ActiveNodeFromJson(json);
}
