import 'package:flutter/foundation.dart';
import 'package:flutter_inappwebview/flutter_inappwebview.dart';

import '../../domain/auth_cookie.dart';

/// Reads (harvests) the host-wide `CF_Authorization` edge cookie OUT of the
/// in-app WebView's platform cookie jar — the reverse direction of
/// [WebViewCookieSeeder], which only ever writes store→WebView.
///
/// Why this exists (remote-dev off-LAN CF Access): the homelab host
/// `rdv.joyful.house` is dual-path. On-LAN it is fronted by Traefik with no
/// edge gate, so the OIDC session cookie alone authenticates. Off-LAN it is
/// fronted by the Cloudflare edge + **Cloudflare Access**: every request must
/// also carry `CF_Authorization` (the CF edge JWT) or it is bounced with a
/// `302 → *.cloudflareaccess.com` before it ever reaches the tunnel/instance.
///
/// `CF_Authorization` is minted at the Cloudflare edge AFTER an interactive CF
/// Access login. The app's `/auth/mobile-callback` runs *inside* the tunnel
/// (behind the edge), so it can never see/return that cookie. The only
/// component that completes the interactive edge login is the **WebView** —
/// so after a session WebView loads the host (and any CF Access challenge has
/// resolved) we harvest `CF_Authorization` from the jar and persist it as a
/// host auth cookie. The existing `CfAuthInterceptor` then attaches it to
/// every Dio call, so off-LAN API traffic (push registration and everything
/// else) passes the CF edge.
///
/// `CF_Authorization` is `HttpOnly`. The native [CookieManager.getCookies]
/// reads HttpOnly cookies on both target platforms — it is backed by
/// `android.webkit.CookieManager.getCookie` (returns the full cookie string,
/// HttpOnly included) on Android and `WKHTTPCookieStore.getAllCookies` (the
/// store, not JS) on iOS. The plugin's JS-fallback path — the only one that
/// cannot see HttpOnly cookies — is used solely on iOS < 11 / macOS < 10.13 /
/// Web, none of which this app targets.
class WebViewCookieHarvester {
  WebViewCookieHarvester({CookieManager? cookieManager})
      : _manager = cookieManager ?? CookieManager.instance();

  final CookieManager _manager;

  /// The CF Access edge cookie name. Host-wide, path `/`.
  static const cfAuthorizationCookieName = 'CF_Authorization';

  /// Reads the `CF_Authorization` cookie for [serverOrigin] from the platform
  /// jar and returns it as an [AuthCookie] (name/value, path `/`), or `null`
  /// when:
  /// - the jar holds no `CF_Authorization` for the host (on-LAN — no CF edge —
  ///   or the challenge hasn't completed yet),
  /// - its value is empty, or
  /// - it has already expired (a non-null [Cookie.expiresDate] in the past) —
  ///   we never persist a dead token.
  ///
  /// The cookie's real expiry is *respected* by skipping an already-expired
  /// cookie. The persisted [AuthCookie] shape carries no expiry field (it is
  /// name/value/path only), and that is intentionally fine: the value is the
  /// CF JWT, whose own `exp` claim the Cloudflare edge re-validates on every
  /// request — so a stale stored cookie simply earns another `302`, which
  /// triggers a re-harvest on the next WebView load.
  ///
  /// On Android the per-cookie metadata (`expiresDate`, `domain`, `isHttpOnly`)
  /// is only populated when `WebViewFeature.GET_COOKIE_INFO` is supported; when
  /// it is not, `expiresDate` is null and the expiry check is simply skipped
  /// (name + value are always present on every platform, which is all we
  /// strictly need to send the cookie back).
  ///
  /// Failures are non-fatal: any error reading the jar is swallowed + logged
  /// and `null` is returned, so a harvest attempt can never break the WebView.
  Future<AuthCookie?> harvestCfAuthorization({
    required Uri serverOrigin,
  }) async {
    try {
      final cookies = await _manager.getCookies(
        url: WebUri(serverOrigin.toString()),
      );
      Cookie? match;
      for (final c in cookies) {
        if (c.name == cfAuthorizationCookieName) {
          match = c;
          break;
        }
      }
      if (match == null) return null;

      // `Cookie.value` is typed `dynamic` by the plugin; CF_Authorization is
      // always a string JWT. Coerce defensively and bail on an empty value.
      final value = match.value?.toString() ?? '';
      if (value.isEmpty) return null;

      // Respect the cookie's real expiry: a non-null expiresDate in the past
      // means the edge would reject it anyway — don't persist a dead token.
      final expiresMs = match.expiresDate;
      if (expiresMs != null &&
          expiresMs <= DateTime.now().millisecondsSinceEpoch) {
        return null;
      }

      // CF_Authorization is host-wide; pin the persisted path to '/' (the
      // plugin reports path on Android only with GET_COOKIE_INFO, and '/' is
      // the correct host-wide scope the seeder re-applies anyway).
      final path =
          (match.path == null || match.path!.isEmpty) ? '/' : match.path!;
      return AuthCookie(
        name: cfAuthorizationCookieName,
        value: value,
        path: path,
      );
    } catch (e, st) {
      debugPrint('[WebViewCookieHarvester] getCookies failed for '
          '${serverOrigin.host}: $e\n$st');
      return null;
    }
  }
}
