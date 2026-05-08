import 'package:flutter_inappwebview/flutter_inappwebview.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:remote_dev/application/ports/secure_storage_port.dart';
import 'package:remote_dev/infrastructure/auth/cookie_reader.dart';

class _MockCookieManager extends Mock implements CookieManager {}

class _MockStorage extends Mock implements SecureStoragePort {}

void main() {
  setUpAll(() {
    registerFallbackValue(WebUri('https://example.com'));
  });

  test('returns the CF_Authorization cookie when present', () async {
    final cm = _MockCookieManager();
    final storage = _MockStorage();
    when(() => cm.getCookies(url: any(named: 'url'))).thenAnswer(
      (_) async => [
        Cookie(name: 'other', value: 'x'),
        Cookie(name: 'CF_Authorization', value: 'jwt-token'),
      ],
    );
    final reader = CookieReader(storage: storage, cookieManager: cm);

    final result = await reader.readCookie(
      origin: 'https://example.com',
      name: 'CF_Authorization',
    );

    expect(result, 'jwt-token');
  });

  test('retries when cookie is initially absent and persists on success',
      () async {
    final cm = _MockCookieManager();
    final storage = _MockStorage();
    var call = 0;
    when(() => cm.getCookies(url: any(named: 'url'))).thenAnswer((_) async {
      call += 1;
      return call >= 2
          ? [Cookie(name: 'CF_Authorization', value: 'jwt-token')]
          : <Cookie>[];
    });
    when(() => storage.write(any(), any(), any())).thenAnswer((_) async {});
    final reader = CookieReader(storage: storage, cookieManager: cm);

    final ok = await reader.captureCfAuthorization(
      serverId: 'srv-1',
      serverOrigin: Uri.parse('https://example.com'),
    );

    expect(ok, isTrue);
    verify(() => storage.write('srv-1', 'cf_authorization', 'jwt-token'))
        .called(1);
  });

  test('returns null after exhausting retries', () async {
    final cm = _MockCookieManager();
    final storage = _MockStorage();
    when(() => cm.getCookies(url: any(named: 'url')))
        .thenAnswer((_) async => <Cookie>[]);
    final reader = CookieReader(storage: storage, cookieManager: cm);

    final result = await reader.readCookie(
      origin: 'https://example.com',
      name: 'CF_Authorization',
    );

    expect(result, isNull);
  });
}
