import 'package:flutter_test/flutter_test.dart';
import 'package:remote_dev/infrastructure/webview/webview_factory.dart';

void main() {
  group('kSpoofedUserAgent (bd remote-dev-jch1)', () {
    test('does not contain the Android WebView "wv" marker', () {
      // Google's anti-phishing detector blocks WebView OAuth flows by
      // matching the "; wv)" substring in the UA. If that marker
      // sneaks back in, CF Access -> Google OAuth will 403 with
      // `disallowed_useragent`. This test is a tripwire.
      expect(kSpoofedUserAgent, isNot(contains('wv')));
      expect(kSpoofedUserAgent, isNot(contains('WebView')));
    });

    test('reads as a Chrome mobile UA', () {
      // Google's check is heuristic. We need a UA that looks like a
      // real mobile Chrome to be allow-listed.
      expect(kSpoofedUserAgent, startsWith('Mozilla/5.0'));
      expect(kSpoofedUserAgent, contains('Chrome'));
      expect(kSpoofedUserAgent, contains('Mobile'));
      expect(kSpoofedUserAgent, contains('Safari'));
    });
  });
}
