import '../../application/ports/api_client_port.dart';
import '../../application/ports/channels_port.dart';
import '../../domain/channel.dart';

class ChannelsApi implements ChannelsPort {
  ChannelsApi(this._client);

  final ApiClientPort _client;

  @override
  Future<List<Channel>> list() async {
    final raw = await _client.get('/api/channels');

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
