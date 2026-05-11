import 'package:flutter/foundation.dart';
import 'package:flutter_inappwebview/flutter_inappwebview.dart';

/// Seeds the platform [CookieManager] with the persisted CF Access JWT
/// before an in-app WebView navigates to a `/m/<surface>/<id>` URL.
///
/// Before remote-dev-jch1, the CF cookie reached the WebView via the
/// in-app login WebView: the login screen completed the CF challenge,
/// and the platform cookie store (`WKWebsiteDataStore.default()` on iOS,
/// `android.webkit.CookieManager` on Android) was already populated by
/// the time other screens spun up. With the system-browser flow, the CF
/// cookie now lives only in `flutter_secure_storage` — the in-app
/// WebView's cookie jar is empty, and CF Access blocks navigation to
/// `<server>/m/*` with a fresh challenge that no UI handles.
///
/// This seeder bridges that gap: callers (RecordingScreen, ChannelScreen,
/// SessionViewScreen) call [seedCfCookie] with the server origin and the
/// persisted JWT before mounting their InAppWebView. The cookie is set
/// as Secure + HttpOnly + 30-day-expires so it survives across cold
/// starts and isn't readable from any embedded JS.
class WebViewCookieSeeder {
  WebViewCookieSeeder({CookieManager? cookieManager})
      : _manager = cookieManager ?? CookieManager.instance();

  final CookieManager _manager;

  /// Writes a `CF_Authorization=<value>` cookie scoped to [serverOrigin].
  /// No-op when [value] is null or empty.
  ///
  /// Returns `true` on success, `false` if the platform plugin rejected
  /// the set or threw. Errors are non-fatal — if seeding fails the
  /// WebView will simply hit a CF Access page and the user can re-auth.
  Future<bool> seedCfCookie({
    required Uri serverOrigin,
    required String? value,
  }) async {
    if (value == null || value.isEmpty) return false;
    try {
      // 30 days in seconds — matches the typical CF Access session
      // length and ensures the cookie survives across cold starts
      // rather than being treated as session-only.
      final expires =
          DateTime.now().add(const Duration(days: 30)).millisecondsSinceEpoch;
      await _manager.setCookie(
        url: WebUri(serverOrigin.toString()),
        name: 'CF_Authorization',
        value: value,
        // CF Access requires Secure + the canonical CF_Authorization
        // name. The cookie is Domain-scoped to the server origin host
        // by default when no `domain:` is supplied; that's what we
        // want — we never want this leaking to other origins.
        isSecure: true,
        // HttpOnly so embedded JS in the PWA cannot read the JWT, even
        // though the same JWT is being supplied. Matches the cookie
        // attributes CF Access itself emits.
        isHttpOnly: true,
        expiresDate: expires,
      );
      return true;
    } catch (e, st) {
      debugPrint('[WebViewCookieSeeder] setCookie failed: $e\n$st');
      return false;
    }
  }
}
