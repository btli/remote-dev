import 'dart:io' show HttpHeaders;

import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:remote_dev/domain/auth_cookie.dart';
import 'package:remote_dev/infrastructure/api/cf_auth_interceptor.dart';
import 'package:dio/dio.dart';

class _MockRequestHandler extends Mock implements RequestInterceptorHandler {}

void main() {
  setUpAll(() {
    registerFallbackValue(RequestOptions(path: '/'));
  });

  group('CfAuthInterceptor — List<AuthCookie> cookies support', () {
    test(
      'attaches multiple cookies as a single Cookie header (name=value; ...)',
      () async {
        final handler = _MockRequestHandler();
        when(() => handler.next(any())).thenAnswer((_) {});

        final interceptor = CfAuthInterceptor(
          dio: Dio(),
          serverId: 'srv-1',
          authReader: (_) async => AuthMaterial(
            cookies: const [
              AuthCookie(name: 'A', value: 'aaa', path: '/'),
              AuthCookie(name: 'B', value: 'bbb', path: '/'),
            ],
          ),
          refreshAuth: (_) async => null,
          onReauthNeeded: () => fail('should not fire'),
        );

        final options = RequestOptions(path: '/api/sessions');
        await interceptor.onRequest(options, handler);

        expect(options.headers['cookie'], 'A=aaa; B=bbb');
        expect(options.headers.containsKey('authorization'), isFalse);
        verify(() => handler.next(options)).called(1);
      },
    );

    test(
      'appends AuthMaterial.cookies to an existing Cookie header',
      () async {
        final handler = _MockRequestHandler();
        when(() => handler.next(any())).thenAnswer((_) {});

        final interceptor = CfAuthInterceptor(
          dio: Dio(),
          serverId: 'srv-1',
          authReader: (_) async => AuthMaterial(
            cookies: const [
              AuthCookie(name: 'X', value: 'xval', path: '/'),
            ],
          ),
          refreshAuth: (_) async => null,
          onReauthNeeded: () {},
        );

        final options = RequestOptions(
          path: '/api/sessions',
          headers: {'Cookie': 'foo=bar'},
        );
        await interceptor.onRequest(options, handler);

        final cookieKeys = options.headers.keys
            .where((k) => k.toLowerCase() == 'cookie')
            .toList();
        expect(cookieKeys.length, 1);
        expect(options.headers[cookieKeys.first], 'foo=bar; X=xval');
      },
    );

    test(
      'attaches Bearer when apiKey is non-null and cookies when both present',
      () async {
        final handler = _MockRequestHandler();
        when(() => handler.next(any())).thenAnswer((_) {});

        final interceptor = CfAuthInterceptor(
          dio: Dio(),
          serverId: 'srv-1',
          authReader: (_) async => AuthMaterial(
            apiKey: 'sk-abc',
            cookies: const [
              AuthCookie(name: 'CF_Authorization', value: 'jwt', path: '/'),
            ],
          ),
          refreshAuth: (_) async => null,
          onReauthNeeded: () {},
        );

        final options = RequestOptions(path: '/api/sessions');
        await interceptor.onRequest(options, handler);

        expect(options.headers['authorization'], 'Bearer sk-abc');
        expect(options.headers['cookie'], 'CF_Authorization=jwt');
      },
    );

    test(
      'no auth headers added when cookies is empty and apiKey is null',
      () async {
        final handler = _MockRequestHandler();
        when(() => handler.next(any())).thenAnswer((_) {});

        final interceptor = CfAuthInterceptor(
          dio: Dio(),
          serverId: 'srv-1',
          authReader: (_) async => AuthMaterial(),
          refreshAuth: (_) async => null,
          onReauthNeeded: () {},
        );

        final options = RequestOptions(path: '/api/sessions');
        await interceptor.onRequest(options, handler);

        expect(options.headers.containsKey('cookie'), isFalse);
        expect(options.headers.containsKey('authorization'), isFalse);
      },
    );

    test(
      'single cookie added correctly',
      () async {
        final handler = _MockRequestHandler();
        when(() => handler.next(any())).thenAnswer((_) {});

        final interceptor = CfAuthInterceptor(
          dio: Dio(),
          serverId: 'srv-1',
          authReader: (_) async => AuthMaterial(
            cookies: const [
              AuthCookie(name: 'session', value: 'tok', path: '/'),
            ],
          ),
          refreshAuth: (_) async => null,
          onReauthNeeded: () {},
        );

        final options = RequestOptions(path: '/api/sessions');
        await interceptor.onRequest(options, handler);

        expect(options.headers[HttpHeaders.cookieHeader], 'session=tok');
      },
    );

    test(
      'isEmpty is true when cookies is empty and apiKey is null',
      () {
        final m = AuthMaterial();
        expect(m.isEmpty, isTrue);
      },
    );

    test(
      'isEmpty is false when cookies list is non-empty',
      () {
        final m = AuthMaterial(
          cookies: const [AuthCookie(name: 'x', value: 'y', path: '/')],
        );
        expect(m.isEmpty, isFalse);
      },
    );

    test(
      'isEmpty is false when apiKey is non-empty',
      () {
        final m = AuthMaterial(apiKey: 'sk');
        expect(m.isEmpty, isFalse);
      },
    );
  });
}
