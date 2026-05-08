import 'package:flutter_test/flutter_test.dart';
import 'package:remote_dev/infrastructure/webview/navigation_policy.dart';

void main() {
  final policy = NavigationPolicy(serverOrigin: Uri.parse('https://dev.example.com'));

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
}
