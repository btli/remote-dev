import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
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
  ///
  /// Returns [Widget] (not [InAppWebView] specifically) so test fakes can
  /// return a lightweight stand-in without triggering the platform plugin.
  ///
  /// When [policy] carries a same-origin server (the production case),
  /// `onPermissionRequest` grants MICROPHONE (and CAMERA for future image
  /// capture flows) to that origin only. Cross-origin requests — e.g. an
  /// embedded iframe — are denied to keep the WebView from becoming an
  /// open mic for the broader web. See bd remote-dev-cp47.
  Widget build({
    required Uri initialUrl,
    required NavigationPolicy policy,
    required OnLinkOpen onLinkOpen,
    void Function(InAppWebViewController controller)? onWebViewCreated,
    void Function(InAppWebViewController controller, WebUri? url)? onLoadStop,
    ValueChanged<int>? onProgressChanged,
    void Function(ConsoleMessage message)? onConsoleMessage,
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
        // Spec §2.2 Rule 5: shouldOverrideUrlLoading is opt-in on both
        // platforms in flutter_inappwebview 6.1.x; without this flag the
        // navigation policy callback never fires and every URL loads inline.
        useShouldOverrideUrlLoading: true,
        // Spec §4: Android hybrid composition
        useHybridComposition: !kIsWeb,
        // iOS requires explicit opt-in for getUserMedia to surface a
        // permission prompt without a tap. The native voice mic button is
        // a user gesture, so this flag is the right knob; without it
        // WKWebView silently rejects `navigator.mediaDevices.getUserMedia`
        // on iOS 15+ even when the WKUIDelegate would grant. See bd
        // remote-dev-cp47.
        mediaPlaybackRequiresUserGesture: false,
        // Android: hand off Permission API + getUserMedia decisions to
        // our `onPermissionRequest` handler. Without this, the system
        // default policy is DENY and no prompt is ever shown — which is
        // exactly the bug the voice mic surfaces today.
        allowsInlineMediaPlayback: true,
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
      onConsoleMessage: onConsoleMessage == null
          ? null
          : (controller, consoleMessage) => onConsoleMessage(consoleMessage),
      onPermissionRequest: (controller, request) async {
        return _resolvePermission(
          request: request,
          serverOrigin: policy.serverOrigin,
        );
      },
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

/// Grants MICROPHONE (and CAMERA, for future image capture) when the
/// requesting origin matches [serverOrigin]. Everything else is denied
/// so the WebView can't be coerced into capturing audio for arbitrary
/// third-party origins.
///
/// On Android this corresponds to WebChromeClient.onPermissionRequest;
/// on iOS it maps to WKUIDelegate's
/// `requestMediaCapturePermissionForOrigin`. flutter_inappwebview
/// unifies both behind `onPermissionRequest`.
///
/// See bd remote-dev-cp47.
PermissionResponse _resolvePermission({
  required PermissionRequest request,
  required Uri serverOrigin,
}) {
  final origin = request.origin.uriValue;
  final sameOrigin = origin.origin == serverOrigin.origin;
  if (!sameOrigin) {
    return PermissionResponse(
      resources: request.resources,
      action: PermissionResponseAction.DENY,
    );
  }
  final allowed = request.resources.where((resource) {
    return resource == PermissionResourceType.MICROPHONE ||
        resource == PermissionResourceType.CAMERA;
  }).toList(growable: false);
  if (allowed.isEmpty) {
    return PermissionResponse(
      resources: request.resources,
      action: PermissionResponseAction.DENY,
    );
  }
  return PermissionResponse(
    resources: allowed,
    action: PermissionResponseAction.GRANT,
  );
}
