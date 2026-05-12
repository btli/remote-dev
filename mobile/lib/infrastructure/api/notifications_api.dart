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
    // Match the PWA mobile-web approach (see
    // `src/components/mobile/notifications/NotificationsTab.tsx`): always
    // fetch the full list and let the caller apply `unread` / `mentions`
    // filtering in memory. The `filter` parameter is accepted for
    // interface compatibility but intentionally ignored — server-side
    // filtering would break the Mentions tab (no server concept) and
    // make the chip counts inconsistent.
    final raw = await _client.get('/api/notifications');
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
