import '../../application/ports/api_client_port.dart';
import '../../application/ports/notifications_port.dart';
import '../../domain/notification.dart';

class NotificationsApi implements NotificationsPort {
  NotificationsApi(this._client);

  final ApiClientPort _client;

  @override
  Future<void> markRead(List<String> ids) async {
    if (ids.isEmpty) return;
    await _client.patch('/api/notifications', body: {'ids': ids});
  }

  @override
  Future<List<AppNotification>> list({String? filter}) async {
    final query = filter == null || filter == 'all' ? '' : '?filter=$filter';
    final raw = await _client.get('/api/notifications$query');
    // Tolerate {notifications: [...]} or [...].
    if (raw is Map<String, dynamic> && raw['notifications'] is List) {
      return (raw['notifications'] as List)
          .cast<Map<String, dynamic>>()
          .map(AppNotification.fromJson)
          .toList(growable: false);
    }
    if (raw is List) {
      return raw
          .cast<Map<String, dynamic>>()
          .map(AppNotification.fromJson)
          .toList(growable: false);
    }
    return const [];
  }

  @override
  Future<void> dismiss(String id) async {
    await _client.delete('/api/notifications/$id');
  }

  @override
  Future<void> markAllRead() async {
    await _client.patch('/api/notifications', body: {'all': true});
  }
}
