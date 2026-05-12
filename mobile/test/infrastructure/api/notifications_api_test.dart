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

  group('markRead()', () {
    test('PATCHes the right path with the ids list', () async {
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

    test('with empty list is a no-op (no API call)', () async {
      await api.markRead(const []);
      verifyNever(() => client.patch(any(), body: any(named: 'body')));
    });
  });

  group('list()', () {
    test('parses wrapped {notifications: [...]} response', () async {
      when(() => client.get('/api/notifications')).thenAnswer(
        (_) async => {
          'notifications': [
            {
              'id': 'n1',
              'title': 'New message',
              'body': 'Hello there',
              'createdAt': '2026-05-08T10:00:00.000Z',
              'read': false,
              'sessionId': 'sess-1',
              'kind': 'message',
            },
            {
              'id': 'n2',
              'title': 'Build done',
              'body': 'Pipeline succeeded',
              'createdAt': '2026-05-08T11:00:00.000Z',
              'read': true,
            },
          ],
        },
      );

      final list = await api.list();

      expect(list, hasLength(2));
      expect(list[0].id, 'n1');
      expect(list[0].read, isFalse);
      expect(list[0].sessionId, 'sess-1');
      expect(list[0].kind, 'message');
      expect(list[1].id, 'n2');
      expect(list[1].read, isTrue);
      expect(list[1].kind, 'default');
    });

    test('parses bare-array response', () async {
      when(() => client.get('/api/notifications')).thenAnswer(
        (_) async => [
          {
            'id': 'n3',
            'title': 'Plain',
            'body': 'Body',
            'createdAt': '2026-05-08T12:00:00.000Z',
          },
        ],
      );

      final list = await api.list();
      expect(list, hasLength(1));
      expect(list[0].id, 'n3');
      expect(list[0].read, isFalse);
    });

    test('ignores the filter param and always fetches the full list',
        () async {
      // Match the PWA mobile-web Notifications tab: fetch every
      // notification once and filter in memory. The `filter` arg is
      // kept for port compatibility but must not change the request.
      when(() => client.get(any())).thenAnswer((_) async => const []);

      await api.list(filter: 'unread');
      await api.list(filter: 'mentions');
      await api.list(filter: 'all');
      await api.list();

      verify(() => client.get('/api/notifications')).called(4);
      verifyNever(() => client.get('/api/notifications?filter=unread'));
      verifyNever(() => client.get('/api/notifications?unreadOnly=true'));
    });

    test('parses the server-side notification type field', () async {
      when(() => client.get('/api/notifications')).thenAnswer(
        (_) async => {
          'notifications': [
            {
              'id': 'n-agent',
              'title': 'Agent waiting',
              'body': 'Idle for 5m',
              'createdAt': '2026-05-08T10:00:00.000Z',
              'type': 'agent_waiting',
            },
            {
              'id': 'n-info',
              'title': '@you mentioned',
              'body': 'see this',
              'createdAt': '2026-05-08T10:00:00.000Z',
              'type': 'info',
            },
            {
              'id': 'n-no-type',
              'title': 'Untyped',
              'body': 'legacy',
              'createdAt': '2026-05-08T10:00:00.000Z',
            },
          ],
        },
      );

      final list = await api.list();
      expect(list[0].type, 'agent_waiting');
      expect(list[1].type, 'info');
      expect(list[2].type, isNull);
    });

    test('returns empty list on unexpected response shape', () async {
      when(() => client.get(any())).thenAnswer((_) async => 'oops');
      final list = await api.list();
      expect(list, isEmpty);
    });
  });

  group('dismiss()', () {
    test('DELETEs /api/notifications with {ids: [id]} body', () async {
      // The server has no `/api/notifications/:id` route — only the
      // bulk DELETE that takes `{ids: [...]}`. Wrap the single id in an
      // array so the dismiss button stops 404-ing on production.
      when(() => client.delete(any(), body: any(named: 'body')))
          .thenAnswer((_) async {});

      await api.dismiss('n1');

      verify(
        () => client.delete(
          '/api/notifications',
          body: {
            'ids': ['n1'],
          },
        ),
      ).called(1);
    });
  });

  group('dismissAll()', () {
    test('DELETEs /api/notifications with {all: true}', () async {
      when(() => client.delete(any(), body: any(named: 'body')))
          .thenAnswer((_) async {});

      await api.dismissAll();

      verify(
        () => client.delete(
          '/api/notifications',
          body: {'all': true},
        ),
      ).called(1);
    });
  });

  group('markAllRead()', () {
    test('PATCHes /api/notifications with {all: true}', () async {
      when(() => client.patch(any(), body: any(named: 'body')))
          .thenAnswer((_) async => null);

      await api.markAllRead();

      verify(
        () => client.patch(
          '/api/notifications',
          body: {'all': true},
        ),
      ).called(1);
    });
  });
}
