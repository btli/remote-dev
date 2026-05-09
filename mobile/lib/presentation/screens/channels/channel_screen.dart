import 'package:flutter/material.dart';
import 'package:flutter_inappwebview/flutter_inappwebview.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../infrastructure/webview/bridge_controller.dart';
import '../../../infrastructure/webview/navigation_policy.dart';
import '../../../infrastructure/webview/webview_factory.dart';
import '../webview_host/session_route_host.dart' show activeServerProvider;

/// Native chrome around the embedded WebView at `/m/channel/<id>`.
///
/// Mirrors the `SessionViewScreen` pattern from Phase 2:
/// - Native AppBar (channel name + back button).
/// - Body is the InAppWebView pointed at `<server>/m/channel/<id>`.
/// - `onTerminalReady` registered in `onWebViewCreated` (Spec §2.2 rule 1).
/// - All native→WebView calls go through [BridgeController] (Spec §2.2 rule 2).
///
/// Phase 4 scope: AppBar + WebView only. The richer bridge handlers
/// (`onLinkOpen`, `onSelectionChange`, etc.) land in Phase 5 once the channel
/// PWA exposes them.
class ChannelScreen extends ConsumerStatefulWidget {
  const ChannelScreen({required this.channelId, super.key});

  final String channelId;

  @override
  ConsumerState<ChannelScreen> createState() => _ChannelScreenState();
}

class _ChannelScreenState extends ConsumerState<ChannelScreen> {
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
    // Signal the embedded PWA so it can close any open thread/modal first.
    // The bridge call queues if the PWA hasn't fired onTerminalReady yet,
    // so it's safe to invoke unconditionally. We then pop the native route
    // — the WebView decides whether to consume the gesture before this.
    _bridge?.back();
    if (!mounted) return;
    await Navigator.of(context).maybePop();
  }

  @override
  Widget build(BuildContext context) {
    final asyncServer = ref.watch(activeServerProvider);
    return Scaffold(
      backgroundColor: const Color(0xFF1A1B26),
      appBar: AppBar(
        backgroundColor: const Color(0xFF1A1B26),
        title: const Text('Channel', style: TextStyle(color: Colors.white)),
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
          final url = origin.replace(path: '/m/channel/${widget.channelId}');
          return WebViewFactory().build(
            initialUrl: url,
            policy: NavigationPolicy(serverOrigin: origin),
            onLinkOpen: (_) {},
            onWebViewCreated: _onWebViewCreated,
          );
        },
      ),
    );
  }
}
