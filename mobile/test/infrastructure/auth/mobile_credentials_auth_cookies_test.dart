import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:remote_dev/application/ports/secure_storage_port.dart';
import 'package:remote_dev/domain/auth_cookie.dart';
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
  group('MobileCredentialsStore — authCookies', () {
    // -----------------------------------------------------------------------
    // Host authCookies
    // -----------------------------------------------------------------------

    test('setHostAuthCookies / getHostAuthCookies round-trips a non-empty list',
        () async {
      final storage = _FakeStorage();
      final store = MobileCredentialsStore(storage);

      final cookies = [
        const AuthCookie(name: '__Secure-next-auth.session-token', value: 'tok', path: '/'),
        const AuthCookie(name: 'CF_Authorization', value: 'cf-jwt', path: '/'),
      ];
      await store.setHostAuthCookies('host-1', cookies);

      final retrieved = await store.getHostAuthCookies('host-1');
      expect(retrieved.length, 2);
      expect(retrieved[0].name, '__Secure-next-auth.session-token');
      expect(retrieved[0].value, 'tok');
      expect(retrieved[1].name, 'CF_Authorization');
    });

    test('setHostAuthCookies stores JSON at the authCookies sub-key', () async {
      final storage = _FakeStorage();
      final store = MobileCredentialsStore(storage);

      await store.setHostAuthCookies('host-2', [
        const AuthCookie(name: 'X', value: 'y', path: '/'),
      ]);

      // The raw key is: host.<hostId>.authCookies
      final rawKey = 'server.host.host-2.authCookies';
      expect(storage.data.containsKey(rawKey), isTrue);
      final decoded = jsonDecode(storage.data[rawKey]!) as List;
      expect(decoded.length, 1);
      expect((decoded[0] as Map<String, dynamic>)['name'], 'X');
    });

    test('getHostAuthCookies returns [] when no entry exists', () async {
      final storage = _FakeStorage();
      final store = MobileCredentialsStore(storage);

      final cookies = await store.getHostAuthCookies('missing-host');
      expect(cookies, isEmpty);
    });

    test(
      'getHostAuthCookies falls back to legacy cfToken when authCookies absent',
      () async {
        final storage = _FakeStorage();
        // Simulate a pre-Task7 install: only cfToken written.
        storage.data['server.host.legacy-host.cfToken'] = 'legacy-jwt';
        final store = MobileCredentialsStore(storage);

        final cookies = await store.getHostAuthCookies('legacy-host');
        expect(cookies.length, 1);
        expect(cookies[0].name, 'CF_Authorization');
        expect(cookies[0].value, 'legacy-jwt');
        expect(cookies[0].path, '/');
      },
    );

    test(
      'getHostAuthCookies prefers stored authCookies over legacy cfToken',
      () async {
        final storage = _FakeStorage();
        // Both keys present — new one wins.
        storage.data['server.host.h1.authCookies'] =
            jsonEncode([{'name': 'session', 'value': 'new', 'path': '/'}]);
        storage.data['server.host.h1.cfToken'] = 'old-jwt';
        final store = MobileCredentialsStore(storage);

        final cookies = await store.getHostAuthCookies('h1');
        expect(cookies.length, 1);
        expect(cookies[0].name, 'session');
        expect(cookies[0].value, 'new');
      },
    );

    // -----------------------------------------------------------------------
    // Workspace authCookies
    // -----------------------------------------------------------------------

    test(
      'setWorkspaceAuthCookies / getWorkspaceAuthCookies round-trips',
      () async {
        final storage = _FakeStorage();
        final store = MobileCredentialsStore(storage);

        final cookies = [
          const AuthCookie(name: '__Secure-next-auth.session-token', value: 'ws-tok', path: '/'),
        ];
        await store.setWorkspaceAuthCookies('ws-1', cookies);

        final retrieved = await store.getWorkspaceAuthCookies('ws-1');
        expect(retrieved.length, 1);
        expect(retrieved[0].name, '__Secure-next-auth.session-token');
        expect(retrieved[0].value, 'ws-tok');
      },
    );

    test('getWorkspaceAuthCookies returns [] when absent', () async {
      final storage = _FakeStorage();
      final store = MobileCredentialsStore(storage);

      expect(await store.getWorkspaceAuthCookies('no-ws'), isEmpty);
    });

    test(
      'getWorkspaceAuthCookies falls back to legacy workspace apiKey cfToken path',
      () async {
        final storage = _FakeStorage();
        // Simulate a pre-Task7 workspace install: cfToken not stored at workspace
        // level (there never was one). But there may be a host-level cfToken.
        // Per spec: no workspace cfToken key exists historically; workspace
        // fallback is to return []. Let's verify the empty fallback.
        final store = MobileCredentialsStore(storage);

        final cookies = await store.getWorkspaceAuthCookies('legacy-ws');
        expect(cookies, isEmpty);
      },
    );

    // -----------------------------------------------------------------------
    // Existing apiKey methods still work
    // -----------------------------------------------------------------------

    test('setWorkspaceApiKey / getWorkspaceApiKey still work after Task7',
        () async {
      final storage = _FakeStorage();
      final store = MobileCredentialsStore(storage);

      await store.setWorkspaceApiKey('ws-api', 'sk-xyz');
      expect(await store.getWorkspaceApiKey('ws-api'), 'sk-xyz');
    });

    test('setHostCfToken / getHostCfToken still work after Task7', () async {
      final storage = _FakeStorage();
      final store = MobileCredentialsStore(storage);

      await store.setHostCfToken('h-cf', 'jwt-val');
      expect(await store.getHostCfToken('h-cf'), 'jwt-val');
    });
  });
}
