import 'package:flutter_test/flutter_test.dart';
import 'package:remote_dev/infrastructure/push/fcm_push_service.dart';

void main() {
  test('getToken returns null before initialize', () async {
    final service = FcmPushService();
    expect(await service.getToken(), isNull);
  });

  test('onTokenRefresh emits empty stream before initialize', () async {
    final service = FcmPushService();
    expect(await service.onTokenRefresh.toList(), isEmpty);
  });

  test('deleteToken does not throw before initialize', () async {
    final service = FcmPushService();
    await service.deleteToken(); // should silently no-op
  });
}
