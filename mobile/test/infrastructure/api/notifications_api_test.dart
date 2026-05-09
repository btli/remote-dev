import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:remote_dev/application/ports/api_client_port.dart';
import 'package:remote_dev/infrastructure/api/notifications_api.dart';

class _MockClient extends Mock implements ApiClientPort {}

void main() {
  setUpAll(() {
    registerFallbackValue(<String, dynamic>{});
  });

  late _MockClient client;
  late NotificationsApi api;

  setUp(() {
    client = _MockClient();
    api = NotificationsApi(client);
  });

  test('markRead PATCHes the right path with the ids list', () async {
    when(() => client.patch(any(), body: any(named: 'body')))
        .thenAnswer((_) async => null);

    await api.markRead(['n1', 'n2']);

    verify(
      () => client.patch(
        '/api/notifications',
        body: {
          'ids': ['n1', 'n2'],
        },
      ),
    ).called(1);
  });

  test('markRead with empty list is a no-op (no API call)', () async {
    await api.markRead(const []);
    verifyNever(() => client.patch(any(), body: any(named: 'body')));
  });
}
