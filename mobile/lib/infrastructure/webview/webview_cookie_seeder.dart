import 'package:flutter/foundation.dart';
import 'package:flutter_inappwebview/flutter_inappwebview.dart';

import '../../domain/auth_cookie.dart';

/// Seeds the platform [CookieManager] with the persisted auth cookies before
/// an in-app WebView navigates to a `/<slug>/m/<surface>/<id>` URL.
///
/// Before remote-dev-jch1, the auth cookie reached the WebView via the
/// in-app login WebView: the login screen completed the CF challenge,
/// and the platform cookie store (`WKWebsiteDataStore.default()` on iOS,
/// `android.webkit.CookieManager` on Android) was already populated by
/// the time other screens spun up. With the system-browser flow, the
/// cookies now live only in `flutter_secure_storage` — the in-app
/// WebView's cookie jar is empty, and the server blocks navigation to
/// `<server>/m/*` with a fresh auth challenge that no UI handles.
///
/// This seeder bridges that gap: callers (RecordingScreen, ChannelScreen,
/// SessionViewScreen, WebViewHostScreen) call [seedAuthCookies] with the
/// host origin and the cookies for the workspace
/// ([MobileCredentialsStore.getInstanceCookies]) before mounting their
/// InAppWebView. Each cookie is set as Secure + HttpOnly + SameSite=Lax +
/// 30-day-expires so it survives across cold starts and isn't readable from
/// any embedded JS.
///
/// Cookie types it carries:
/// - the workspace's NextAuth session cookie on an OIDC host (path-scoped to
///   the instance basePath), and/or
/// - the host-wide `CF_Authorization` edge cookie on a Cloudflare-Access host.
///
/// The supervisor's app-level session cookie is never among them (the store's
/// `getInstanceCookies` excludes it — design §7.2).
class WebViewCookieSeeder {
  WebViewCookieSeeder({CookieManager? cookieManager})
      : _manager = cookieManager ?? CookieManager.instance();

  final CookieManager _manager;

  /// Seeds every cookie in [cookies], each at its own [AuthCookie.path],
  /// scoped to [serverOrigin]'s host. No-op for empty-valued cookies.
  ///
  /// SameSite=Lax mirrors the server's NextAuth cookie attributes and is sent
  /// on the top-level GET navigation the WebView performs. Per-cookie failures
  /// are non-fatal and logged — if seeding fails the WebView simply hits an
  /// auth page and the user can re-auth.
  Future<void> seedAuthCookies({
    required Uri serverOrigin,
    required List<AuthCookie> cookies,
  }) async {
    // 30 days — matches the typical session length and ensures the cookies
    // survive across cold starts rather than being treated as session-only.
    final expires =
        DateTime.now().add(const Duration(days: 30)).millisecondsSinceEpoch;
    for (final c in cookies) {
      if (c.value.isEmpty) continue;
      try {
        await _manager.setCookie(
          url: WebUri(serverOrigin.toString()),
          name: c.name,
          value: c.value,
          // Path-scope each cookie: an instance session-token lives at
          // `/<slug>`, while a host-wide CF_Authorization lives at `/`.
          path: c.path.isEmpty ? '/' : c.path,
          isSecure: true,
          // HttpOnly so embedded JS cannot read the token.
          isHttpOnly: true,
          sameSite: HTTPCookieSameSitePolicy.LAX,
          expiresDate: expires,
        );
      } catch (e, st) {
        debugPrint(
          '[WebViewCookieSeeder] setCookie failed for ${c.name}: $e\n$st',
        );
      }
    }
  }

  /// Deletes each cookie in [cookies] from the platform jar by name + path,
  /// scoped to [serverOrigin]'s host. Used when a workspace is signed out or
  /// removed so its session cookie does not linger in the WebView jar; sibling
  /// workspaces (different name/path) are unaffected. Per-cookie failures are
  /// non-fatal and logged.
  Future<void> deleteAuthCookies({
    required Uri serverOrigin,
    required List<AuthCookie> cookies,
  }) async {
    for (final c in cookies) {
      try {
        await _manager.deleteCookie(
          url: WebUri(serverOrigin.toString()),
          name: c.name,
          path: c.path.isEmpty ? '/' : c.path,
        );
      } catch (e, st) {
        debugPrint(
          '[WebViewCookieSeeder] deleteCookie failed for ${c.name}: $e\n$st',
        );
      }
    }
  }
}
