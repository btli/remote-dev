import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:remote_dev/application/ports/api_client_port.dart';
import 'package:remote_dev/infrastructure/api/github_accounts_api.dart';

class _MockApiClient extends Mock implements ApiClientPort {}

void main() {
  late _MockApiClient client;
  late GitHubAccountsApi api;

  setUp(() {
    client = _MockApiClient();
    api = GitHubAccountsApi(client);
  });

  group('list()', () {
    test('parses wrapped {accounts: [...]} response (server default shape)',
        () async {
      when(() => client.get('/api/github/accounts')).thenAnswer(
        (_) async => {
          'accounts': [
            {
              'providerAccountId': '123',
              'login': 'octocat',
              'avatarUrl': 'https://avatars.example/octocat.png',
              'isDefault': true,
            },
            {
              'providerAccountId': '456',
              'login': 'hubot',
              'avatarUrl': null,
              'isDefault': false,
            },
          ],
          'folderBindings': <String, String>{},
        },
      );

      final accounts = await api.list();
      expect(accounts, hasLength(2));
      expect(accounts[0].id, '123');
      expect(accounts[0].login, 'octocat');
      expect(accounts[0].avatarUrl, 'https://avatars.example/octocat.png');
      expect(accounts[0].isDefault, isTrue);
      expect(accounts[1].id, '456');
      expect(accounts[1].avatarUrl, isNull);
      expect(accounts[1].isDefault, isFalse);
    });

    test('parses bare array response', () async {
      when(() => client.get('/api/github/accounts')).thenAnswer(
        (_) async => [
          {
            'id': 'abc',
            'login': 'lone',
            'avatarUrl': '',
            'isDefault': false,
          },
        ],
      );

      final accounts = await api.list();
      expect(accounts, hasLength(1));
      expect(accounts.single.id, 'abc');
      // Empty avatar string should normalize to null so the UI can branch
      // on `avatarUrl == null` without also checking for empties.
      expect(accounts.single.avatarUrl, isNull);
    });

    test('throws FormatException on unrecognized response shape', () async {
      when(() => client.get('/api/github/accounts'))
          .thenAnswer((_) async => 'oops');
      expect(api.list(), throwsA(isA<FormatException>()));
    });

    test('throws FormatException when an entry is missing both id keys',
        () async {
      when(() => client.get('/api/github/accounts')).thenAnswer(
        (_) async => {
          'accounts': [
            {'login': 'orphan', 'isDefault': false},
          ],
        },
      );
      expect(api.list(), throwsA(isA<FormatException>()));
    });
  });

  group('setDefault()', () {
    test('sends PATCH to /api/github/accounts/:id with action discriminator',
        () async {
      when(
        () => client.patch(
          any(),
          body: any(named: 'body'),
        ),
      ).thenAnswer((_) async => {'success': true});

      await api.setDefault('123');

      final capturedPath = verify(
        () => client.patch(
          captureAny(),
          body: captureAny(named: 'body'),
        ),
      ).captured;
      expect(capturedPath[0], '/api/github/accounts/123');
      // The current server contract uses an action discriminator rather
      // than a property-style body — assert that explicitly so a future
      // server change forces this test to fail loudly.
      expect(capturedPath[1], {'action': 'set-default'});
    });
  });

  group('unlink()', () {
    test('sends DELETE to /api/github/accounts/:id', () async {
      when(() => client.delete(any())).thenAnswer((_) async {});

      await api.unlink('456');

      verify(() => client.delete('/api/github/accounts/456')).called(1);
    });
  });
}
