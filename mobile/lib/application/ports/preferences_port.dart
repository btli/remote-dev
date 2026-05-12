import '../../domain/active_node.dart';

/// Port for reading and mutating the user's "active node" (the project
/// or group currently scoping tabs like Channels, Tasks, and Peers).
/// Maps to the server's `GET /api/preferences` and
/// `POST /api/preferences/active-node` endpoints.
abstract class PreferencesPort {
  /// Read the active node. Returns `null` when neither `pinnedNode*` nor
  /// `activeNode*` is set on the server's user-settings row.
  ///
  /// Implementations should prefer `pinnedNode*` over `activeNode*` so
  /// behavior matches the PWA, which treats the pinned node as the
  /// authoritative "what is this user looking at" pointer.
  Future<ActiveNode?> getActiveNode();

  /// POST `/api/preferences/active-node` to update the active or pinned
  /// node. Pass `nodeId: null, nodeType: null` to clear the selection.
  Future<void> setActiveNode({
    required String? nodeId,
    required ActiveNodeType? nodeType,
    bool pinned = false,
  });
}
