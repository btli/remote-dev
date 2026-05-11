import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_inappwebview/flutter_inappwebview.dart';

import 'navigation_policy.dart';

typedef OnLinkOpen = void Function(Uri uri);

/// User-agent override applied to every WebView built by [WebViewFactory].
///
/// Why this exists (bd remote-dev-jch1):
/// Google's anti-phishing detector blocks OAuth flows in WebViews by
/// looking for the Android WebView marker (the "; wv)" substring) in
/// the UA string and returning HTTP 403 `disallowed_useragent`. When
/// the CF Access challenge redirects to a Google IdP, that block is a
/// hard wall on the entire mobile auth flow.
///
/// The fix: override the WebView's UA to a clean Chrome-mobile UA that
/// has NO `wv` marker. Same UA on Android and iOS — iOS WKWebView's
/// native UA wouldn't be blocked by Google, but a unified UA is
/// simpler and we're only authenticating against CF Access here, not
/// browsing the open web.
///
/// Trade-offs:
/// - We're spoofing a UA. Google currently tolerates this pattern in
///   practice but it's not their preferred OAuth flow.
/// - Cookies stay in the WebView jar; users can't share an existing
///   browser session.
/// - A future Google detection change (e.g. UA-CH client hints,
///   `Sec-CH-UA-WebView`) could re-break us.
///
/// Proper fix is filed as bd remote-dev-ysxq: route CF login through a
/// system browser (Custom Tabs / SFSafariViewController via
/// `url_launcher`) and bring the user back via App Links / Universal
/// Links. That requires server-side `apple-app-site-association` +
/// `assetlinks.json` configuration.
const String kSpoofedUserAgent =
    'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 '
    '(KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

class WebViewFactory {
  const WebViewFactory();

  /// Spec §2.2:
  /// - Rule 1: addJavaScriptHandler MUST be in onWebViewCreated. Caller
  ///   passes their handlers via [onWebViewCreated]; this factory does
  ///   not register handlers itself (Phase 2 wires the bridge).
  /// - Rule 5: navigation policy enforced via shouldOverrideUrlLoading.
  ///
  /// Returns [Widget] (not [InAppWebView] specifically) so test fakes can
  /// return a lightweight stand-in without triggering the platform plugin.
  Widget build({
    required Uri initialUrl,
    required NavigationPolicy policy,
    required OnLinkOpen onLinkOpen,
    void Function(InAppWebViewController controller)? onWebViewCreated,
    void Function(InAppWebViewController controller, WebUri? url)? onLoadStop,
    ValueChanged<int>? onProgressChanged,
  }) {
    return InAppWebView(
      initialUrlRequest: URLRequest(url: WebUri(initialUrl.toString())),
      initialSettings: InAppWebViewSettings(
        // bd remote-dev-jch1: replace platform default UA with a clean
        // Chrome-mobile UA so Google's `disallowed_useragent` 403
        // doesn't block CF Access challenges that hand off to Google
        // OAuth. See [kSpoofedUserAgent] above for the full rationale.
        userAgent: kSpoofedUserAgent,
        // Spec §4: iOS — disable the input-accessory view so the (Phase
        // 2) native input bar isn't shadowed by WebKit's accessory bar.
        // (`keyboardDisplayRequiresUserAction` from older versions does
        // not exist in flutter_inappwebview 6.1.x.)
        disableInputAccessoryView: true,
        disallowOverScroll: true,
        // Spec §2.2 Rule 5: shouldOverrideUrlLoading is opt-in on both
        // platforms in flutter_inappwebview 6.1.x; without this flag the
        // navigation policy callback never fires and every URL loads inline.
        useShouldOverrideUrlLoading: true,
        // Spec §4: Android hybrid composition
        useHybridComposition: !kIsWeb,
        applicationNameForUserAgent: 'RemoteDevMobile/0.1.0',
      ),
      onWebViewCreated: onWebViewCreated,
      onLoadStop: onLoadStop,
      // Page-load progress (0-100). Hosts use this to render a thin
      // LinearProgressIndicator until the embedded PWA reports complete.
      // See bd remote-dev-72dh.
      onProgressChanged: onProgressChanged == null
          ? null
          : (controller, progress) => onProgressChanged(progress),
      shouldOverrideUrlLoading: (controller, action) async {
        final uri = action.request.url?.uriValue;
        if (uri == null) return NavigationActionPolicy.CANCEL;
        switch (policy.decide(uri)) {
          case NavigationDecision.allow:
            return NavigationActionPolicy.ALLOW;
          case NavigationDecision.intercept:
            return NavigationActionPolicy.CANCEL;
          case NavigationDecision.interceptAndOpenExternally:
            onLinkOpen(uri);
            return NavigationActionPolicy.CANCEL;
        }
      },
    );
  }
}
