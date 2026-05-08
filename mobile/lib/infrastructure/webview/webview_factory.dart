import 'package:flutter/foundation.dart';
import 'package:flutter_inappwebview/flutter_inappwebview.dart';

import 'navigation_policy.dart';

typedef OnLinkOpen = void Function(Uri uri);

class WebViewFactory {
  const WebViewFactory();

  /// Spec §2.2:
  /// - Rule 1: addJavaScriptHandler MUST be in onWebViewCreated. Caller
  ///   passes their handlers via [onWebViewCreated]; this factory does
  ///   not register handlers itself (Phase 2 wires the bridge).
  /// - Rule 5: navigation policy enforced via shouldOverrideUrlLoading.
  InAppWebView build({
    required Uri initialUrl,
    required NavigationPolicy policy,
    required OnLinkOpen onLinkOpen,
    void Function(InAppWebViewController controller)? onWebViewCreated,
    void Function(InAppWebViewController controller, WebUri? url)? onLoadStop,
  }) {
    return InAppWebView(
      initialUrlRequest: URLRequest(url: WebUri(initialUrl.toString())),
      initialSettings: InAppWebViewSettings(
        // Spec §4: iOS — disable the input-accessory view so the (Phase
        // 2) native input bar isn't shadowed by WebKit's accessory bar.
        // (`keyboardDisplayRequiresUserAction` from older versions does
        // not exist in flutter_inappwebview 6.1.x.)
        disableInputAccessoryView: true,
        disallowOverScroll: true,
        // Spec §4: Android hybrid composition
        useHybridComposition: !kIsWeb,
        applicationNameForUserAgent: 'RemoteDevMobile/0.1.0',
      ),
      onWebViewCreated: onWebViewCreated,
      onLoadStop: onLoadStop,
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
