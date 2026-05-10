import 'package:flutter/material.dart';
import 'package:flutter_inappwebview/flutter_inappwebview.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../infrastructure/webview/bridge_controller.dart';
import '../../../infrastructure/webview/navigation_policy.dart';
import '../../../infrastructure/webview/webview_factory.dart';
import '../webview_host/session_route_host.dart' show activeServerProvider;

/// Native chrome around the embedded WebView at `/m/recording/<id>`.
///
/// Mirrors the [ChannelScreen] pattern from Phase 4:
/// - Native AppBar (title + back button).
/// - Body is the InAppWebView pointed at `<server>/m/recording/<id>`.
/// - `onTerminalReady` registered in `onWebViewCreated` (Spec §2.2 rule 1).
/// - All native→WebView calls go through [BridgeController] (Spec §2.2 rule 2).
///
/// Cookie sharing across InAppWebView instances:
///
/// `flutter_inappwebview`'s `CookieManager` is a Dart singleton that bridges
/// to the platform cookie store (`WKWebsiteDataStore.default()` on iOS,
/// `android.webkit.CookieManager.getInstance()` on Android). When two
/// WebViews use the default persistent data store, the CF cookie persisted
/// by `CfLoginWebViewScreen` is therefore visible to `RecordingScreen`'s
/// WebView on the same origin.
///
/// Caveats:
///   - iOS non-persistent / `incognito: true` data stores break sharing.
///   - Android `incognito: true` wipes cookies.
///   - Session-only cookies (without an Expires/Max-Age attribute) may
///     not survive cold restarts.
///
/// The Dio-side `CfAuthInterceptor` only attaches to HTTP API calls — it
/// is not in the WebView's request path and does not need to be.
class RecordingScreen extends ConsumerStatefulWidget {
  const RecordingScreen({
    required this.recordingId,
    this.webViewFactory,
    super.key,
  });

  final String recordingId;

  /// Test seam — defaults to a real [WebViewFactory]. Tests can substitute
  /// a fake factory that returns an empty widget (and captures the URL it
  /// was asked to build) so the unit suite doesn't have to host a real
  /// WebView.
  final WebViewFactory? webViewFactory;

  @override
  ConsumerState<RecordingScreen> createState() => _RecordingScreenState();
}

class _RecordingScreenState extends ConsumerState<RecordingScreen> {
  BridgeController? _bridge;

  void _onWebViewCreated(InAppWebViewController controller) {
    final bridge = BridgeController(controller: controller);
    setState(() => _bridge = bridge);
    controller.addJavaScriptHandler(
      handlerName: 'onTerminalReady',
      callback: (_) {
        bridge.markReady();
        return null;
      },
    );
  }

  Future<void> _handleBack() async {
    // Ask the embedded PWA to handle the gesture first — it may want to
    // close an open modal/overlay rather than pop the native route. The
    // bridge resolves to `false` if it isn't ready or the PWA-side
    // `back()` returns `void`/`undefined`, in which case we pop.
    final bridge = _bridge;
    final handled = bridge == null ? false : await bridge.back();
    if (!handled && mounted) {
      await Navigator.of(context).maybePop();
    }
  }

  @override
  Widget build(BuildContext context) {
    final asyncServer = ref.watch(activeServerProvider);
    return Scaffold(
      backgroundColor: const Color(0xFF1A1B26),
      appBar: AppBar(
        backgroundColor: const Color(0xFF1A1B26),
        title: const Text('Recording', style: TextStyle(color: Colors.white)),
        iconTheme: const IconThemeData(color: Colors.white),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: _handleBack,
        ),
      ),
      body: asyncServer.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(
          child: Text(
            'Failed to load: $e',
            style: const TextStyle(color: Colors.white70),
          ),
        ),
        data: (server) {
          if (server == null) {
            return const Center(
              child: Text(
                'No active server.',
                style: TextStyle(color: Colors.white70),
              ),
            );
          }
          final origin = Uri.parse(server.url);
          final url = origin.replace(path: '/m/recording/${widget.recordingId}');
          final factory = widget.webViewFactory ?? const WebViewFactory();
          return factory.build(
            initialUrl: url,
            policy: NavigationPolicy(
              serverOrigin: origin,
              allowedPathPrefixes: const ['/m/recording/'],
            ),
            onLinkOpen: (_) {},
            onWebViewCreated: _onWebViewCreated,
          );
        },
      ),
    );
  }
}
