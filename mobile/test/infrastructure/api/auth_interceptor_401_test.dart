import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:remote_dev/application/ports/secure_storage_port.dart';
import 'package:remote_dev/infrastructure/api/auth_interceptor.dart';

class _MockStorage extends Mock implements SecureStoragePort {}

class _MockHandler extends Mock implements ErrorInterceptorHandler {}

void main() {
  setUpAll(() {
    registerFallbackValue(RequestOptions(path: '/'));
    registerFallbackValue(
      DioException(requestOptions: RequestOptions(path: '/')),
    );
  });

  test('non-401 errors pass through unchanged', () async {
    final storage = _MockStorage();
    final handler = _MockHandler();
    when(() => handler.next(any())).thenAnswer((_) {});
    final interceptor = AuthInterceptor(
      storage: storage,
      serverId: 'srv-1',
      onUnauthorized: () async => true,
      onReauthRequired: () {},
    );

    final err = DioException(
      requestOptions: RequestOptions(path: '/api/sessions'),
      response: Response(
        requestOptions: RequestOptions(path: '/api/sessions'),
        statusCode: 500,
      ),
    );

    await interceptor.onError(err, handler);

    verify(() => handler.next(err)).called(1);
  });

  test('triggers onUnauthorized for 401, then onReauthRequired after exhaustion',
      () async {
    final storage = _MockStorage();
    final handler = _MockHandler();
    var unauthCalls = 0;
    var reauthCalls = 0;
    when(() => handler.next(any())).thenAnswer((_) {});

    final interceptor = AuthInterceptor(
      storage: storage,
      serverId: 'srv-1',
      onUnauthorized: () async {
        unauthCalls += 1;
        return false; // simulate failure to recapture
      },
      onReauthRequired: () => reauthCalls += 1,
    );

    final err = DioException(
      requestOptions: RequestOptions(path: '/api/sessions'),
      response: Response(
        requestOptions: RequestOptions(path: '/api/sessions'),
        statusCode: 401,
      ),
    );

    await interceptor.onError(err, handler);
    await interceptor.onError(err, handler);
    await interceptor.onError(err, handler);

    expect(unauthCalls, 2);
    expect(reauthCalls, greaterThanOrEqualTo(1));
  });

  test('falls through to onReauthRequired when no onUnauthorized configured',
      () async {
    final storage = _MockStorage();
    final handler = _MockHandler();
    var reauthCalls = 0;
    when(() => handler.next(any())).thenAnswer((_) {});

    final interceptor = AuthInterceptor(
      storage: storage,
      serverId: 'srv-1',
      onReauthRequired: () => reauthCalls += 1,
    );

    final err = DioException(
      requestOptions: RequestOptions(path: '/api/sessions'),
      response: Response(
        requestOptions: RequestOptions(path: '/api/sessions'),
        statusCode: 401,
      ),
    );

    await interceptor.onError(err, handler);

    expect(reauthCalls, 1);
  });
}
