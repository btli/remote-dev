import '../../domain/channel.dart';

abstract class ChannelsPort {
  /// List channels visible to the current user. The implementation is
  /// expected to flatten any server-side groupings into a single list.
  Future<List<Channel>> list();

  /// Archive the channel with the given id (DELETE /api/channels/:id).
  Future<void> archive(String id);
}
