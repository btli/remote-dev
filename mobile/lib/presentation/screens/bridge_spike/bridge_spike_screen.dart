import 'package:flutter/material.dart';
import 'package:flutter_inappwebview/flutter_inappwebview.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../infrastructure/webview/bridge_controller.dart';
import '../../../infrastructure/webview/navigation_policy.dart';
import '../../../infrastructure/webview/webview_factory.dart';
import '../webview_host/session_route_host.dart' show activeServerProvider;

/// Throwaway POC screen for Phase 1.5: a native TextField below an
/// embedded WebView, both wired through the bridge. Goal: prove the
/// round-trip works on iOS + Android physical devices and that the
/// keyboard doesn't reflow the WebView terminal.
class BridgeSpikeScreen extends ConsumerStatefulWidget {
  const BridgeSpikeScreen({super.key});

  @override
  ConsumerState<BridgeSpikeScreen> createState() => _BridgeSpikeScreenState();
}

class _BridgeSpikeScreenState extends ConsumerState<BridgeSpikeScreen> {
  final _inputCtrl = TextEditingController();
  BridgeController? _bridge;
  bool _ready = false;

  @override
  void dispose() {
    _inputCtrl.dispose();
    super.dispose();
  }

  void _send() {
    final text = _inputCtrl.text;
    if (text.isEmpty) return;
    _bridge?.input(text);
    _inputCtrl.clear();
  }

  @override
  Widget build(BuildContext context) {
    final asyncServer = ref.watch(activeServerProvider);
    return asyncServer.when(
      loading: () => const _Loading(),
      error: (e, _) => _ErrorBox(message: 'Failed to load server: $e'),
      data: (server) {
        if (server == null) {
          return const _ErrorBox(
            message: 'No active server. Pick one from the server list first.',
          );
        }
        final origin = Uri.parse(server.url);
        final url = Uri.parse('${server.url}/m/session/spike-test');
        // Spec §4: own the layout math; do NOT let Scaffold resize.
        final keyboardInset = MediaQuery.viewInsetsOf(context).bottom;
        return Scaffold(
          backgroundColor: const Color(0xFF1A1B26),
          resizeToAvoidBottomInset: false,
          appBar: AppBar(
            backgroundColor: const Color(0xFF1A1B26),
            title: const Text(
              'Bridge spike',
              style: TextStyle(color: Colors.white),
            ),
          ),
          body: Column(
            children: [
              Expanded(
                child: const WebViewFactory().build(
                  initialUrl: url,
                  policy: NavigationPolicy(serverOrigin: origin),
                  onLinkOpen: (_) {},
                  onWebViewCreated: (InAppWebViewController controller) {
                    // Spec §2.2 rule 1: register handlers in onWebViewCreated.
                    final bridge = BridgeController(controller: controller);
                    controller.addJavaScriptHandler(
                      handlerName: 'onTerminalReady',
                      callback: (_) {
                        bridge.markReady();
                        if (mounted) setState(() => _ready = true);
                      },
                    );
                    setState(() => _bridge = bridge);
                  },
                ),
              ),
              SafeArea(
                top: false,
                child: Padding(
                  padding: EdgeInsets.only(bottom: keyboardInset),
                  child: Container(
                    color: const Color(0xFF24283B),
                    padding: const EdgeInsets.all(8),
                    child: Row(
                      children: [
                        Container(
                          width: 8,
                          height: 8,
                          decoration: BoxDecoration(
                            shape: BoxShape.circle,
                            color: _ready
                                ? const Color(0xFF9ECE6A)
                                : const Color(0xFFE0AF68),
                          ),
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: TextField(
                            controller: _inputCtrl,
                            enabled: _ready,
                            style: const TextStyle(color: Colors.white),
                            decoration: InputDecoration(
                              hintText: _ready
                                  ? 'send to terminal'
                                  : 'connecting…',
                              hintStyle: const TextStyle(color: Colors.white54),
                              border: InputBorder.none,
                            ),
                            onSubmitted: (_) => _send(),
                          ),
                        ),
                        IconButton(
                          icon: const Icon(Icons.send, color: Colors.white),
                          onPressed: _ready ? _send : null,
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}

class _Loading extends StatelessWidget {
  const _Loading();
  @override
  Widget build(BuildContext context) {
    return const Scaffold(
      backgroundColor: Color(0xFF1A1B26),
      body: Center(child: CircularProgressIndicator()),
    );
  }
}

class _ErrorBox extends StatelessWidget {
  const _ErrorBox({required this.message});
  final String message;
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF1A1B26),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Text(message, style: const TextStyle(color: Colors.white70)),
        ),
      ),
    );
  }
}
