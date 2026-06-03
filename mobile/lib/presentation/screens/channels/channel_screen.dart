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
        activeWorkspaceProvider,
        mobileCredentialsStoreProvider,
        webViewCookieSeederProvider;
import 'channels_tab_screen.dart'
    show activeNodeProvider, channelsListProvider;

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
///
/// ## Rebuild isolation
///
/// `ChannelScreen` itself does NOT watch [channelsListProvider]. The title
/// is delegated to [_ChannelTitle], a dedicated `ConsumerWidget` whose only
/// job is to render the AppBar text. That keeps any list refresh from
/// rebuilding (and remounting) the WebView subtree below.
class ChannelScreen extends ConsumerStatefulWidget {
  const ChannelScreen({
    required this.channelId,
    this.bridgeFactoryOverride,
    this.webViewFactory,
    super.key,
  });

  final String channelId;

  /// Test seam — when supplied, the screen installs the returned
  /// [BridgeController] immediately on mount instead of waiting for the
  /// real `onWebViewCreated` (which never fires under `flutter_test`
  /// because InAppWebView's platform plugin isn't available). The factory
  /// receives the live [InAppWebViewController] if/when one becomes
  /// available, or `null` when invoked from `initState` for the test
  /// seam. Matches the `cfLoginLauncherOverride` pattern from
  /// `presentation/screens/webview_host/reauth_screen.dart`.
  final BridgeController Function(InAppWebViewController? controller)?
      bridgeFactoryOverride;

  /// Test seam — defaults to a real [WebViewFactory]. Tests can substitute
  /// a fake factory that controls `onProgressChanged` to drive the AppBar
  /// progress indicator without needing a real WebView.
  final WebViewFactory? webViewFactory;

  @override
  ConsumerState<ChannelScreen> createState() => _ChannelScreenState();
}

class _ChannelScreenState extends ConsumerState<ChannelScreen> {
  BridgeController? _bridge;
  // Page-load progress (0-100). 100 hides the AppBar indicator.
  int _progress = 100;
  // Seeds CookieManager with the CF JWT pre-mount. See WebViewCookieSeeder.
  Future<void>? _seedFuture;

  @override
  void initState() {
    super.initState();
    // Honor the test seam eagerly so widget tests can drive `_handleBack`
    // without needing a real `onWebViewCreated` to fire.
    final override = widget.bridgeFactoryOverride;
    if (override != null) {
      _bridge = override(null);
    }
    _seedFuture = _seedCookie();
  }

  Future<void> _seedCookie() async {
    // Best-effort: failures here are non-fatal. The WebView will hit a
    // CF Access challenge instead of an authenticated page, the user
    // re-auths via /reauth, and we try again. Swallowing exceptions
    // also keeps widget tests that don't override the credential or
    // seeder providers from blocking on the platform secure-storage
    // plugin (which isn't available under flutter_test).
    try {
      final conn = await ref.read(activeWorkspaceProvider.future);
      if (conn == null) return;
      final credentials = ref.read(mobileCredentialsStoreProvider);
      // CF token is host-wide; seed it against the host origin.
      final cfToken = await credentials.getHostCfToken(conn.host.id);
      if (cfToken == null || cfToken.isEmpty) return;
      await ref.read(webViewCookieSeederProvider).seedCfCookie(
            serverOrigin: Uri.parse(conn.host.origin),
            value: cfToken,
          );
    } catch (_) {
      // intentional: see comment above.
    }
  }

  void _onWebViewCreated(InAppWebViewController controller) {
    final override = widget.bridgeFactoryOverride;
    final bridge = override != null
        ? override(controller)
        : BridgeController(controller: controller);
    setState(() => _bridge = bridge);
    controller.addJavaScriptHandler(
      handlerName: 'onTerminalReady',
      callback: (_) {
        bridge.markReady();
        // Channel embed scales markdown text via --rdv-font-scale.
        bridge.setFontScale(ref.read(appearanceSettingsProvider).fontScale);
        return null;
      },
    );
  }

  Future<void> _handleBack() async {
    // Ask the embedded PWA to handle the gesture first — it may close an
    // open thread/modal instead. If the bridge says it didn't consume the
    // gesture (or isn't ready / returns `void`), pop the native route.
    final bridge = _bridge;
    final handled = bridge == null ? false : await bridge.back();
    if (!handled && mounted) {
      await Navigator.of(context).maybePop();
    }
  }

  @override
  Widget build(BuildContext context) {
    final asyncServer = ref.watch(activeServerProvider);
    // Channel embed visually scales markdown text via --rdv-font-scale;
    // push updates whenever the user changes the slider on the profile
    // appearance screen. cursorBlink is intentionally skipped — no
    // terminal is hosted on this route.
    ref.listen<AppearanceSettings>(appearanceSettingsProvider, (prev, next) {
      if (prev?.fontScale != next.fontScale) {
        _bridge?.setFontScale(next.fontScale);
      }
    });
    return Scaffold(
      backgroundColor: const Color(0xFF1A1B26),
      appBar: AppBar(
        backgroundColor: const Color(0xFF1A1B26),
        title: _ChannelTitle(widget.channelId),
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
          final url = origin.replace(path: '/m/channel/${widget.channelId}');
          final factory = widget.webViewFactory ?? const WebViewFactory();
          // Gate the WebView mount on cookie-seed completion. The
          // InAppWebView fires its initial GET as soon as it mounts; if
          // CookieManager.setCookie hadn't flushed yet, that request
          // would race the seed and CF Access would reject it. The
          // placeholder ColoredBox keeps the frame dark for the brief
          // seed window (typically a few ms).
          return FutureBuilder<void>(
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
              return factory.build(
                initialUrl: url,
                policy: NavigationPolicy(
                  serverOrigin: origin,
                  allowedPathPrefixes: const ['/m/channel/'],
                ),
                onLinkOpen: (_) {},
                onWebViewCreated: _onWebViewCreated,
                onProgressChanged: (p) {
                  if (mounted) setState(() => _progress = p);
                },
              );
            },
          );
        },
      ),
    );
  }
}

/// Resolves the AppBar title from [channelsListProvider] in isolation so
/// that list refreshes do not rebuild the surrounding [ChannelScreen]
/// (and, crucially, the WebView body).
///
/// Returns the generic "Channel" label whenever the list is loading,
/// errored, or simply doesn't contain the requested id (e.g. arriving
/// via deep-link before the cache is populated). The WebView is the
/// source of truth for actual channel content; the AppBar label is a
/// best-effort hint.
class _ChannelTitle extends ConsumerWidget {
  const _ChannelTitle(this.channelId);

  final String channelId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // Resolve the channel name from the project-scoped list. While
    // [activeNodeProvider] is loading or unset we just render the
    // generic fallback — the WebView is the source of truth for
    // content; this title is a best-effort hint.
    final node = ref.watch(activeNodeProvider).valueOrNull;
    final channels = ref.watch(channelsListProvider(node)).valueOrNull;
    final trimmed = channels
        ?.where((c) => c.id == channelId)
        .map((c) => c.name.trim())
        .firstOrNull;
    final name = (trimmed != null && trimmed.isNotEmpty) ? trimmed : null;
    return Text(
      name == null ? 'Channel' : '#$name',
      style: const TextStyle(color: Colors.white),
      overflow: TextOverflow.ellipsis,
    );
  }
}
