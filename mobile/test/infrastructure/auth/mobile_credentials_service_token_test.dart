// Tests for the per-host Cloudflare Access service token store API
// (remote-dev-2j8g):
//   - setHostServiceToken / getHostServiceToken round-trips a complete pair
//   - clearHostServiceToken removes both halves and leaves other host creds
//   - getHostServiceToken reports "unset" (null) for a missing or partial pair
//   - the secret never leaks via CfServiceToken.toString
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
  group('MobileCredentialsStore — host CF Access service token', () {
    test('setHostServiceToken / getHostServiceToken round-trips a pair',
        () async {
      final storage = _FakeStorage();
      final store = MobileCredentialsStore(storage);

      await store.setHostServiceToken(
        'host-1',
        clientId: 'cid.abc',
        clientSecret: 'csecret.xyz',
      );

      final token = await store.getHostServiceToken('host-1');
      expect(token, isNotNull);
      expect(token!.clientId, 'cid.abc');
      expect(token.clientSecret, 'csecret.xyz');
    });

    test('setHostServiceToken stores both halves under the host namespace',
        () async {
      final storage = _FakeStorage();
      final store = MobileCredentialsStore(storage);

      await store.setHostServiceToken(
        'host-2',
        clientId: 'cid',
        clientSecret: 'csecret',
      );

      // Raw keys are: host.<hostId>.cfServiceClientId / .cfServiceClientSecret
      expect(storage.data['server.host.host-2.cfServiceClientId'], 'cid');
      expect(
        storage.data['server.host.host-2.cfServiceClientSecret'],
        'csecret',
      );
    });

    test('getHostServiceToken returns null when nothing is stored', () async {
      final storage = _FakeStorage();
      final store = MobileCredentialsStore(storage);

      expect(await store.getHostServiceToken('missing'), isNull);
    });

    test('getHostServiceToken returns null when only the client id is present',
        () async {
      final storage = _FakeStorage();
      // Half-written pair: id only. A service token is only usable as a pair.
      storage.data['server.host.partial.cfServiceClientId'] = 'cid';
      final store = MobileCredentialsStore(storage);

      expect(await store.getHostServiceToken('partial'), isNull);
    });

    test('getHostServiceToken returns null when only the secret is present',
        () async {
      final storage = _FakeStorage();
      storage.data['server.host.partial2.cfServiceClientSecret'] = 'csecret';
      final store = MobileCredentialsStore(storage);

      expect(await store.getHostServiceToken('partial2'), isNull);
    });

    test('getHostServiceToken treats empty strings as unset', () async {
      final storage = _FakeStorage();
      final store = MobileCredentialsStore(storage);

      await store.setHostServiceToken(
        'host-empty',
        clientId: '',
        clientSecret: '',
      );

      expect(await store.getHostServiceToken('host-empty'), isNull);
    });

    test('clearHostServiceToken removes both halves', () async {
      final storage = _FakeStorage();
      final store = MobileCredentialsStore(storage);

      await store.setHostServiceToken(
        'host-3',
        clientId: 'cid',
        clientSecret: 'csecret',
      );
      await store.clearHostServiceToken('host-3');

      expect(await store.getHostServiceToken('host-3'), isNull);
      expect(
        storage.data.containsKey('server.host.host-3.cfServiceClientId'),
        isFalse,
      );
      expect(
        storage.data.containsKey('server.host.host-3.cfServiceClientSecret'),
        isFalse,
      );
    });

    test(
      'clearHostServiceToken leaves other host credentials untouched',
      () async {
        final storage = _FakeStorage();
        final store = MobileCredentialsStore(storage);

        await store.setHostCfToken('host-4', 'cf-jwt');
        await store.setHostServiceToken(
          'host-4',
          clientId: 'cid',
          clientSecret: 'csecret',
        );

        await store.clearHostServiceToken('host-4');

        // The CF cookie/token is a different credential and must survive.
        expect(await store.getHostCfToken('host-4'), 'cf-jwt');
        expect(await store.getHostServiceToken('host-4'), isNull);
      },
    );

    test('clearHost also drops the service token', () async {
      final storage = _FakeStorage();
      final store = MobileCredentialsStore(storage);

      await store.setHostServiceToken(
        'host-5',
        clientId: 'cid',
        clientSecret: 'csecret',
      );
      await store.clearHost('host-5');

      expect(await store.getHostServiceToken('host-5'), isNull);
    });

    test('CfServiceToken.toString never reveals the secret or id', () {
      const token = CfServiceToken(
        clientId: 'cid-public',
        clientSecret: 'super-secret-value',
      );

      final str = token.toString();
      expect(str, isNot(contains('super-secret-value')));
      expect(str, isNot(contains('cid-public')));
    });

    test('CfServiceToken value equality', () {
      const a = CfServiceToken(clientId: 'i', clientSecret: 's');
      const b = CfServiceToken(clientId: 'i', clientSecret: 's');
      const c = CfServiceToken(clientId: 'i', clientSecret: 'other');
      expect(a, equals(b));
      expect(a, isNot(equals(c)));
    });
  });
}
