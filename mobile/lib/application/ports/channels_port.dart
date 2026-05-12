import '../../domain/active_node.dart';
import '../../domain/channel.dart';

abstract class ChannelsPort {
  /// List channels scoped to [activeNode]. When [activeNode] is `null`
  /// the implementation must return an empty list without hitting the
  /// server — the `/api/channels` endpoint 400s without a scope, and
  /// the PWA mobile-web tab models the no-project state explicitly.
  Future<List<Channel>> list({ActiveNode? activeNode});

  /// Archive the channel with the given id (DELETE /api/channels/:id).
  Future<void> archive(String id);
}
