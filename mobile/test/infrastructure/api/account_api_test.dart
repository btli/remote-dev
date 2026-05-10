import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:remote_dev/application/ports/api_client_port.dart';
import 'package:remote_dev/infrastructure/api/account_api.dart';

class _MockApiClient extends Mock implements ApiClientPort {}

void main() {
  late _MockApiClient client;
  late AccountApi api;

  setUp(() {
    client = _MockApiClient();
    api = AccountApi(client);
  });

  group('me()', () {
    test('parses NextAuth-shaped {user: {...}, expires} response', () async {
      when(() => client.get('/api/auth/session')).thenAnswer(
        (_) async => {
          'user': {
            'email': 'jane@example.com',
            'name': 'Jane Doe',
            'image': 'https://avatars.example/jane.png',
          },
          'expires': '2026-12-31T23:59:59.000Z',
        },
      );

      final account = await api.me();

      expect(account.email, 'jane@example.com');
      expect(account.name, 'Jane Doe');
      expect(account.image, 'https://avatars.example/jane.png');
    });

    test('parses bare {email, name, image} response', () async {
      when(() => client.get('/api/auth/session')).thenAnswer(
        (_) async => {
          'email': 'bare@example.com',
          'name': 'Bare User',
        },
      );

      final account = await api.me();

      expect(account.email, 'bare@example.com');
      expect(account.name, 'Bare User');
      expect(account.image, isNull);
    });

    test('drops empty-string name and image to null', () async {
      when(() => client.get('/api/auth/session')).thenAnswer(
        (_) async => {
          'user': {'email': 'minimal@example.com', 'name': '', 'image': ''},
        },
      );

      final account = await api.me();

      expect(account.email, 'minimal@example.com');
      expect(account.name, isNull);
      expect(account.image, isNull);
    });

    test('throws StateError on empty session map', () async {
      when(() => client.get('/api/auth/session'))
          .thenAnswer((_) async => <String, dynamic>{});

      expect(api.me(), throwsA(isA<StateError>()));
    });

    test('throws StateError on null session response', () async {
      when(() => client.get('/api/auth/session')).thenAnswer((_) async => null);

      expect(api.me(), throwsA(isA<StateError>()));
    });

    test('throws FormatException when email is missing', () async {
      when(() => client.get('/api/auth/session')).thenAnswer(
        (_) async => {
          'user': {'name': 'No Email'},
        },
      );

      expect(api.me(), throwsA(isA<FormatException>()));
    });

    test('throws FormatException on unexpected scalar response', () async {
      when(() => client.get('/api/auth/session'))
          .thenAnswer((_) async => 'oops');

      expect(api.me(), throwsA(isA<FormatException>()));
    });
  });
}
