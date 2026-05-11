import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:remote_dev/infrastructure/api/cf_auth_interceptor.dart';

class _MockRequestHandler extends Mock implements RequestInterceptorHandler {}

class _MockErrorHandler extends Mock implements ErrorInterceptorHandler {}

void main() {
  setUpAll(() {
    registerFallbackValue(RequestOptions(path: '/'));
    registerFallbackValue(
      DioException(requestOptions: RequestOptions(path: '/')),
    );
  });

  group('onRequest', () {
    test('attaches Authorization Bearer when api key is stored', () async {
      final handler = _MockRequestHandler();
      when(() => handler.next(any())).thenAnswer((_) {});
      final interceptor = CfAuthInterceptor(
        serverId: 'srv-1',
        authReader: (id) async {
          expect(id, 'srv-1');
          return const AuthMaterial(apiKey: 'sk-abc');
        },
        onReauthNeeded: () => fail('should not fire on success'),
      );

      final options = RequestOptions(path: '/api/sessions');
      await interceptor.onRequest(options, handler);

      expect(options.headers['authorization'], 'Bearer sk-abc');
      expect(options.headers.containsKey('cookie'), isFalse);
      verify(() => handler.next(options)).called(1);
    });

    test('attaches CF cookie when cfCookie is stored', () async {
      final handler = _MockRequestHandler();
      when(() => handler.next(any())).thenAnswer((_) {});
      final interceptor = CfAuthInterceptor(
        serverId: 'srv-1',
        authReader: (_) async => const AuthMaterial(cfCookie: 'jwt-token'),
        onReauthNeeded: () {},
      );

      final options = RequestOptions(path: '/api/sessions');
      await interceptor.onRequest(options, handler);

      expect(options.headers['cookie'], 'CF_Authorization=jwt-token');
      expect(options.headers.containsKey('authorization'), isFalse);
      verify(() => handler.next(options)).called(1);
    });

    test('attaches BOTH bearer key and CF cookie when both are stored',
        () async {
      final handler = _MockRequestHandler();
      when(() => handler.next(any())).thenAnswer((_) {});
      final interceptor = CfAuthInterceptor(
        serverId: 'srv-1',
        authReader: (_) async =>
            const AuthMaterial(apiKey: 'sk-abc', cfCookie: 'jwt-token'),
        onReauthNeeded: () {},
      );

      final options = RequestOptions(path: '/api/sessions');
      await interceptor.onRequest(options, handler);

      expect(options.headers['authorization'], 'Bearer sk-abc');
      expect(options.headers['cookie'], 'CF_Authorization=jwt-token');
    });

    test('does not set any auth header when nothing is stored', () async {
      final handler = _MockRequestHandler();
      when(() => handler.next(any())).thenAnswer((_) {});
      final interceptor = CfAuthInterceptor(
        serverId: 'srv-1',
        authReader: (_) async => const AuthMaterial(),
        onReauthNeeded: () {},
      );

      final options = RequestOptions(path: '/api/sessions');
      await interceptor.onRequest(options, handler);

      expect(options.headers.containsKey('cookie'), isFalse);
      expect(options.headers.containsKey('authorization'), isFalse);
      verify(() => handler.next(options)).called(1);
    });

    test('does not set headers when stored values are empty strings',
        () async {
      final handler = _MockRequestHandler();
      when(() => handler.next(any())).thenAnswer((_) {});
      final interceptor = CfAuthInterceptor(
        serverId: 'srv-1',
        authReader: (_) async => const AuthMaterial(apiKey: '', cfCookie: ''),
        onReauthNeeded: () {},
      );

      final options = RequestOptions(path: '/api/sessions');
      await interceptor.onRequest(options, handler);

      expect(options.headers.containsKey('cookie'), isFalse);
      expect(options.headers.containsKey('authorization'), isFalse);
    });

    test('appends CF cookie to existing Cookie header (case-insensitive)',
        () async {
      final handler = _MockRequestHandler();
      when(() => handler.next(any())).thenAnswer((_) {});
      final interceptor = CfAuthInterceptor(
        serverId: 'srv-1',
        authReader: (_) async => const AuthMaterial(cfCookie: 'jwt-token'),
        onReauthNeeded: () {},
      );

      // Dio normalizes header keys to lowercase internally, so the
      // 'Cookie' key collapses to 'cookie' here. The interceptor
      // appends to the existing slot rather than creating a duplicate.
      final options = RequestOptions(
        path: '/api/sessions',
        headers: {'Cookie': 'foo=bar'},
      );
      await interceptor.onRequest(options, handler);

      final cookieKeys = options.headers.keys
          .where((k) => k.toLowerCase() == 'cookie')
          .toList();
      expect(cookieKeys.length, 1);
      expect(
        options.headers[cookieKeys.first],
        'foo=bar; CF_Authorization=jwt-token',
      );
    });

    test('supports synchronous authReader return', () async {
      final handler = _MockRequestHandler();
      when(() => handler.next(any())).thenAnswer((_) {});
      final interceptor = CfAuthInterceptor(
        serverId: 'srv-1',
        authReader: (_) => const AuthMaterial(apiKey: 'sync-key'),
        onReauthNeeded: () {},
      );

      final options = RequestOptions(path: '/api/sessions');
      await interceptor.onRequest(options, handler);

      expect(options.headers['authorization'], 'Bearer sync-key');
    });
  });

  group('onError', () {
    DioException buildError(int? status) => DioException(
          requestOptions: RequestOptions(path: '/api/sessions'),
          response: status == null
              ? null
              : Response(
                  requestOptions: RequestOptions(path: '/api/sessions'),
                  statusCode: status,
                ),
        );

    test('fires onReauthNeeded on 401', () {
      var calls = 0;
      final handler = _MockErrorHandler();
      when(() => handler.next(any())).thenAnswer((_) {});
      final interceptor = CfAuthInterceptor(
        serverId: 'srv-1',
        authReader: (_) async => const AuthMaterial(),
        onReauthNeeded: () => calls += 1,
      );

      final err = buildError(401);
      interceptor.onError(err, handler);

      expect(calls, 1);
      verify(() => handler.next(err)).called(1);
    });

    test('fires onReauthNeeded on 403', () {
      var calls = 0;
      final handler = _MockErrorHandler();
      when(() => handler.next(any())).thenAnswer((_) {});
      final interceptor = CfAuthInterceptor(
        serverId: 'srv-1',
        authReader: (_) async => const AuthMaterial(),
        onReauthNeeded: () => calls += 1,
      );

      final err = buildError(403);
      interceptor.onError(err, handler);

      expect(calls, 1);
      verify(() => handler.next(err)).called(1);
    });

    test('does not fire onReauthNeeded on 500', () {
      var calls = 0;
      final handler = _MockErrorHandler();
      when(() => handler.next(any())).thenAnswer((_) {});
      final interceptor = CfAuthInterceptor(
        serverId: 'srv-1',
        authReader: (_) async => const AuthMaterial(),
        onReauthNeeded: () => calls += 1,
      );

      final err = buildError(500);
      interceptor.onError(err, handler);

      expect(calls, 0);
      verify(() => handler.next(err)).called(1);
    });

    test('does not fire onReauthNeeded when response is absent (network err)',
        () {
      var calls = 0;
      final handler = _MockErrorHandler();
      when(() => handler.next(any())).thenAnswer((_) {});
      final interceptor = CfAuthInterceptor(
        serverId: 'srv-1',
        authReader: (_) async => const AuthMaterial(),
        onReauthNeeded: () => calls += 1,
      );

      final err = buildError(null);
      interceptor.onError(err, handler);

      expect(calls, 0);
      verify(() => handler.next(err)).called(1);
    });
  });
}
