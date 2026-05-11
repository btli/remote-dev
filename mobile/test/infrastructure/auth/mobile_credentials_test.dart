import 'package:flutter_test/flutter_test.dart';
import 'package:remote_dev/application/ports/secure_storage_port.dart';
import 'package:remote_dev/infrastructure/auth/mobile_credentials.dart';

class _FakeStorage implements SecureStoragePort {
  final Map<String, String?> data = <String, String?>{};

  String _key(String serverId, String key) => 'server.$serverId.$key';

  @override
  Future<String?> read(String serverId, String key) async =>
      data[_key(serverId, key)];

  @override
  Future<void> write(String serverId, String key, String value) async {
    data[_key(serverId, key)] = value;
  }

  @override
  Future<void> delete(String serverId, String key) async {
    data.remove(_key(serverId, key));
  }

  @override
  Future<void> deleteAll(String serverId) async {
    data.removeWhere((k, _) => k.startsWith('server.$serverId.'));
  }
}

void main() {
  group('MobileCredentialsStore', () {
    test('save writes api_key, cf_token, user_id, user_email', () async {
      final storage = _FakeStorage();
      final store = MobileCredentialsStore(storage);

      await store.save(
        'srv-1',
        const MobileCredentials(
          apiKey: 'sk-abc',
          cfToken: 'jwt-tok',
          userId: 'u1',
          email: 'a@b.com',
        ),
      );

      expect(storage.data['server.srv-1.api_key'], 'sk-abc');
      expect(storage.data['server.srv-1.cf_token'], 'jwt-tok');
      expect(storage.data['server.srv-1.user_id'], 'u1');
      expect(storage.data['server.srv-1.user_email'], 'a@b.com');
      // Mirror to legacy key for back-compat with pre-jch1 readers.
      expect(storage.data['server.srv-1.cf_authorization'], 'jwt-tok');
    });

    test('save with null cfToken does NOT write cf_token or legacy key',
        () async {
      final storage = _FakeStorage();
      final store = MobileCredentialsStore(storage);

      await store.save(
        'srv-2',
        const MobileCredentials(apiKey: 'sk-abc'),
      );

      expect(storage.data['server.srv-2.api_key'], 'sk-abc');
      expect(storage.data.containsKey('server.srv-2.cf_token'), isFalse);
      expect(
        storage.data.containsKey('server.srv-2.cf_authorization'),
        isFalse,
      );
    });

    test('readCfToken falls back to legacy cf_authorization key', () async {
      final storage = _FakeStorage();
      // Simulate a pre-jch1 install where only the legacy key was written.
      storage.data['server.srv-3.cf_authorization'] = 'legacy-jwt';
      final store = MobileCredentialsStore(storage);

      final token = await store.readCfToken('srv-3');
      expect(token, 'legacy-jwt');
    });

    test('readCfToken prefers fresh cf_token when both keys exist', () async {
      final storage = _FakeStorage();
      storage.data['server.srv-4.cf_token'] = 'fresh-jwt';
      storage.data['server.srv-4.cf_authorization'] = 'stale-jwt';
      final store = MobileCredentialsStore(storage);

      expect(await store.readCfToken('srv-4'), 'fresh-jwt');
    });

    test('clear removes every credential key (including legacy)', () async {
      final storage = _FakeStorage();
      final store = MobileCredentialsStore(storage);
      await store.save(
        'srv-5',
        const MobileCredentials(
          apiKey: 'sk',
          cfToken: 'jwt',
          userId: 'u',
          email: 'e',
        ),
      );
      // Also drop a legacy entry manually to ensure clear removes it.
      storage.data['server.srv-5.cf_authorization'] = 'jwt';

      await store.clear('srv-5');

      expect(storage.data.containsKey('server.srv-5.api_key'), isFalse);
      expect(storage.data.containsKey('server.srv-5.cf_token'), isFalse);
      expect(storage.data.containsKey('server.srv-5.user_id'), isFalse);
      expect(storage.data.containsKey('server.srv-5.user_email'), isFalse);
      expect(
        storage.data.containsKey('server.srv-5.cf_authorization'),
        isFalse,
      );
    });

    test('readApiKey / readUserId / readEmail return null when absent',
        () async {
      final storage = _FakeStorage();
      final store = MobileCredentialsStore(storage);
      expect(await store.readApiKey('srv-x'), isNull);
      expect(await store.readUserId('srv-x'), isNull);
      expect(await store.readEmail('srv-x'), isNull);
    });
  });
}
