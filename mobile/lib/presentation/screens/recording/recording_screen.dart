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
class RecordingScreen extends ConsumerStatefulWidget {
  const RecordingScreen({required this.recordingId, super.key});

  final String recordingId;

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
    // Signal the embedded PWA so it can close any open modal/overlay first.
    // The bridge call queues if the PWA hasn't fired onTerminalReady yet,
    // so it's safe to invoke unconditionally. We then pop the native route.
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
