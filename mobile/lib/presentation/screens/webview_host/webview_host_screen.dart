import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../infrastructure/webview/navigation_policy.dart';
import '../../../infrastructure/webview/webview_factory.dart';

/// Hosts an InAppWebView pointed at a `/m/<surface>/<id>` URL on the
/// active server. Phase 1 just shows the WebView; Phase 2 layers status
/// bar + smart-keys + input bar above it.
class WebViewHostScreen extends ConsumerWidget {
  const WebViewHostScreen({
    required this.initialUrl,
    required this.serverOrigin,
    super.key,
  });

  final Uri initialUrl;
  final Uri serverOrigin;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final policy = NavigationPolicy(serverOrigin: serverOrigin);
    return Scaffold(
      backgroundColor: const Color(0xFF1A1B26),
      body: SafeArea(
        child: const WebViewFactory().build(
          initialUrl: initialUrl,
          policy: policy,
          onLinkOpen: (uri) {
            // Phase 2: open via SFSafariViewController / Custom Tabs.
            debugPrint('External link suppressed: $uri');
          },
        ),
      ),
    );
  }
}
