import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../infrastructure/webview/navigation_policy.dart';
import '../../../infrastructure/webview/webview_factory.dart';
import 'session_route_host.dart'
    show
        activeWorkspaceProvider,
        mobileCredentialsStoreProvider,
        webViewCookieSeederProvider;

/// Hosts an InAppWebView pointed at a `/m/<surface>/<id>` URL on the
/// active server. Phase 1 just shows the WebView; Phase 2 layers status
/// bar + smart-keys + input bar above it.
///
/// Before mounting the WebView we seed the platform `CookieManager`
/// with the persisted CF Access JWT (post-jch1 flow — the cookie no
/// longer reaches the WebView via an in-app login). On a fresh install
/// with no credentials yet this is a no-op and the WebView will hit a
/// CF Access challenge that the user can re-auth from the picker.
///
/// When [allowedPathPrefixes] is supplied, it is forwarded to
/// [NavigationPolicy] so this host pins the WebView to a single PWA
/// surface. [SessionRouteHost] passes `['/m/session/']` to keep an
/// in-page redirect from quietly jumping into `/m/channel/<id>`.
class WebViewHostScreen extends ConsumerStatefulWidget {
  const WebViewHostScreen({
    required this.initialUrl,
    required this.serverOrigin,
    this.allowedPathPrefixes,
    super.key,
  });

  final Uri initialUrl;
  final Uri serverOrigin;

  /// Optional per-surface path scope. See [NavigationPolicy].
  final List<String>? allowedPathPrefixes;

  @override
  ConsumerState<WebViewHostScreen> createState() => _WebViewHostScreenState();
}

void _onLinkOpen(Uri uri) {
  // Phase 2: open via SFSafariViewController / Custom Tabs.
  debugPrint('External link suppressed: $uri');
}

class _WebViewHostScreenState extends ConsumerState<WebViewHostScreen> {
  Future<void>? _seedFuture;

  @override
  void initState() {
    super.initState();
    _seedFuture = _seedCookie();
  }

  Future<void> _seedCookie() async {
    // Best-effort — failures don't block the WebView from mounting.
    try {
      final conn = await ref.read(activeWorkspaceProvider.future);
      if (conn == null) return;
      final credentials = ref.read(mobileCredentialsStoreProvider);
      // CF token is host-wide.
      final cfToken = await credentials.getHostCfToken(conn.host.id);
      if (cfToken == null || cfToken.isEmpty) return;
      await ref
          .read(webViewCookieSeederProvider)
          .seedCfCookie(serverOrigin: widget.serverOrigin, value: cfToken);
    } catch (_) {
      // intentional: see ChannelScreen._seedCookie for rationale.
    }
  }

  @override
  Widget build(BuildContext context) {
    final policy = NavigationPolicy(
      serverOrigin: widget.serverOrigin,
      allowedPathPrefixes: widget.allowedPathPrefixes,
    );
    return Scaffold(
      backgroundColor: const Color(0xFF1A1B26),
      body: SafeArea(
        // Gate the WebView mount on cookie-seed completion so the
        // InAppWebView's initial GET doesn't race the CookieManager
        // setCookie call and trip a CF Access challenge.
        child: FutureBuilder<void>(
          future: _seedFuture,
          builder: (context, snap) {
            if (snap.connectionState != ConnectionState.done) {
              return const ColoredBox(
                color: Color(0xFF1A1B26),
                child: Center(
                  child: CircularProgressIndicator(strokeWidth: 2),
                ),
              );
            }
            return WebViewFactory().build(
              initialUrl: widget.initialUrl,
              policy: policy,
              onLinkOpen: _onLinkOpen,
            );
          },
        ),
      ),
    );
  }
}
