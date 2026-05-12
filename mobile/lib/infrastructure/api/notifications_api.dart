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
    // Server accepts `?limit=N&unreadOnly=true|false`. Translate the
    // mobile filter enum (`all` / `unread` / `mentions`) to that shape.
    // `mentions` has no server-side concept yet — fall back to listing
    // all notifications so the tab isn't empty.
    final query = (filter == 'unread') ? '?unreadOnly=true' : '';
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
    // Server has no `/api/notifications/:id` route — only the bulk
    // DELETE at the base path with a `{ids: [...]}` body. Wrap the
    // single id in an array so the dismiss button stops 404-ing.
    await _client.delete('/api/notifications', body: {'ids': [id]});
  }

  @override
  Future<void> dismissAll() async {
    // Mirror markAllRead() — the bulk-DELETE endpoint accepts
    // {all: true} to wipe every notification for the current user.
    await _client.delete('/api/notifications', body: {'all': true});
  }

  @override
  Future<void> markAllRead() async {
    await _client.patch('/api/notifications', body: {'all': true});
  }
}
