// Tests for the Cloudflare Access service-token support in CfAuthInterceptor /
// AuthMaterial (remote-dev-2j8g):
//   - both CF-Access-Client-* headers attached when a complete pair is present
//   - the redundant CF_Authorization cookie is EXCLUDED while every other
//     cookie (the instance's OIDC session) is retained
//   - behaviour is unchanged when service creds are absent
//   - a half-populated pair attaches nothing and does not exclude the cookie
//   - isEmpty / hasServiceToken semantics
import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:remote_dev/domain/auth_cookie.dart';
import 'package:remote_dev/infrastructure/api/cf_auth_interceptor.dart';

class _MockRequestHandler extends Mock implements RequestInterceptorHandler {}

void main() {
  setUpAll(() {
    registerFallbackValue(RequestOptions(path: '/'));
  });

  CfAuthInterceptor build(AuthMaterial material) => CfAuthInterceptor(
        dio: Dio(),
        serverId: 'host-1',
        authReader: (_) async => material,
        refreshAuth: (_) async => null,
        onReauthNeeded: () => fail('should not fire'),
      );

  group('CfAuthInterceptor — CF Access service token', () {
    test(
      'attaches both CF-Access-Client-* headers when a complete pair is present',
      () async {
        final handler = _MockRequestHandler();
        when(() => handler.next(any())).thenAnswer((_) {});

        final interceptor = build(
          const AuthMaterial(
            serviceClientId: 'cid.public',
            serviceClientSecret: 'csecret.value',
          ),
        );

        final options = RequestOptions(path: '/api/sessions');
        await interceptor.onRequest(options, handler);

        expect(options.headers['CF-Access-Client-Id'], 'cid.public');
        expect(options.headers['CF-Access-Client-Secret'], 'csecret.value');
        verify(() => handler.next(options)).called(1);
      },
    );

    test(
      'excludes CF_Authorization but KEEPS other cookies when service creds set',
      () async {
        final handler = _MockRequestHandler();
        when(() => handler.next(any())).thenAnswer((_) {});

        final interceptor = build(
          const AuthMaterial(
            serviceClientId: 'cid',
            serviceClientSecret: 'csecret',
            cookies: [
              AuthCookie(name: 'CF_Authorization', value: 'stale-jwt', path: '/'),
              AuthCookie(
                name: '__Secure-next-auth.session-token',
                value: 'oidc-tok',
                path: '/',
              ),
            ],
          ),
        );

        final options = RequestOptions(path: '/api/sessions');
        await interceptor.onRequest(options, handler);

        final cookie = options.headers['cookie'] as String;
        // The redundant edge cookie is dropped (service headers supersede it).
        expect(cookie, isNot(contains('CF_Authorization')));
        expect(cookie, isNot(contains('stale-jwt')));
        // The OIDC session cookie — still required behind the edge — is kept.
        expect(cookie, contains('__Secure-next-auth.session-token=oidc-tok'));
        // Headers still attached alongside the retained cookie.
        expect(options.headers['CF-Access-Client-Id'], 'cid');
        expect(options.headers['CF-Access-Client-Secret'], 'csecret');
      },
    );

    test(
      'when service creds set and CF_Authorization is the only cookie, no Cookie '
      'header is emitted',
      () async {
        final handler = _MockRequestHandler();
        when(() => handler.next(any())).thenAnswer((_) {});

        final interceptor = build(
          const AuthMaterial(
            serviceClientId: 'cid',
            serviceClientSecret: 'csecret',
            cookies: [
              AuthCookie(name: 'CF_Authorization', value: 'jwt', path: '/'),
            ],
          ),
        );

        final options = RequestOptions(path: '/api/sessions');
        await interceptor.onRequest(options, handler);

        // The sole cookie was CF_Authorization → excluded → no Cookie header.
        expect(options.headers.containsKey('cookie'), isFalse);
        expect(options.headers['CF-Access-Client-Id'], 'cid');
      },
    );

    test(
      'behaviour unchanged when service creds are absent (cookie incl. CF_Auth)',
      () async {
        final handler = _MockRequestHandler();
        when(() => handler.next(any())).thenAnswer((_) {});

        final interceptor = build(
          const AuthMaterial(
            apiKey: 'sk-abc',
            cookies: [
              AuthCookie(name: 'CF_Authorization', value: 'jwt', path: '/'),
            ],
          ),
        );

        final options = RequestOptions(path: '/api/sessions');
        await interceptor.onRequest(options, handler);

        // No service token → no headers, and CF_Authorization is sent as before.
        expect(options.headers.containsKey('CF-Access-Client-Id'), isFalse);
        expect(options.headers.containsKey('CF-Access-Client-Secret'), isFalse);
        expect(options.headers['cookie'], 'CF_Authorization=jwt');
        expect(options.headers['authorization'], 'Bearer sk-abc');
      },
    );

    test(
      'a half-populated pair (id only) attaches nothing and keeps CF_Authorization',
      () async {
        final handler = _MockRequestHandler();
        when(() => handler.next(any())).thenAnswer((_) {});

        final interceptor = build(
          const AuthMaterial(
            serviceClientId: 'cid',
            // secret missing → not a usable pair.
            cookies: [
              AuthCookie(name: 'CF_Authorization', value: 'jwt', path: '/'),
            ],
          ),
        );

        final options = RequestOptions(path: '/api/sessions');
        await interceptor.onRequest(options, handler);

        expect(options.headers.containsKey('CF-Access-Client-Id'), isFalse);
        expect(options.headers.containsKey('CF-Access-Client-Secret'), isFalse);
        // No complete pair → cookie is NOT excluded.
        expect(options.headers['cookie'], 'CF_Authorization=jwt');
      },
    );

    group('hasServiceToken / isEmpty semantics', () {
      test('hasServiceToken is true only for a complete non-empty pair', () {
        expect(
          const AuthMaterial(
            serviceClientId: 'i',
            serviceClientSecret: 's',
          ).hasServiceToken,
          isTrue,
        );
        expect(
          const AuthMaterial(serviceClientId: 'i').hasServiceToken,
          isFalse,
        );
        expect(
          const AuthMaterial(serviceClientSecret: 's').hasServiceToken,
          isFalse,
        );
        expect(
          const AuthMaterial(serviceClientId: '', serviceClientSecret: '')
              .hasServiceToken,
          isFalse,
        );
      });

      test('isEmpty is false when a service token is present (no other creds)',
          () {
        expect(
          const AuthMaterial(
            serviceClientId: 'i',
            serviceClientSecret: 's',
          ).isEmpty,
          isFalse,
        );
      });

      test('isEmpty is true when only a half-pair is present', () {
        expect(const AuthMaterial(serviceClientId: 'i').isEmpty, isTrue);
        expect(const AuthMaterial(serviceClientSecret: 's').isEmpty, isTrue);
      });
    });
  });
}
