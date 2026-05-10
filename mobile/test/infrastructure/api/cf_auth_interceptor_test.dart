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
    test('injects CF_Authorization cookie when stored', () async {
      final handler = _MockRequestHandler();
      when(() => handler.next(any())).thenAnswer((_) {});
      final interceptor = CfAuthInterceptor(
        serverId: 'srv-1',
        cookieReader: (id) async {
          expect(id, 'srv-1');
          return 'jwt-token';
        },
        onReauthNeeded: () => fail('should not fire on success'),
      );

      final options = RequestOptions(path: '/api/sessions');
      await interceptor.onRequest(options, handler);

      // Default insertion uses HttpHeaders.cookieHeader ('cookie').
      expect(options.headers['cookie'], 'CF_Authorization=jwt-token');
      verify(() => handler.next(options)).called(1);
    });

    test('does not set Cookie header when no token is stored', () async {
      final handler = _MockRequestHandler();
      when(() => handler.next(any())).thenAnswer((_) {});
      final interceptor = CfAuthInterceptor(
        serverId: 'srv-1',
        cookieReader: (_) async => null,
        onReauthNeeded: () {},
      );

      final options = RequestOptions(path: '/api/sessions');
      await interceptor.onRequest(options, handler);

      expect(options.headers.containsKey('cookie'), isFalse);
      verify(() => handler.next(options)).called(1);
    });

    test('does not set Cookie header when stored value is empty', () async {
      final handler = _MockRequestHandler();
      when(() => handler.next(any())).thenAnswer((_) {});
      final interceptor = CfAuthInterceptor(
        serverId: 'srv-1',
        cookieReader: (_) async => '',
        onReauthNeeded: () {},
      );

      final options = RequestOptions(path: '/api/sessions');
      await interceptor.onRequest(options, handler);

      expect(options.headers.containsKey('cookie'), isFalse);
    });

    test('appends CF cookie to existing Cookie header (case-insensitive)',
        () async {
      final handler = _MockRequestHandler();
      when(() => handler.next(any())).thenAnswer((_) {});
      final interceptor = CfAuthInterceptor(
        serverId: 'srv-1',
        cookieReader: (_) async => 'jwt-token',
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

      // Look up via either casing — both should yield the merged value
      // and there should be exactly one cookie entry in the map.
      final cookieKeys = options.headers.keys
          .where((k) => k.toLowerCase() == 'cookie')
          .toList();
      expect(cookieKeys.length, 1);
      expect(
        options.headers[cookieKeys.first],
        'foo=bar; CF_Authorization=jwt-token',
      );
    });

    test('supports synchronous cookieReader return', () async {
      final handler = _MockRequestHandler();
      when(() => handler.next(any())).thenAnswer((_) {});
      final interceptor = CfAuthInterceptor(
        serverId: 'srv-1',
        cookieReader: (_) => 'sync-token',
        onReauthNeeded: () {},
      );

      final options = RequestOptions(path: '/api/sessions');
      await interceptor.onRequest(options, handler);

      expect(options.headers['cookie'], 'CF_Authorization=sync-token');
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
        cookieReader: (_) async => null,
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
        cookieReader: (_) async => null,
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
        cookieReader: (_) async => null,
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
        cookieReader: (_) async => null,
        onReauthNeeded: () => calls += 1,
      );

      final err = buildError(null);
      interceptor.onError(err, handler);

      expect(calls, 0);
      verify(() => handler.next(err)).called(1);
    });
  });
}
