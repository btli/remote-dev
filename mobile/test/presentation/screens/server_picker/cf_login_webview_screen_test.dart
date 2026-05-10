import 'package:flutter_inappwebview/flutter_inappwebview.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:remote_dev/presentation/screens/server_picker/cf_login_webview_screen.dart';

void main() {
  group('extractCfAuthorizationCookie', () {
    test('returns the cookie value when present', () {
      final cookies = [
        Cookie(name: 'other', value: 'x'),
        Cookie(name: 'CF_Authorization', value: 'jwt-token'),
      ];
      expect(extractCfAuthorizationCookie(cookies), 'jwt-token');
    });

    test('matches cookie name case-insensitively', () {
      final cookies = [
        Cookie(name: 'cf_authorization', value: 'lower-case-token'),
      ];
      expect(extractCfAuthorizationCookie(cookies), 'lower-case-token');
    });

    test('returns null when CF_Authorization is absent', () {
      final cookies = [
        Cookie(name: 'session', value: 'foo'),
        Cookie(name: 'csrftoken', value: 'bar'),
      ];
      expect(extractCfAuthorizationCookie(cookies), isNull);
    });

    test('returns null when value is empty', () {
      final cookies = [Cookie(name: 'CF_Authorization', value: '')];
      expect(extractCfAuthorizationCookie(cookies), isNull);
    });

    test('returns null on empty cookie list', () {
      expect(extractCfAuthorizationCookie(const []), isNull);
    });
  });

  group('isCfAccessChallengeHost', () {
    test('matches the cloudflareaccess.com apex and subdomains', () {
      final challenge = Uri.parse(
        'https://example.cloudflareaccess.com/cdn-cgi/access/login',
      );
      expect(isCfAccessChallengeHost(challenge), isTrue);
      expect(
        isCfAccessChallengeHost(Uri.parse('https://cloudflareaccess.com/')),
        isTrue,
      );
    });

    test('does not match the server origin', () {
      expect(
        isCfAccessChallengeHost(Uri.parse('https://dev.example.com/')),
        isFalse,
      );
    });

    test('does not match unrelated SSO providers', () {
      expect(
        isCfAccessChallengeHost(Uri.parse('https://accounts.google.com/')),
        isFalse,
      );
    });
  });
}
