// Tests for the Task 8 AuthMaterial build paths in RemoteDevClient:
//   - forWorkspace builds merged AuthMaterial from ws authCookies + host authCookies
//   - OIDC workspace (authCookies, no apiKey) yields AuthMaterial with cookies + null apiKey
//   - the host-wide CF_Authorization edge cookie WINS over a stale workspace one
//     of the same name (the host copy is the freshly-harvested canonical JWT);
//     other host cookies (e.g. the supervisor session) are not forwarded
import 'dart:io' show HttpHeaders;
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:remote_dev/application/ports/secure_storage_port.dart';
import 'package:remote_dev/domain/auth_cookie.dart';
import 'package:remote_dev/infrastructure/auth/mobile_credentials.dart';
import 'package:remote_dev/infrastructure/api/remote_dev_client.dart';

class _FakeStorage implements SecureStoragePort {
  final Map<String, String?> data = <String, String?>{};

  String _key(String ns, String key) => 'server.$ns.$key';

  @override
  Future<String?> read(String ns, String key) async => data[_key(ns, key)];

  @override
  Future<void> write(String ns, String key, String value) async {
    data[_key(ns, key)] = value;
  }

  @override
  Future<void> delete(String ns, String key) async {
    data.remove(_key(ns, key));
  }

  @override
  Future<void> deleteAll(String ns) async {
    data.removeWhere((k, _) => k.startsWith('server.$ns.'));
  }
}

/// Adapter that captures the outbound request for assertion.
class _CapturingAdapter implements HttpClientAdapter {
  RequestOptions? captured;

  @override
  void close({bool force = false}) {}

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<dynamic>? cancelFuture,
  ) async {
    captured = options;
    return ResponseBody.fromString(
      '[]',
      200,
      headers: {
        HttpHeaders.contentTypeHeader: ['application/json'],
      },
    );
  }
}

void main() {
  group('RemoteDevClient.forWorkspace — AuthMaterial build (Task 8)', () {
    test(
      'OIDC workspace (authCookies, no apiKey) builds AuthMaterial with cookies + null apiKey',
      () async {
        final storage = _FakeStorage();
        final creds = MobileCredentialsStore(storage);

        // Persist an OIDC workspace: authCookies only, no apiKey.
        const oidcCookie = AuthCookie(
          name: '__Secure-next-auth.session-token',
          value: 'oidc-tok',
          path: '/',
        );
        await creds.setWorkspaceAuthCookies('ws-1', [oidcCookie]);
        // No apiKey written.

        // Host has no authCookies either (OIDC host).
        // (No host cookies = empty list.)

        final adapter = _CapturingAdapter();
        final client = RemoteDevClient.forWorkspace(
          origin: 'https://host.example.com',
          basePath: '/demo',
          hostId: 'host-1',
          workspaceId: 'ws-1',
          storage: storage,
          dio: Dio()..httpClientAdapter = adapter,
        );

        await client.get('/api/sessions');

        final opts = adapter.captured!;
        // Cookie header should contain the OIDC session-token.
        expect(
          opts.headers['cookie'],
          contains('__Secure-next-auth.session-token=oidc-tok'),
        );
        // No Authorization header since no apiKey.
        expect(opts.headers.containsKey('authorization'), isFalse);
      },
    );

    test(
      'CF workspace (authCookies + apiKey) builds AuthMaterial with both',
      () async {
        final storage = _FakeStorage();
        final creds = MobileCredentialsStore(storage);

        const cfCookie = AuthCookie(
          name: 'CF_Authorization',
          value: 'cf-jwt',
          path: '/',
        );
        await creds.setWorkspaceAuthCookies('ws-2', [cfCookie]);
        await creds.setWorkspaceApiKey('ws-2', 'sk-ws');

        final adapter = _CapturingAdapter();
        final client = RemoteDevClient.forWorkspace(
          origin: 'https://host.example.com',
          basePath: '/demo',
          hostId: 'host-1',
          workspaceId: 'ws-2',
          storage: storage,
          dio: Dio()..httpClientAdapter = adapter,
        );

        await client.get('/api/sessions');

        final opts = adapter.captured!;
        expect(opts.headers['authorization'], 'Bearer sk-ws');
        expect(opts.headers['cookie'], contains('CF_Authorization=cf-jwt'));
      },
    );

    test(
      'host CF_Authorization wins over a stale workspace one of the same name',
      () async {
        final storage = _FakeStorage();
        final creds = MobileCredentialsStore(storage);

        // Workspace has a STALE CF_Authorization (e.g. an old ws login).
        await creds.setWorkspaceAuthCookies('ws-3', [
          const AuthCookie(
            name: 'CF_Authorization',
            value: 'old',
            path: '/',
          ),
        ]);
        // Host has the FRESH, canonical edge cookie (harvested from the
        // WebView / refreshed via re-auth).
        await creds.setHostAuthCookies('host-1', [
          const AuthCookie(
            name: 'CF_Authorization',
            value: 'fresh',
            path: '/',
          ),
        ]);

        final adapter = _CapturingAdapter();
        final client = RemoteDevClient.forWorkspace(
          origin: 'https://host.example.com',
          basePath: '/demo',
          hostId: 'host-1',
          workspaceId: 'ws-3',
          storage: storage,
          dio: Dio()..httpClientAdapter = adapter,
        );

        await client.get('/api/sessions');

        final cookie = adapter.captured!.headers['cookie'] as String;
        // The fresh host edge cookie wins; the stale workspace copy is dropped.
        expect(cookie, contains('CF_Authorization=fresh'));
        expect(cookie, isNot(contains('old')));
        // Exactly ONE CF_Authorization is sent (no duplicate).
        expect('CF_Authorization='.allMatches(cookie).length, 1);
      },
    );

    test(
      'host cookies supplement workspace cookies when names differ',
      () async {
        final storage = _FakeStorage();
        final creds = MobileCredentialsStore(storage);

        // Workspace: OIDC session cookie.
        await creds.setWorkspaceAuthCookies('ws-4', [
          const AuthCookie(
            name: '__Secure-next-auth.session-token',
            value: 'oidc-tok',
            path: '/',
          ),
        ]);
        // Host: CF Access cookie (different name, so it supplements).
        await creds.setHostAuthCookies('host-1', [
          const AuthCookie(
            name: 'CF_Authorization',
            value: 'cf-jwt',
            path: '/',
          ),
        ]);

        final adapter = _CapturingAdapter();
        final client = RemoteDevClient.forWorkspace(
          origin: 'https://host.example.com',
          basePath: '/demo',
          hostId: 'host-1',
          workspaceId: 'ws-4',
          storage: storage,
          dio: Dio()..httpClientAdapter = adapter,
        );

        await client.get('/api/sessions');

        final opts = adapter.captured!;
        final cookie = opts.headers['cookie'] as String;
        // Both cookies present.
        expect(
          cookie,
          contains('__Secure-next-auth.session-token=oidc-tok'),
        );
        expect(cookie, contains('CF_Authorization=cf-jwt'));
      },
    );

    test(
      'supervisor app-session host cookie is NOT forwarded to instance requests (scope isolation)',
      () async {
        final storage = _FakeStorage();
        final creds = MobileCredentialsStore(storage);

        // OIDC workspace: the per-instance, slug-scoped session-token.
        await creds.setWorkspaceAuthCookies('ws-5', [
          const AuthCookie(
            name: '__Secure-rdv-demo-session-token',
            value: 'inst-tok',
            path: '/demo',
          ),
        ]);
        // OIDC host: the SUPERVISOR's app-level session cookie. It is NOT an
        // edge/perimeter cookie, so it must never ride along on an instance
        // request (design §7.2 — would leak the supervisor session).
        await creds.setHostAuthCookies('host-1', [
          const AuthCookie(
            name: '__Secure-authjs.session-token',
            value: 'sup-tok',
            path: '/',
          ),
        ]);

        final adapter = _CapturingAdapter();
        final client = RemoteDevClient.forWorkspace(
          origin: 'https://host.example.com',
          basePath: '/demo',
          hostId: 'host-1',
          workspaceId: 'ws-5',
          storage: storage,
          dio: Dio()..httpClientAdapter = adapter,
        );

        await client.get('/api/sessions');

        final cookie = adapter.captured!.headers['cookie'] as String;
        expect(cookie, contains('__Secure-rdv-demo-session-token=inst-tok'));
        // The supervisor session cookie is excluded.
        expect(cookie, isNot(contains('__Secure-authjs.session-token')));
        expect(cookie, isNot(contains('sup-tok')));
      },
    );
  });
}
