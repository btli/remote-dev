import '../../application/ports/api_client_port.dart';
import '../../application/ports/channels_port.dart';
import '../../domain/active_node.dart';
import '../../domain/channel.dart';

class ChannelsApi implements ChannelsPort {
  ChannelsApi(this._client);

  final ApiClientPort _client;

  @override
  Future<List<Channel>> list({ActiveNode? activeNode}) async {
    // Skip the request entirely when no project/group is selected. The
    // server's `/api/channels` route requires `?nodeId=&nodeType=` (or
    // the legacy `?projectId=`) and 400s without them, so an early
    // return is the cheap-and-correct path. Mirrors the PWA mobile-web
    // tab, which renders a "Pick a project" empty state in this case.
    if (activeNode == null) {
      return const [];
    }

    final typeParam = activeNode.type == ActiveNodeType.group
        ? 'group'
        : 'project';
    final path =
        '/api/channels?nodeId=${Uri.encodeQueryComponent(activeNode.id)}'
        '&nodeType=$typeParam';
    final raw = await _client.get(path);

    // Shape A: { channels: [...] } — flat list (anticipated future shape /
    // tests).
    if (raw is Map<String, dynamic> && raw['channels'] is List) {
      return (raw['channels'] as List)
          .cast<Map<String, dynamic>>()
          .map(Channel.fromJson)
          .toList(growable: false);
    }

    // Shape B: { groups: [{ channels: [...] }] } — current server response.
    // Flatten group-nested channels into a single list, preserving group
    // order then per-group channel order.
    if (raw is Map<String, dynamic> && raw['groups'] is List) {
      final out = <Channel>[];
      for (final group in (raw['groups'] as List)) {
        if (group is Map<String, dynamic> && group['channels'] is List) {
          for (final ch in (group['channels'] as List)) {
            if (ch is Map<String, dynamic>) {
              out.add(Channel.fromJson(ch));
            }
          }
        }
      }
      return List.unmodifiable(out);
    }

    // Shape C: bare array.
    if (raw is List) {
      return raw
          .cast<Map<String, dynamic>>()
          .map(Channel.fromJson)
          .toList(growable: false);
    }

    return const [];
  }

  @override
  Future<void> archive(String id) async {
    await _client.delete('/api/channels/$id');
  }
}
