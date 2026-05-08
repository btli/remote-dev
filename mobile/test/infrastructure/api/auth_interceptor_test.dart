import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:remote_dev/application/ports/secure_storage_port.dart';
import 'package:remote_dev/infrastructure/api/auth_interceptor.dart';

class _MockStorage extends Mock implements SecureStoragePort {}

class _MockHandler extends Mock implements RequestInterceptorHandler {}

void main() {
  late _MockStorage storage;
  late _MockHandler handler;
  late AuthInterceptor interceptor;

  setUp(() {
    storage = _MockStorage();
    handler = _MockHandler();
    interceptor = AuthInterceptor(storage: storage, serverId: 'srv-1');
    when(() => handler.next(any())).thenAnswer((_) {});
  });

  setUpAll(() {
    registerFallbackValue(RequestOptions(path: '/'));
  });

  test('injects CF_Authorization cookie when stored', () async {
    when(() => storage.read('srv-1', 'cf_authorization'))
        .thenAnswer((_) async => 'jwt-token');
    final options = RequestOptions(path: '/api/sessions');

    await interceptor.onRequest(options, handler);

    expect(options.headers['Cookie'], 'CF_Authorization=jwt-token');
    verify(() => handler.next(options)).called(1);
  });

  test('does not set Cookie header when no token is stored', () async {
    when(() => storage.read('srv-1', 'cf_authorization'))
        .thenAnswer((_) async => null);
    final options = RequestOptions(path: '/api/sessions');

    await interceptor.onRequest(options, handler);

    expect(options.headers.containsKey('Cookie'), isFalse);
    verify(() => handler.next(options)).called(1);
  });

  test('appends to existing Cookie header', () async {
    when(() => storage.read('srv-1', 'cf_authorization'))
        .thenAnswer((_) async => 'jwt-token');
    final options = RequestOptions(
      path: '/api/sessions',
      headers: {'Cookie': 'foo=bar'},
    );

    await interceptor.onRequest(options, handler);

    expect(options.headers['Cookie'], 'foo=bar; CF_Authorization=jwt-token');
  });
}
