import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_inappwebview/flutter_inappwebview.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../application/state/appearance_provider.dart';
import '../../../domain/appearance_settings.dart';
import '../../../infrastructure/webview/bridge_controller.dart';
import '../../../infrastructure/webview/navigation_policy.dart';
import '../../../infrastructure/webview/webview_factory.dart';
import '../webview_host/session_route_host.dart'
    show
        mobileCredentialsStoreProvider,
        serverConfigStoreProvider,
        webViewCookieSeederProvider;
import 'activity_pip.dart';
import 'mobile_input_bar.dart';
import 'session_status_bar.dart';
import 'smart_key_strip.dart';

/// Production session view for `/home/session/:id`.
///
/// Composes:
/// - `SessionStatusBar` (top, fixed 44px, sits in the column)
/// - WebView (middle, height tracks the keyboard inset via LayoutBuilder)
/// - Chrome stack (bottom, 100px reserve): `SmartKeyStrip` (44px) +
///   `MobileInputBar` (56px), rendered inside a single floating Positioned so
///   they ride the keyboard together — smart keys ALWAYS stay visible above
///   the input bar instead of being hidden behind the keyboard.
///
/// All five outbound bridge handlers are registered in `onWebViewCreated`
/// (Spec §2.2 rule 1). All native→WebView calls go through `BridgeController`
/// (Spec §2.2 rule 2). The WebView shrinks to track the keyboard inset so
/// xterm.js sees a viewport resize and tmux reflows its grid; the chrome
/// floats above the keyboard via `Stack + Positioned`.
class SessionViewScreen extends ConsumerStatefulWidget {
  const SessionViewScreen({
    required this.sessionId,
    super.key,
  });

  final String sessionId;

  @override
  ConsumerState<SessionViewScreen> createState() => _SessionViewScreenState();
}

class _SessionViewScreenState extends ConsumerState<SessionViewScreen> {
  BridgeController? _bridge;
  SessionActivity _activity = SessionActivity.idle;
  final String _projectName = '';
  String _sessionName = '';

  @override
  void initState() {
    super.initState();
    _loadActiveServer();
  }

  Future<void> _loadActiveServer() async {
    final store = ref.read(serverConfigStoreProvider);
    final server = await store.loadActive();
    if (mounted && server != null) {
      // Phase 2 simplification: use sessionId as the title; full session
      // detail resolution arrives in Phase 4 polish.
      setState(() {
        _sessionName = widget.sessionId;
      });
    }
  }

  void _registerBridgeHandlers(InAppWebViewController controller) {
    final bridge = BridgeController(controller: controller);
    setState(() => _bridge = bridge);

    controller.addJavaScriptHandler(
      handlerName: 'onTerminalReady',
      callback: (_) {
        debugPrint('[SessionView] onTerminalReady fired');
        bridge.markReady();
        // Push the current appearance state on first ready so the PWA
        // starts in sync without waiting for a user toggle. Reads are
        // safe here because `_registerBridgeHandlers` runs inside a
        // ConsumerState build chain.
        final settings = ref.read(appearanceSettingsProvider);
        bridge.setFontScale(settings.fontScale);
        bridge.setCursorBlink(settings.cursorBlink);
        return null;
      },
    );

    controller.addJavaScriptHandler(
      handlerName: 'onSelectionChange',
      callback: (args) {
        final selection = args.isNotEmpty ? args.first?.toString() : null;
        if (selection != null && selection.isNotEmpty && mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: const Text('Selection ready to copy'),
              action: SnackBarAction(
                label: 'Copy',
                onPressed: () =>
                    Clipboard.setData(ClipboardData(text: selection)),
              ),
            ),
          );
        }
        return null;
      },
    );

    controller.addJavaScriptHandler(
      handlerName: 'onWantsPaste',
      callback: (_) async {
        final data = await Clipboard.getData(Clipboard.kTextPlain);
        final text = data?.text;
        if (text != null && text.isNotEmpty) bridge.paste(text);
        return null;
      },
    );

    controller.addJavaScriptHandler(
      handlerName: 'onActivity',
      callback: (args) {
        final state = args.isNotEmpty ? args.first?.toString() : 'idle';
        if (mounted) {
          setState(() {
            _activity = switch (state) {
              'running' => SessionActivity.running,
              'waiting' => SessionActivity.waiting,
              'error' => SessionActivity.error,
              _ => SessionActivity.idle,
            };
          });
        }
        return null;
      },
    );

    controller.addJavaScriptHandler(
      handlerName: 'onLinkOpen',
      callback: (args) {
        // Phase 2 stub: log; Phase 4 wires url_launcher / Custom Tabs.
        debugPrint(
          'External link suppressed (Phase 4 wires): '
          '${args.isNotEmpty ? args.first : ''}',
        );
        return null;
      },
    );
  }

  void _handleSend(String text) {
    _bridge?.input(text);
    // Submit by sending CR (terminals interpret as enter).
    _bridge?.input('\r');
  }

  Future<void> _handlePasteWithoutExecute(
    void Function(String) setText,
  ) async {
    final data = await Clipboard.getData(Clipboard.kTextPlain);
    final text = data?.text;
    if (text != null && text.isNotEmpty) setText(text);
  }

  void _handleKeyPress(String name, Map<String, bool> mods, {String? bytes}) {
    // For composed control bytes (^C, ^D, shell punctuation, ⇧↵, …) the
    // strip pre-resolves the sequence and asks us to inject it directly
    // through `bridge.input`. Named keys (Tab, ArrowUp, …) still go
    // through the JS-side keyToBytes mapper.
    if (bytes != null && bytes.isNotEmpty) {
      _bridge?.input(bytes);
      return;
    }
    _bridge?.key(name, mods);
  }

  Future<void> _handleUploadImage(Uint8List bytes, String mimeType) async {
    final bridge = _bridge;
    if (bridge == null) return;
    final b64 = base64Encode(bytes);
    bridge.uploadImage(b64, mimeType);
  }

  @override
  Widget build(BuildContext context) {
    final keyboardInset = MediaQuery.viewInsetsOf(context).bottom;
    // Push appearance changes into the WebView whenever the user mutates
    // them. The bridge queues until markReady, so this is safe to fire
    // pre-load. Compare per-field so a `reduceMotion` toggle doesn't
    // re-push the font scale.
    ref.listen<AppearanceSettings>(appearanceSettingsProvider, (prev, next) {
      if (prev?.fontScale != next.fontScale) {
        _bridge?.setFontScale(next.fontScale);
      }
      if (prev?.cursorBlink != next.cursorBlink) {
        _bridge?.setCursorBlink(next.cursorBlink);
      }
    });
    return Scaffold(
      backgroundColor: const Color(0xFF1A1B26),
      // Spec §4: own the layout; never let Scaffold reflow on keyboard.
      resizeToAvoidBottomInset: false,
      body: SafeArea(
        bottom: false,
        child: LayoutBuilder(
          builder: (context, constraints) {
            const statusBarHeight = 44.0;
            const smartKeysHeight = 44.0;
            const inputBarHeight = 56.0;
            const chromeHeight = smartKeysHeight + inputBarHeight; // 100
            // WebView shrinks to track the keyboard inset so xterm.js
            // refits its grid (via visualViewport + ResizeObserver in
            // Terminal.tsx) and the terminal server reflows tmux. The
            // chrome (smart keys + input bar) still floats above the
            // keyboard as a single block via Stack + Positioned, so the
            // bottom 100px reserve stays present whether the keyboard is
            // up or not.
            final webViewHeight = constraints.maxHeight -
                statusBarHeight -
                chromeHeight -
                keyboardInset;
            return Stack(
              children: [
                Column(
                  children: [
                    SizedBox(
                      height: statusBarHeight,
                      child: SessionStatusBar(
                        projectName:
                            _projectName.isEmpty ? null : _projectName,
                        sessionName: _sessionName.isEmpty
                            ? widget.sessionId
                            : _sessionName,
                        activity: _activity,
                      ),
                    ),
                    SizedBox(
                      key: const Key('webview-frame'),
                      // Defend against the WebView shrinking to a
                      // negative height on small screens where status +
                      // chrome + keyboardInset can exceed
                      // constraints.maxHeight. A non-negative height
                      // keeps the layout sane until the keyboard
                      // collapses.
                      height: webViewHeight < 0 ? 0 : webViewHeight,
                      child: _Webview(
                        sessionId: widget.sessionId,
                        onWebViewCreated: _registerBridgeHandlers,
                      ),
                    ),
                    // Reserve space for the floating chrome so the column
                    // fills the screen; smart keys + input bar are
                    // rendered in the Stack overlay so they ride the
                    // keyboard together.
                    const SizedBox(height: chromeHeight),
                  ],
                ),
                Positioned(
                  left: 0,
                  right: 0,
                  bottom: keyboardInset,
                  child: SafeArea(
                    top: false,
                    bottom: keyboardInset == 0,
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        SizedBox(
                          height: smartKeysHeight,
                          child: SmartKeyStrip(
                            onKeyPress: _handleKeyPress,
                            onUploadImage: _handleUploadImage,
                          ),
                        ),
                        SizedBox(
                          height: inputBarHeight,
                          child: MobileInputBar(
                            onSend: _handleSend,
                            onPasteWithoutExecute: _handlePasteWithoutExecute,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            );
          },
        ),
      ),
    );
  }
}

class _Webview extends ConsumerWidget {
  const _Webview({required this.sessionId, required this.onWebViewCreated});

  final String sessionId;
  final void Function(InAppWebViewController) onWebViewCreated;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return FutureBuilder<Uri?>(
      future: _resolveOrigin(ref),
      builder: (context, snap) {
        final origin = snap.data;
        if (origin == null) {
          return const ColoredBox(
            color: Color(0xFF1A1B26),
            child: Center(
              child: Padding(
                padding: EdgeInsets.all(24),
                child: Text(
                  'No active server configured.',
                  style: TextStyle(color: Colors.white70),
                ),
              ),
            ),
          );
        }
        final url = origin.replace(path: '/m/session/$sessionId');
        return WebViewFactory().build(
          initialUrl: url,
          policy: NavigationPolicy(
            serverOrigin: origin,
            allowedPathPrefixes: const ['/m/session/'],
          ),
          onLinkOpen: (uri) {
            debugPrint('External link suppressed: $uri');
          },
          onWebViewCreated: onWebViewCreated,
          // Diagnostic logging (bd remote-dev-l4q6 Bug 4). Without an on-
          // device repro of the blank-screen / submit-does-nothing bug we
          // surface page-load + console output to `flutter logs` so the
          // next iteration can see where the embedded PWA stops.
          onLoadStop: (_, uri) =>
              debugPrint('[SessionView] loadStop $uri'),
          onProgressChanged: (progress) =>
              debugPrint('[SessionView] progress $progress'),
          onConsoleMessage: (msg) => debugPrint(
            '[SessionView][console] ${msg.messageLevel}: ${msg.message}',
          ),
        );
      },
    );
  }

  /// Resolves the active server's origin AND best-effort seeds the
  /// platform CookieManager with the persisted CF JWT before the WebView
  /// mounts. Seeding failures are swallowed so they don't block the
  /// WebView (the WebView will hit a CF Access challenge instead, and
  /// the user re-auths via /reauth).
  Future<Uri?> _resolveOrigin(WidgetRef ref) async {
    final server = await ref.read(serverConfigStoreProvider).loadActive();
    if (server == null) return null;
    final origin = Uri.parse(server.url);
    try {
      final credentials = ref.read(mobileCredentialsStoreProvider);
      final cfToken = await credentials.readCfToken(server.id);
      if (cfToken != null && cfToken.isNotEmpty) {
        await ref
            .read(webViewCookieSeederProvider)
            .seedCfCookie(serverOrigin: origin, value: cfToken);
      }
    } catch (_) {
      // intentional: see seeder rationale in ChannelScreen._seedCookie.
    }
    return origin;
  }
}
