import 'package:flutter_inappwebview/flutter_inappwebview.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:remote_dev/infrastructure/webview/webview_cookie_seeder.dart';

class _MockCookieManager extends Mock implements CookieManager {}

void main() {
  setUpAll(() {
    registerFallbackValue(WebUri('https://example.com'));
  });

  group('WebViewCookieSeeder.seedCfCookie', () {
    test(
      'calls CookieManager.setCookie with the right args when a value is given',
      () async {
        final cm = _MockCookieManager();
        when(
          () => cm.setCookie(
            url: any(named: 'url'),
            name: any(named: 'name'),
            value: any(named: 'value'),
            isSecure: any(named: 'isSecure'),
            isHttpOnly: any(named: 'isHttpOnly'),
            expiresDate: any(named: 'expiresDate'),
          ),
        ).thenAnswer((_) async => true);

        final seeder = WebViewCookieSeeder(cookieManager: cm);
        final ok = await seeder.seedCfCookie(
          serverOrigin: Uri.parse('https://dev.example.com'),
          value: 'jwt-token',
        );

        expect(ok, isTrue);
        verify(
          () => cm.setCookie(
            url: any(named: 'url'),
            name: 'CF_Authorization',
            value: 'jwt-token',
            isSecure: true,
            isHttpOnly: true,
            expiresDate: any(named: 'expiresDate'),
          ),
        ).called(1);
      },
    );

    test('is a no-op when value is null', () async {
      final cm = _MockCookieManager();
      final seeder = WebViewCookieSeeder(cookieManager: cm);
      final ok = await seeder.seedCfCookie(
        serverOrigin: Uri.parse('https://dev.example.com'),
        value: null,
      );
      expect(ok, isFalse);
      verifyNever(
        () => cm.setCookie(
          url: any(named: 'url'),
          name: any(named: 'name'),
          value: any(named: 'value'),
        ),
      );
    });

    test('is a no-op when value is empty', () async {
      final cm = _MockCookieManager();
      final seeder = WebViewCookieSeeder(cookieManager: cm);
      final ok = await seeder.seedCfCookie(
        serverOrigin: Uri.parse('https://dev.example.com'),
        value: '',
      );
      expect(ok, isFalse);
      verifyNever(
        () => cm.setCookie(
          url: any(named: 'url'),
          name: any(named: 'name'),
          value: any(named: 'value'),
        ),
      );
    });

    test('returns false when CookieManager throws', () async {
      final cm = _MockCookieManager();
      when(
        () => cm.setCookie(
          url: any(named: 'url'),
          name: any(named: 'name'),
          value: any(named: 'value'),
          isSecure: any(named: 'isSecure'),
          isHttpOnly: any(named: 'isHttpOnly'),
          expiresDate: any(named: 'expiresDate'),
        ),
      ).thenThrow(Exception('platform unavailable'));

      final seeder = WebViewCookieSeeder(cookieManager: cm);
      final ok = await seeder.seedCfCookie(
        serverOrigin: Uri.parse('https://dev.example.com'),
        value: 'jwt-token',
      );
      expect(ok, isFalse);
    });
  });
}
