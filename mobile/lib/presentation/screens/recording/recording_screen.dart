import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_inappwebview/flutter_inappwebview.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../application/state/appearance_provider.dart';
import '../../../domain/appearance_settings.dart';
import '../../../infrastructure/webview/bridge_controller.dart';
import '../../../infrastructure/webview/navigation_policy.dart';
import '../../../infrastructure/webview/webview_factory.dart';
import '../webview_host/session_route_host.dart'
    show
        activeServerProvider,
        mobileCredentialsStoreProvider,
        webViewCookieSeederProvider;

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
  // Page-load progress (0-100). 100 means the embedded PWA finished
  // loading; the AppBar progress indicator is hidden in that state.
  int _progress = 100;
  // Seeds the WebView's CookieManager with the persisted CF JWT before
  // the InAppWebView navigates. Resolved per active server in
  // initState's async chain. See WebViewCookieSeeder.
  Future<void>? _seedFuture;

  @override
  void initState() {
    super.initState();
    _seedFuture = _seedCookie();
  }

  Future<void> _seedCookie() async {
    // Best-effort — see ChannelScreen._seedCookie for rationale.
    try {
      final server = await ref.read(activeServerProvider.future);
      if (server == null) return;
      final credentials = ref.read(mobileCredentialsStoreProvider);
      final cfToken = await credentials.readCfToken(server.id);
      if (cfToken == null || cfToken.isEmpty) return;
      await ref.read(webViewCookieSeederProvider).seedCfCookie(
            serverOrigin: Uri.parse(server.url),
            value: cfToken,
          );
    } catch (_) {
      // intentional: failures are non-fatal.
    }
  }

  void _onWebViewCreated(InAppWebViewController controller) {
    final bridge = BridgeController(controller: controller);
    setState(() => _bridge = bridge);
    controller.addJavaScriptHandler(
      handlerName: 'onTerminalReady',
      callback: (_) {
        bridge.markReady();
        // Recording embed accepts setFontScale (no-op visually today,
        // but keeps the bridge surface uniform across routes).
        bridge.setFontScale(ref.read(appearanceSettingsProvider).fontScale);
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
    // Recording embed has no terminal, so we skip cursorBlink; we still
    // forward fontScale so the bridge surface stays uniform across
    // routes (and so future content scaling on the player can hook in).
    ref.listen<AppearanceSettings>(appearanceSettingsProvider, (prev, next) {
      if (prev?.fontScale != next.fontScale) {
        _bridge?.setFontScale(next.fontScale);
      }
    });
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
        bottom: _progress < 100
            ? PreferredSize(
                preferredSize: const Size.fromHeight(2),
                child: LinearProgressIndicator(
                  value: _progress / 100,
                  minHeight: 2,
                  backgroundColor: Colors.transparent,
                  color: const Color(0xFF7AA2F7),
                ),
              )
            : null,
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
          // Fire-and-forget the seed; see ChannelScreen for rationale.
          unawaited(_seedFuture ?? Future<void>.value());
          return factory.build(
            initialUrl: url,
            policy: NavigationPolicy(
              serverOrigin: origin,
              allowedPathPrefixes: const ['/m/recording/'],
            ),
            onLinkOpen: (_) {},
            onWebViewCreated: _onWebViewCreated,
            onProgressChanged: (p) {
              if (mounted) setState(() => _progress = p);
            },
          );
        },
      ),
    );
  }
}
