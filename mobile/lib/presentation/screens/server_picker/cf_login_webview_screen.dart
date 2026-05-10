import 'package:flutter/material.dart';
import 'package:flutter_inappwebview/flutter_inappwebview.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../infrastructure/webview/navigation_policy.dart';
import '../../../infrastructure/webview/webview_factory.dart';

/// Returns the value of the `CF_Authorization` cookie from a list of
/// cookies (case-insensitive name match per HTTP spec, but in practice CF
/// always emits it as `CF_Authorization`).
///
/// Exposed at top-level so it can be unit-tested without spinning up a
/// real WebView.
String? extractCfAuthorizationCookie(List<Cookie> cookies) {
  for (final cookie in cookies) {
    if (cookie.name.toLowerCase() == 'cf_authorization') {
      final value = cookie.value;
      if (value is String && value.isNotEmpty) return value;
    }
  }
  return null;
}

/// Returns true if [uri]'s host is the CF Access challenge subdomain
/// rather than the server origin. We use this to skip cookie reads while
/// the user is still being challenged — CF only sets `CF_Authorization`
/// on the *server origin* once the challenge completes and the redirect
/// lands back there.
bool isCfAccessChallengeHost(Uri uri) {
  final host = uri.host.toLowerCase();
  return host.endsWith('.cloudflareaccess.com') ||
      host == 'cloudflareaccess.com';
}

/// Full-screen WebView shown after Add Server health-probe succeeds.
///
/// Loads the server URL, lets the user complete a CF Access challenge
/// (incl. Google/Microsoft/Okta SSO redirects), and as soon as the
/// WebView returns to the server origin AND `CF_Authorization` is
/// present in CookieManager, calls [onSuccess] with the cookie value.
///
/// Spec §3 — the WebView is the source-of-truth for the cookie; the
/// caller is responsible for relaying it into `flutter_secure_storage`
/// for Dio's `CfAuthInterceptor` to read on every request.
class CfLoginWebViewScreen extends ConsumerStatefulWidget {
  const CfLoginWebViewScreen({
    required this.serverUrl,
    required this.onSuccess,
    required this.onCancel,
    this.cookieManager,
    this.webViewFactory,
    super.key,
  });

  final Uri serverUrl;
  final void Function(String cookieValue) onSuccess;
  final VoidCallback onCancel;

  /// Test seam — defaults to [CookieManager.instance()] in production.
  final CookieManager? cookieManager;

  /// Test seam — defaults to a real [WebViewFactory]. Tests can substitute
  /// a fake factory that returns an empty widget so the unit suite doesn't
  /// have to host a real WebView.
  final WebViewFactory? webViewFactory;

  @override
  ConsumerState<CfLoginWebViewScreen> createState() =>
      _CfLoginWebViewScreenState();
}

class _CfLoginWebViewScreenState extends ConsumerState<CfLoginWebViewScreen> {
  bool _completed = false;

  Future<void> _maybeHarvestCookie(Uri? currentUrl) async {
    if (_completed) return;
    if (currentUrl == null) return;
    // Don't try to read cookies while we're still on the CF Access
    // subdomain — the cookie is only set on the server origin.
    if (isCfAccessChallengeHost(currentUrl)) return;
    if (currentUrl.origin != widget.serverUrl.origin) return;

    final manager = widget.cookieManager ?? CookieManager.instance();
    final cookies = await manager.getCookies(
      url: WebUri(widget.serverUrl.toString()),
    );
    final value = extractCfAuthorizationCookie(cookies);
    if (value == null) return;
    if (!mounted || _completed) return;
    _completed = true;
    widget.onSuccess(value);
  }

  @override
  Widget build(BuildContext context) {
    final policy = NavigationPolicy.forLogin(serverOrigin: widget.serverUrl);
    final factory = widget.webViewFactory ?? const WebViewFactory();
    return Scaffold(
      backgroundColor: const Color(0xFF1A1B26),
      appBar: AppBar(
        backgroundColor: const Color(0xFF1A1B26),
        foregroundColor: Colors.white,
        leading: IconButton(
          icon: const Icon(Icons.close),
          onPressed: () {
            if (_completed) return;
            _completed = true;
            widget.onCancel();
          },
        ),
        title: Text(
          'Sign in to ${widget.serverUrl.host}',
          style: const TextStyle(color: Colors.white),
        ),
      ),
      body: SafeArea(
        child: factory.build(
          initialUrl: widget.serverUrl,
          policy: policy,
          onLinkOpen: (uri) {
            // No-op during login: the navigation policy already allow-lists
            // the SSO providers we expect, so anything intercepted here is
            // an unexpected outbound link we deliberately drop.
            debugPrint('CF login: external link suppressed: $uri');
          },
          onLoadStop: (controller, url) async {
            await _maybeHarvestCookie(url?.uriValue);
          },
        ),
      ),
    );
  }
}
