import '../../application/ports/api_client_port.dart';
import '../../application/ports/notifications_port.dart';

class NotificationsApi implements NotificationsPort {
  NotificationsApi(this._client);

  final ApiClientPort _client;

  @override
  Future<void> markRead(List<String> ids) async {
    if (ids.isEmpty) return;
    await _client.patch('/api/notifications', body: {'ids': ids});
  }
}
