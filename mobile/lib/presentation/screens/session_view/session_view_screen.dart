import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_inappwebview/flutter_inappwebview.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../application/state/appearance_provider.dart';
import '../../../domain/appearance_settings.dart';
import '../../../domain/session_summary.dart';
import '../../../infrastructure/webview/bridge_controller.dart';
import '../../../infrastructure/webview/navigation_policy.dart';
import '../../../infrastructure/webview/webview_factory.dart';
import '../sessions/sessions_tab_screen.dart' show sessionsApiProvider;
import '../webview_host/session_route_host.dart'
    show
        activeWorkspaceProvider,
        mobileCredentialsStoreProvider,
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
    this.initialSummary,
    super.key,
  });

  final String sessionId;

  /// Optional pre-resolved summary for the session, passed via the route's
  /// `extra` when navigation originates from a surface that already holds the
  /// object (the Sessions list, a freshly-created session). When present, the
  /// header shows the real name immediately. When absent (notification / deep
  /// link cold-start), the name is resolved from the sessions list API and the
  /// header shows a neutral 'Session' label until then — never the raw id.
  final SessionSummary? initialSummary;

  @override
  ConsumerState<SessionViewScreen> createState() => _SessionViewScreenState();
}

class _SessionViewScreenState extends ConsumerState<SessionViewScreen> {
  BridgeController? _bridge;
  SessionActivity _activity = SessionActivity.idle;
  final String _projectName = '';

  /// The session's display name once resolved. Null until resolution
  /// completes; the header falls back to `initialSummary?.name` and then the
  /// neutral 'Session' label — it NEVER shows the raw session id.
  String? _resolvedName;

  @override
  void initState() {
    super.initState();
    _resolveSessionName();
  }

  /// Resolves the session's display name for the header.
  ///
  /// If the route handed us an [SessionViewScreen.initialSummary] (Sessions
  /// list / freshly-created session), use its name directly — no network
  /// call. Otherwise (notification / deep-link cold-start) fetch the sessions
  /// list and match on [SessionViewScreen.sessionId].
  ///
  /// We list rather than GET `/api/sessions/[id]` because the by-id endpoint
  /// is `withAuth` (session-cookie only) server-side, whereas `list()` goes
  /// through `withApiAuth` and so works with the mobile Bearer key.
  Future<void> _resolveSessionName() async {
    // When the route already handed us a summary, the build-time fallback
    // (`title = _resolvedName ?? widget.initialSummary?.name ?? 'Session'`)
    // already renders the real name, so there is nothing async to do — and
    // we must NOT call setState during initState.
    if (widget.initialSummary != null) return;
    try {
      final sessions = await ref.read(sessionsApiProvider).list();
      if (!mounted) return;
      for (final s in sessions) {
        if (s.id == widget.sessionId) {
          setState(() => _resolvedName = s.name);
          return;
        }
      }
    } catch (err) {
      // Resolution is best-effort: a failed or unauthorized list must not
      // crash the terminal. The header keeps showing 'Session'.
      debugPrint('[SessionView] name resolution failed: $err');
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
        // PWA parity (bd remote-dev-e1b9): the desktop/PWA shell auto-copies
        // selections to the system clipboard via xterm's native
        // copy-on-selection. Mirror that here — write the selection
        // directly to the clipboard with no SnackBar prompt. A SnackBar
        // would conflict with the keyboard chrome and adds a UX step that
        // the rest of the app deliberately avoids.
        final selection = args.isNotEmpty ? args.first?.toString() : null;
        if (selection != null && selection.isNotEmpty) {
          Clipboard.setData(ClipboardData(text: selection));
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
        final raw = args.isNotEmpty ? args.first?.toString() : null;
        if (raw == null || raw.isEmpty) return null;
        final uri = Uri.tryParse(raw);
        if (uri != null) {
          unawaited(_openExternal(uri));
        }
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

  /// Dispatches an overflow-menu pick from [SessionStatusBar] (bd
  /// remote-dev-eygp).
  Future<void> _handleMenuAction(SessionMenuAction action) async {
    switch (action) {
      case SessionMenuAction.suspend:
        await _suspendSession();
      case SessionMenuAction.viewRecordings:
        _viewRecordings();
      case SessionMenuAction.delete:
        await _deleteSession();
    }
  }

  Future<void> _suspendSession() async {
    final api = ref.read(sessionsApiProvider);
    try {
      await api.suspend(widget.sessionId);
      if (!mounted) return;
      Navigator.of(context).maybePop();
    } catch (err) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Failed to suspend: $err')),
      );
    }
  }

  /// Routes to the embedded `/m/recording` listing for this session.
  ///
  /// The Flutter app's [RecordingScreen] is keyed by a recording id, but
  /// the host PWA's `/m/recording` path also serves a list view when no id
  /// is supplied. We push the session-scoped variant so the user lands on
  /// the recordings for the currently active session — matching the PWA's
  /// `onViewRecordings` callback semantics.
  void _viewRecordings() {
    context.push('/home/recording/${widget.sessionId}');
  }

  Future<void> _deleteSession() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: const Color(0xFF24283B),
        title: const Text(
          'Delete session?',
          style: TextStyle(color: Colors.white),
        ),
        content: const Text(
          'This will kill the tmux session and remove it from the list.',
          style: TextStyle(color: Colors.white70),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: const Text('Cancel'),
          ),
          TextButton(
            style: TextButton.styleFrom(
              foregroundColor: const Color(0xFFF7768E),
            ),
            onPressed: () => Navigator.of(ctx).pop(true),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    final api = ref.read(sessionsApiProvider);
    try {
      await api.close(widget.sessionId);
      if (!mounted) return;
      Navigator.of(context).maybePop();
    } catch (err) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Failed to delete: $err')),
      );
    }
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
    // Header title: resolved name, else the route-supplied summary name,
    // else a neutral label. CRITICAL: no branch falls back to
    // `widget.sessionId`, so the raw UUID is never rendered (bd Task F).
    final title = _resolvedName ?? widget.initialSummary?.name ?? 'Session';
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
                        sessionName: title,
                        activity: _activity,
                        onMenuAction: _handleMenuAction,
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
            // NavigationPolicy classifies cross-origin / non-/m navigations
            // as `interceptAndOpenExternally`; fire the same launchUrl
            // pipeline the JS bridge uses so URL-tap (xterm.js -> onLink
            // bridge) AND click-through (anchor inside the PWA without
            // `target=_blank`) both reach the OS browser sheet.
            //
            // See bd remote-dev-pmhg.
            unawaited(_openExternal(uri));
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
    final conn = await ref.read(activeWorkspaceProvider.future);
    if (conn == null) return null;
    // The WebView loads `<origin>/m/session/<id>`. base-path prefixing is
    // Task B; for a migrated single-workspace config basePath is '' so the
    // origin is exactly the host origin.
    final origin = Uri.parse(conn.host.origin);
    try {
      final credentials = ref.read(mobileCredentialsStoreProvider);
      // CF token is host-wide.
      final cfToken = await credentials.getHostCfToken(conn.host.id);
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

/// Hands tapped links off to the OS browser sheet (Custom Tabs on
/// Android, SFSafariViewController on iOS via `inAppBrowserView`) so the
/// user stays in the app's context. Falls back to
/// `LaunchMode.externalApplication` for non-http schemes (mailto:, tel:,
/// etc.). Failures are swallowed — nothing in the terminal should crash
/// on a bad URL paste.
///
/// See bd remote-dev-pmhg.
Future<void> _openExternal(Uri uri) async {
  try {
    final isHttp = uri.scheme == 'http' || uri.scheme == 'https';
    final mode = isHttp
        ? LaunchMode.inAppBrowserView
        : LaunchMode.externalApplication;
    final ok = await launchUrl(uri, mode: mode);
    if (!ok) {
      debugPrint('[SessionView] launchUrl returned false for $uri');
    }
  } catch (err) {
    debugPrint('[SessionView] launchUrl threw for $uri: $err');
  }
}
