import 'package:flutter_test/flutter_test.dart';
import 'package:remote_dev/infrastructure/webview/navigation_policy.dart';

void main() {
  group('default policy (in-session)', () {
    final policy = NavigationPolicy(
      serverOrigin: Uri.parse('https://dev.example.com'),
    );

    test('allows /m/* on the server origin', () {
      expect(
        policy.decide(Uri.parse('https://dev.example.com/m/session/abc')),
        NavigationDecision.allow,
      );
    });

    test('intercepts non-/m/ on the server origin', () {
      expect(
        policy.decide(Uri.parse('https://dev.example.com/sessions')),
        NavigationDecision.intercept,
      );
    });

    test('allows Cloudflare Access challenge URLs', () {
      expect(
        policy.decide(Uri.parse('https://example.cloudflareaccess.com/login')),
        NavigationDecision.allow,
      );
    });

    test('opens external links externally', () {
      expect(
        policy.decide(Uri.parse('https://github.com/btli/remote-dev')),
        NavigationDecision.interceptAndOpenExternally,
      );
    });

    test('does NOT allow Google SSO in the default policy', () {
      // Terminal output could contain a google.com link; we deliberately
      // don't auto-load those in-place during a session.
      expect(
        policy.decide(Uri.parse('https://accounts.google.com/o/oauth2/auth')),
        NavigationDecision.interceptAndOpenExternally,
      );
    });
  });

  group('login policy (Add Server / re-auth)', () {
    final policy = NavigationPolicy.forLogin(
      serverOrigin: Uri.parse('https://dev.example.com'),
    );

    test('allows the server origin (any path, not just /m/)', () {
      expect(
        policy.decide(Uri.parse('https://dev.example.com/')),
        NavigationDecision.allow,
      );
      expect(
        policy.decide(Uri.parse('https://dev.example.com/login')),
        NavigationDecision.allow,
      );
    });

    test('allows Cloudflare Access challenge URLs', () {
      final uri = Uri.parse(
        'https://example.cloudflareaccess.com/cdn-cgi/access/login',
      );
      expect(policy.decide(uri), NavigationDecision.allow);
    });

    test('allows Google SSO', () {
      final uri = Uri.parse(
        'https://accounts.google.com/o/oauth2/auth?response_type=code',
      );
      expect(policy.decide(uri), NavigationDecision.allow);
    });

    test('allows Microsoft SSO (microsoftonline + live)', () {
      final ms = Uri.parse(
        'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
      );
      expect(policy.decide(ms), NavigationDecision.allow);
      expect(
        policy.decide(Uri.parse('https://login.live.com/oauth20_authorize.srf')),
        NavigationDecision.allow,
      );
    });

    test('allows Okta (any subdomain)', () {
      expect(
        policy.decide(Uri.parse('https://myco.okta.com/login/sso_iwa_auth')),
        NavigationDecision.allow,
      );
    });

    test('still intercepts random external URLs externally', () {
      expect(
        policy.decide(Uri.parse('https://example.com/')),
        NavigationDecision.interceptAndOpenExternally,
      );
    });
  });
}
