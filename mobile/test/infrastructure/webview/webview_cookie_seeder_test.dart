import 'package:flutter_inappwebview/flutter_inappwebview.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:remote_dev/domain/auth_cookie.dart';
import 'package:remote_dev/infrastructure/webview/webview_cookie_seeder.dart';

class _MockCookieManager extends Mock implements CookieManager {}

void main() {
  setUpAll(() {
    registerFallbackValue(WebUri('https://example.com'));
  });

  group('WebViewCookieSeeder.seedAuthCookies', () {
    test(
      'sets each cookie with its name/value/path + Secure/HttpOnly/SameSite=Lax',
      () async {
        final cm = _MockCookieManager();
        when(
          () => cm.setCookie(
            url: any(named: 'url'),
            name: any(named: 'name'),
            value: any(named: 'value'),
            path: any(named: 'path'),
            isSecure: any(named: 'isSecure'),
            isHttpOnly: any(named: 'isHttpOnly'),
            sameSite: any(named: 'sameSite'),
            expiresDate: any(named: 'expiresDate'),
          ),
        ).thenAnswer((_) async => true);

        final seeder = WebViewCookieSeeder(cookieManager: cm);
        await seeder.seedAuthCookies(
          serverOrigin: Uri.parse('https://dev.example.com'),
          cookies: const [
            AuthCookie(
              name: '__Secure-rdv-demo-session-token',
              value: 'sess',
              path: '/demo',
            ),
          ],
        );

        verify(
          () => cm.setCookie(
            url: any(named: 'url'),
            name: '__Secure-rdv-demo-session-token',
            value: 'sess',
            path: '/demo',
            isSecure: true,
            isHttpOnly: true,
            sameSite: HTTPCookieSameSitePolicy.LAX,
            expiresDate: any(named: 'expiresDate'),
          ),
        ).called(1);
      },
    );

    test('seeds one cookie per entry and skips empty-valued cookies', () async {
      final cm = _MockCookieManager();
      when(
        () => cm.setCookie(
          url: any(named: 'url'),
          name: any(named: 'name'),
          value: any(named: 'value'),
          path: any(named: 'path'),
          isSecure: any(named: 'isSecure'),
          isHttpOnly: any(named: 'isHttpOnly'),
          sameSite: any(named: 'sameSite'),
          expiresDate: any(named: 'expiresDate'),
        ),
      ).thenAnswer((_) async => true);

      final seeder = WebViewCookieSeeder(cookieManager: cm);
      await seeder.seedAuthCookies(
        serverOrigin: Uri.parse('https://dev.example.com'),
        cookies: const [
          AuthCookie(name: 'CF_Authorization', value: 'cf', path: '/'),
          AuthCookie(name: 'empty', value: '', path: '/'),
          AuthCookie(
            name: '__Secure-rdv-demo-session-token',
            value: 'sess',
            path: '/demo',
          ),
        ],
      );

      verify(
        () => cm.setCookie(
          url: any(named: 'url'),
          name: 'CF_Authorization',
          value: 'cf',
          path: '/',
          isSecure: any(named: 'isSecure'),
          isHttpOnly: any(named: 'isHttpOnly'),
          sameSite: any(named: 'sameSite'),
          expiresDate: any(named: 'expiresDate'),
        ),
      ).called(1);
      verify(
        () => cm.setCookie(
          url: any(named: 'url'),
          name: '__Secure-rdv-demo-session-token',
          value: 'sess',
          path: '/demo',
          isSecure: any(named: 'isSecure'),
          isHttpOnly: any(named: 'isHttpOnly'),
          sameSite: any(named: 'sameSite'),
          expiresDate: any(named: 'expiresDate'),
        ),
      ).called(1);
      // The empty-valued cookie is skipped.
      verifyNever(
        () => cm.setCookie(
          url: any(named: 'url'),
          name: 'empty',
          value: any(named: 'value'),
          path: any(named: 'path'),
          isSecure: any(named: 'isSecure'),
          isHttpOnly: any(named: 'isHttpOnly'),
          sameSite: any(named: 'sameSite'),
          expiresDate: any(named: 'expiresDate'),
        ),
      );
    });

    test('is non-fatal when CookieManager throws', () async {
      final cm = _MockCookieManager();
      when(
        () => cm.setCookie(
          url: any(named: 'url'),
          name: any(named: 'name'),
          value: any(named: 'value'),
          path: any(named: 'path'),
          isSecure: any(named: 'isSecure'),
          isHttpOnly: any(named: 'isHttpOnly'),
          sameSite: any(named: 'sameSite'),
          expiresDate: any(named: 'expiresDate'),
        ),
      ).thenThrow(Exception('platform unavailable'));

      final seeder = WebViewCookieSeeder(cookieManager: cm);
      // Must not throw — per-cookie failures are swallowed + logged.
      await seeder.seedAuthCookies(
        serverOrigin: Uri.parse('https://dev.example.com'),
        cookies: const [
          AuthCookie(name: 'CF_Authorization', value: 'cf', path: '/'),
        ],
      );
    });
  });

  group('WebViewCookieSeeder.deleteAuthCookies', () {
    test('deletes each cookie by name + path', () async {
      final cm = _MockCookieManager();
      when(
        () => cm.deleteCookie(
          url: any(named: 'url'),
          name: any(named: 'name'),
          path: any(named: 'path'),
        ),
      ).thenAnswer((_) async => true);

      final seeder = WebViewCookieSeeder(cookieManager: cm);
      await seeder.deleteAuthCookies(
        serverOrigin: Uri.parse('https://dev.example.com'),
        cookies: const [
          AuthCookie(
            name: '__Secure-rdv-demo-session-token',
            value: 'sess',
            path: '/demo',
          ),
        ],
      );

      verify(
        () => cm.deleteCookie(
          url: any(named: 'url'),
          name: '__Secure-rdv-demo-session-token',
          path: '/demo',
        ),
      ).called(1);
    });
  });
}
