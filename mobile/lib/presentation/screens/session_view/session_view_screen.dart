import 'dart:async';
import 'dart:convert';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_inappwebview/flutter_inappwebview.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../application/state/appearance_provider.dart';
import '../../../domain/appearance_settings.dart';
import '../../../domain/session_summary.dart';
import '../../../infrastructure/url/workspace_urls.dart';
import '../../../infrastructure/webview/bridge_controller.dart';
import '../../../infrastructure/webview/navigation_policy.dart';
import '../../../infrastructure/webview/webview_factory.dart';
import '../../router/app_router.dart' show routeObserver;
import '../sessions/sessions_tab_screen.dart' show sessionsApiProvider;
import '../server_picker/server_picker_screen.dart'
    show serverPickerDataProvider;
import '../webview_host/session_route_host.dart'
    show
        activeWorkspaceProvider,
        hostWorkspaceStoreProvider,
        mobileCredentialsStoreProvider,
        webViewCookieHarvesterProvider,
        webViewCookieSeederProvider;
import 'activity_pip.dart';
import 'mobile_input_bar.dart';
import 'session_status_bar.dart';
import 'session_switcher_sheet.dart';
import 'smart_key_strip.dart';

/// Production session view for `/home/session/:id`.
///
/// Composes:
/// - `SessionStatusBar` (top, fixed 44px, sits in the column)
/// - WebView (middle, height tracks the keyboard inset via LayoutBuilder)
/// - Chrome stack (bottom): `SmartKeyStrip` (44px) + `MobileInputBar` (56px) —
///   a fixed 100px-TALL block rendered inside a single floating Positioned so
///   they ride the keyboard together (smart keys ALWAYS stay visible above the
///   input bar instead of being hidden behind the keyboard). Note the chrome's
///   100px is its HEIGHT; its bottom OFFSET from the screen edge is the dynamic
///   `bottomReserve` (= max(keyboardInset, bottom safe-area padding)), which the
///   WebView reserves so the two stay flush. See the `bottomReserve` rationale
///   in `build`.
///
/// All six outbound bridge handlers (onTerminalReady, onSelectionChange,
/// onWantsPaste, onActivity, onLinkOpen, onFontSizeChanged) are registered in
/// `onWebViewCreated` (Spec §2.2 rule 1). All native→WebView calls go through
/// `BridgeController` (Spec §2.2 rule 2). The WebView shrinks to track the
/// keyboard inset so xterm.js sees a viewport resize and tmux reflows its grid;
/// the chrome floats above the keyboard via `Stack + Positioned`.
///
/// The state is also a `WidgetsBindingObserver` + `RouteAware`: it refits the
/// embedded terminal on app resume (gated on the session route being current,
/// so a covered/off-screen session never steals primary) and on route pop-back
/// (returning from a route stacked on top). A platform WebView emits no
/// page-level resize signal on those edges, so without this the xterm.js grid
/// would stay stale until the next pinch (remote-dev-u5q5.2).
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

class _SessionViewScreenState extends ConsumerState<SessionViewScreen>
    with WidgetsBindingObserver, RouteAware {
  BridgeController? _bridge;

  /// The live in-session activity status driving the status-bar pip. Seeded in
  /// [initState] from the route-supplied summary's last-known activity (so a
  /// session opened mid-run shows its real state immediately — subagent runs
  /// are long), then updated by the `onActivity` bridge handler as live agent
  /// hook transitions arrive over the WebSocket.
  SessionActivity _activity = SessionActivity.idle;
  final String _projectName = '';

  /// Echo guard for the terminal font size (remote-dev-u5q5.3). When the
  /// WebView reports a pinch-zoom commit via `onFontSizeChanged`, we update
  /// the appearance notifier — which fires `ref.listen` below. Without this
  /// guard we'd then push `setFontSize` back into the WebView that JUST told
  /// us the value, a redundant round-trip. We record the reported px here and
  /// skip the matching `ref.listen` push. See [FontSizeEchoGuard] for the
  /// read-and-clear contract and the stale-guard sequence it defends against.
  final FontSizeEchoGuard _fontSizeEchoGuard = FontSizeEchoGuard();

  /// The session's display name once resolved. Null until resolution
  /// completes; the header falls back to `initialSummary?.name` and then the
  /// neutral 'Session' label — it NEVER shows the raw session id.
  String? _resolvedName;

  @override
  void initState() {
    super.initState();
    // Seed the pip from the session's last-known activity (when the route
    // carried a summary) so opening a mid-run session reflects reality at once
    // rather than flashing 'Idle' until the next live hook transition.
    final seeded = widget.initialSummary?.activity;
    if (seeded != null) {
      _activity = seeded.toSessionActivity();
    }
    // Observe app lifecycle so we can refit the terminal on resume — a
    // backgrounded platform WebView emits no page-level resize signal, so
    // xterm.js wouldn't otherwise re-measure when the app returns to the
    // foreground (remote-dev-u5q5.2).
    WidgetsBinding.instance.addObserver(this);
    _resolveSessionName();
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    // Subscribe to the app-wide RouteObserver so `didPopNext` fires when a
    // route pushed on top of the session (Recordings / Settings) is popped,
    // letting us refit the terminal that was covered while unfocused.
    final route = ModalRoute.of(context);
    if (route is ModalRoute<void>) {
      routeObserver.subscribe(this, route);
    }
  }

  @override
  void dispose() {
    routeObserver.unsubscribe(this);
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    // On return to the foreground, force the embedded terminal to re-measure
    // + re-fit. The bridge call is guarded + queued (no-op pre-ready / on
    // older bridge builds).
    //
    // Gate on route currency: a covered session route (one with Recordings /
    // Appearance pushed ON TOP) stays MOUNTED, so this observer still fires on
    // resume. Refitting + focus-signaling an OFF-SCREEN WebView would re-elect
    // it as the primary tmux client and steal primary from whatever surface
    // the user is actually looking at. Only the current (top-of-stack) route
    // should refit on resume; the covered→uncovered transition is handled
    // separately by [didPopNext] when the covering route is popped
    // (remote-dev-u5q5.2).
    if (state == AppLifecycleState.resumed &&
        mounted &&
        (ModalRoute.of(context)?.isCurrent ?? false)) {
      _bridge?.refit();
    }
  }

  @override
  void didPopNext() {
    // A route that was stacked on top of this session has just been popped,
    // so the session view is visible again. Refit the terminal in case the
    // grid went stale (or another tmux client resized it) while it was
    // covered (remote-dev-u5q5.2).
    _bridge?.refit();
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

  /// Opens the session switcher (tapped via the title caret). On a pick: when
  /// the chosen session lives in a DIFFERENT workspace, switch the active
  /// workspace first (setActiveWorkspace + invalidate so the next screen
  /// rebinds its API client + WebView target), then replace this route with the
  /// chosen session. Same-session picks are a no-op.
  Future<void> _openSwitcher() async {
    final conn = await ref.read(activeWorkspaceProvider.future);
    if (!mounted || conn == null) return;
    final target = await showSessionSwitcher(
      context,
      currentSessionId: widget.sessionId,
      currentWorkspaceId: conn.workspace.id,
    );
    if (target == null || !mounted) return;
    final isSame = target.session.id == widget.sessionId &&
        target.workspace.id == conn.workspace.id;
    if (isSame) return;
    if (target.workspace.id != conn.workspace.id) {
      await ref
          .read(hostWorkspaceStoreProvider)
          .setActiveWorkspace(target.workspace.id);
      ref.invalidate(activeWorkspaceProvider);
      ref.invalidate(serverPickerDataProvider);
      if (!mounted) return;
    }
    context.pushReplacement(
      '/home/session/${target.session.id}',
      extra: target.session,
    );
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
        // Push the absolute terminal font size so the embed renders at the
        // user's chosen px immediately (remote-dev-u5q5.3). This replaces the
        // old behavior where the only terminal-size signal was setFontScale,
        // which the embed multiplied into the stored px every ready event.
        bridge.setFontSize(settings.terminalFontSize);
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
        // The bridge sends `{ state }` as an OBJECT, which arrives here as a
        // decoded Map after flutter_inappwebview's JSON round-trip — see
        // parseActivityArgs (remote-dev-sguu).
        final activity = parseActivityArgs(args);
        if (mounted) {
          setState(() => _activity = activity);
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

    controller.addJavaScriptHandler(
      handlerName: 'onFontSizeChanged',
      callback: (args) {
        // The embed reports a pinch-zoom commit as
        // `notifyToNative('onFontSizeChanged', { px })`. flutter_inappwebview
        // marshals the payload as the first arg — usually a Map `{px: n}`,
        // but parse defensively (it may arrive as a bare num on some
        // platforms). Mirror the value into the appearance setting AND record
        // it as the echo guard so the `ref.listen` push below skips re-sending
        // the size the WebView just told us (remote-dev-u5q5.3).
        final px = parseOnFontSizeChangedPayload(args);
        if (px == null) return null;
        _fontSizeEchoGuard.record(px);
        unawaited(
          ref.read(appearanceSettingsProvider.notifier).setTerminalFontSize(px),
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
    // Bottom safe-area inset (gesture-nav pill / home indicator). We read
    // `paddingOf`, NOT `viewPaddingOf`: `padding` is `viewPadding` minus
    // `viewInsets` floored at 0 — i.e. `max(viewPadding - viewInsets, 0)`.
    // That floor is the linchpin of the `bottomReserve` invariant below: as
    // the keyboard descends, `viewInsets.bottom` shrinks past `viewPadding`
    // and this value rises smoothly from 0 back up to the full safe area,
    // so there is no discontinuity at the dismiss frame.
    final bottomSafePadding = MediaQuery.paddingOf(context).bottom;
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
      if (prev?.terminalFontSize != next.terminalFontSize) {
        // Echo guard (remote-dev-u5q5.3): [FontSizeEchoGuard.shouldPush]
        // reads-and-CLEARS on every fire. If this change is the one the WebView
        // itself just reported via onFontSizeChanged (a pinch commit), it
        // returns false so we DON'T push it back — a redundant round-trip to
        // the WebView that already has the value. Clearing unconditionally
        // (not just on a match) prevents a stale guard from wrongly suppressing
        // a later legitimate push (see FontSizeEchoGuard's doc).
        if (_fontSizeEchoGuard.shouldPush(next.terminalFontSize)) {
          _bridge?.setFontSize(next.terminalFontSize);
        }
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
            // ONE shared bottom reserve drives both the WebView height AND the
            // floating chrome's offset, so they can never drift out of lockstep.
            //
            // The outer SafeArea has `bottom: false`, so `maxHeight` runs to the
            // PHYSICAL bottom of the screen (under the gesture-nav pill / home
            // indicator). The chrome is pinned at `Positioned(bottom:
            // bottomReserve)` and the WebView gives up the same `bottomReserve`,
            // so the chrome occupies the band [bottomReserve, bottomReserve+100]
            // from the screen bottom and the WebView's bottom edge lands at
            // exactly `bottomReserve + chromeHeight`. They are flush BY
            // CONSTRUCTION — no overlap, no gap — and this holds at every frame,
            // not just in steady state.
            //
            // We take `max(keyboardInset, bottomSafePadding)` so the reserve is:
            //   - keyboard UP   → the keyboard inset (which exceeds the safe
            //     area), so the WebView shrinks to track the keyboard and
            //     xterm.js refits its grid (visualViewport + ResizeObserver in
            //     Terminal.tsx) while the chrome rides just above the keyboard;
            //   - keyboard DOWN → the bottom safe area (inset is 0), so the
            //     chrome clears the gesture-nav pill / home indicator instead of
            //     sitting on top of the bottom terminal rows.
            // It is also CONTINUOUS through the dismiss animation: as the inset
            // descends past the safe area, `bottomSafePadding` (floored at
            // `max(viewPadding - viewInsets, 0)`) rises to meet it, so the max
            // dips smoothly to the crossover and back up — no one-frame WebView
            // contraction or chrome pop (the discontinuity the old branchy
            // `keyboardInset == 0 ? padding : inset` + conditional SafeArea had).
            final bottomReserve = math.max(keyboardInset, bottomSafePadding);
            final webViewHeight = constraints.maxHeight -
                statusBarHeight -
                chromeHeight -
                bottomReserve;
            // Clamp to >= 0 for tiny heights where status + chrome +
            // bottomReserve exceed maxHeight. The spacer below is then sized as
            // the EXACT remainder (not `chromeHeight + bottomReserve`) so the
            // Column always sums to <= maxHeight and never overflows.
            final clampedWebViewHeight = math.max(0.0, webViewHeight);
            return Stack(
              children: [
                Column(
                  children: [
                    SizedBox(
                      height: statusBarHeight,
                      child: SessionStatusBar(
                        projectName: _projectName.isEmpty ? null : _projectName,
                        sessionName: title,
                        activity: _activity,
                        onTap: () => unawaited(_openSwitcher()),
                        onMenuAction: _handleMenuAction,
                      ),
                    ),
                    SizedBox(
                      key: const Key('webview-frame'),
                      height: clampedWebViewHeight,
                      child: _Webview(
                        sessionId: widget.sessionId,
                        onWebViewCreated: _registerBridgeHandlers,
                      ),
                    ),
                    // Reserve space for the floating chrome so the column fills
                    // the screen; smart keys + input bar are rendered in the
                    // Stack overlay so they ride the keyboard together. Size
                    // this as the EXACT remaining height after the status bar
                    // and the (clamped) WebView — NOT `chromeHeight +
                    // bottomReserve` — so that when the WebView clamps to 0 on
                    // tiny screens the three column slices still sum to <=
                    // maxHeight and the Column never overflows. In steady states
                    // (WebView un-clamped) this remainder equals `chromeHeight +
                    // bottomReserve` anyway.
                    SizedBox(
                      height: math.max(
                        0.0,
                        constraints.maxHeight -
                            statusBarHeight -
                            clampedWebViewHeight,
                      ),
                    ),
                  ],
                ),
                // Float the chrome at the SAME `bottomReserve` the WebView
                // gave up, so its top edge meets the WebView's bottom edge
                // flush at every frame (see the bottomReserve rationale above).
                // No SafeArea wrapper: `bottomReserve` already accounts for the
                // gesture-nav / home-indicator inset (keyboard down) and the
                // keyboard inset (keyboard up), so a `SafeArea(bottom: ...)`
                // here would double-count and reintroduce the dismiss-frame pop.
                Positioned(
                  left: 0,
                  right: 0,
                  bottom: bottomReserve,
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
              ],
            );
          },
        ),
      ),
    );
  }
}

class _Webview extends ConsumerStatefulWidget {
  const _Webview({required this.sessionId, required this.onWebViewCreated});

  final String sessionId;
  final void Function(InAppWebViewController) onWebViewCreated;

  @override
  ConsumerState<_Webview> createState() => _WebviewState();
}

class _WebviewState extends ConsumerState<_Webview> {
  /// The resolved WebView target, computed exactly ONCE in [initState] and
  /// cached. Resolving in `build()` would create a fresh Future every frame,
  /// so any cosmetic parent rebuild (e.g. a keyboard-inset change recomputing
  /// `webViewHeight`) would restart the [FutureBuilder] from
  /// `ConnectionState.waiting` — briefly flashing the blank 'No active server
  /// configured.' state and re-running the cookie-seeding side effect. The
  /// target depends only on the active workspace, and this view is pinned to
  /// its session for its lifetime, so caching once is correct.
  late final Future<_WebviewTarget?> _targetFuture;

  @override
  void initState() {
    super.initState();
    _targetFuture = _resolveTarget();
  }

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<_WebviewTarget?>(
      future: _targetFuture,
      builder: (context, snap) {
        // Still resolving: show a neutral dark placeholder, NOT the error
        // text. Distinguishing waiting from a genuine null target is what
        // stops the blank-state flash during the first async resolve.
        if (snap.connectionState == ConnectionState.waiting) {
          return const ColoredBox(color: Color(0xFF1A1B26));
        }
        final target = snap.data;
        if (target == null) {
          // Resolution is done and yielded no server — genuinely unconfigured.
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
        final origin = target.origin;
        final basePath = target.basePath;
        final urls = WorkspaceUrls(origin.toString(), basePath);
        final url = Uri.parse(urls.web('/m/session/${widget.sessionId}'));
        return WebViewFactory().build(
          initialUrl: url,
          policy: NavigationPolicy(
            serverOrigin: origin,
            basePath: basePath,
            allowedPathPrefixes: ['$basePath/m/session/'],
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
          onWebViewCreated: widget.onWebViewCreated,
          // Diagnostic logging (bd remote-dev-l4q6 Bug 4). Without an on-
          // device repro of the blank-screen / submit-does-nothing bug we
          // surface page-load + console output to `flutter logs` so the
          // next iteration can see where the embedded PWA stops.
          //
          // Opportunistic CF_Authorization harvest (remote-dev off-LAN CF
          // Access): once the host page has loaded (and any CF Access edge
          // challenge has resolved), pull the edge cookie out of the WebView
          // jar into the credential store so subsequent Dio API calls pass
          // the Cloudflare perimeter. Best-effort — see [_harvestEdgeCookie].
          onLoadStop: (_, uri) {
            // Redact query/fragment: during CF Access / IdP flows the URL can
            // carry `code`/`state`/callback material. Log only origin + path.
            debugPrint(
              '[SessionView] loadStop '
              '${uri == null ? '(null)' : '${uri.scheme}://${uri.host}${uri.path}'}',
            );
            unawaited(_harvestEdgeCookie(target));
          },
          onProgressChanged: (progress) =>
              debugPrint('[SessionView] progress $progress'),
          onConsoleMessage: (msg) => debugPrint(
            '[SessionView][console] ${msg.messageLevel}: ${msg.message}',
          ),
        );
      },
    );
  }

  /// Resolves the active connection into the WebView's host [origin] +
  /// workspace [basePath], AND best-effort seeds the platform CookieManager
  /// with the persisted CF JWT before the WebView mounts. Seeding failures
  /// are swallowed so they don't block the WebView (the WebView will hit a
  /// CF Access challenge instead, and the user re-auths via /reauth).
  Future<_WebviewTarget?> _resolveTarget() async {
    final conn = await ref.read(activeWorkspaceProvider.future);
    if (conn == null) return null;
    // The WebView loads `<origin><basePath>/m/session/<id>`. The cookie is
    // seeded against the bare HOST origin (CF cookies are host/domain-
    // scoped); for a migrated single-workspace config basePath is '' so the
    // navigated URL is exactly `<origin>/m/session/<id>`.
    final origin = Uri.parse(conn.host.origin);
    try {
      final credentials = ref.read(mobileCredentialsStoreProvider);
      // Seed the workspace's instance cookies (OIDC session and/or CF edge).
      final cookies = await credentials.getInstanceCookies(
        conn.host.id,
        conn.workspace.id,
      );
      if (cookies.isNotEmpty) {
        await ref
            .read(webViewCookieSeederProvider)
            .seedAuthCookies(serverOrigin: origin, cookies: cookies);
      }
    } catch (_) {
      // intentional: see seeder rationale in ChannelScreen._seedCookie.
    }
    return _WebviewTarget(
      hostId: conn.host.id,
      origin: origin,
      basePath: conn.workspace.basePath,
    );
  }

  /// Harvests the host-wide `CF_Authorization` edge cookie out of the WebView
  /// jar after the page loads, persisting it as a host auth cookie so the Dio
  /// `CfAuthInterceptor` sends it on every API call (remote-dev off-LAN CF
  /// Access). Best-effort and opportunistic: on-LAN there is no CF edge so the
  /// jar holds no `CF_Authorization` and this is a no-op; off-LAN, once the
  /// user completes the interactive CF Access login in the WebView, the cookie
  /// is present and gets persisted. Swallows + logs all failures (mirroring
  /// the cookie-seed try/catch) so it can never block or break the WebView.
  Future<void> _harvestEdgeCookie(_WebviewTarget target) async {
    try {
      final harvested = await ref
          .read(webViewCookieHarvesterProvider)
          .harvestCfAuthorization(serverOrigin: target.origin);
      if (harvested == null) return; // on-LAN / challenge not yet completed
      await ref
          .read(mobileCredentialsStoreProvider)
          .upsertHostAuthCookie(target.hostId, harvested);
      debugPrint(
        '[SessionView] harvested CF_Authorization for ${target.origin.host}',
      );
    } catch (err) {
      // Best-effort: a failed harvest must not break the terminal. The Dio
      // client simply keeps hitting the CF 302 until the next load harvests.
      debugPrint('[SessionView] CF_Authorization harvest failed: $err');
    }
  }
}

/// The resolved WebView target: the [hostId] (used to persist the harvested
/// host-wide CF cookie), the bare host [origin] (used for cookie scoping, the
/// CF_Authorization harvest, and the [NavigationPolicy] origin gate) plus the
/// workspace [basePath] (`''` or `/<slug>`) that prefixes the navigated `/m/*`
/// URL and the in-surface allow list.
class _WebviewTarget {
  const _WebviewTarget({
    required this.hostId,
    required this.origin,
    required this.basePath,
  });
  final String hostId;
  final Uri origin;
  final String basePath;
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
    final mode =
        isHttp ? LaunchMode.inAppBrowserView : LaunchMode.externalApplication;
    final ok = await launchUrl(uri, mode: mode);
    if (!ok) {
      debugPrint('[SessionView] launchUrl returned false for $uri');
    }
  } catch (err) {
    debugPrint('[SessionView] launchUrl threw for $uri: $err');
  }
}

/// Extracts the px size from an `onFontSizeChanged` JS-handler callback's args
/// (remote-dev-u5q5.3).
///
/// The embed fires `notifyToNative('onFontSizeChanged', { px })`, which
/// flutter_inappwebview delivers as the first callback arg — canonically a
/// `Map {px: n}`. This parses that shape and also tolerates a bare numeric
/// first arg, a double (rounded), and a num-as-String, returning null when
/// nothing parseable is present so the handler no-ops rather than pushing a
/// garbage size into the appearance store.
///
/// Top-level + `@visibleForTesting` so the defensive parsing can be unit
/// tested without standing up the (unavailable-under-flutter_test) WebView
/// platform.
@visibleForTesting
int? parseOnFontSizeChangedPayload(List<dynamic> args) {
  if (args.isEmpty) return null;
  final first = args.first;
  dynamic raw = first;
  if (first is Map) {
    raw = first['px'];
  }
  if (raw is int) return raw;
  if (raw is double) return raw.round();
  if (raw is num) return raw.round();
  if (raw is String) {
    final parsed = num.tryParse(raw);
    if (parsed != null) return parsed.round();
  }
  return null;
}

/// One-shot echo guard for the terminal font size (remote-dev-u5q5.3).
///
/// The WebView reports a pinch-zoom commit via `onFontSizeChanged`; the session
/// screen mirrors that px into the appearance notifier, which then fires its
/// `ref.listen`. Without a guard, the listener would push `setFontSize` straight
/// back into the WebView that JUST reported the value — a redundant round-trip.
///
/// [record] stores the px the WebView reported; [shouldPush] is called by the
/// listener for EVERY terminalFontSize change and returns whether to push,
/// always CLEARING the recorded value (read-and-clear) — even on a match.
///
/// Clearing on every call (not only on a match) is the crux: a clear-on-match-
/// only guard can go stale and wrongly suppress a later legitimate push. The
/// concrete failure it prevents:
///   1. Setting is 14; the user pinch-commits at the baseline 14. The embed
///      fires `onFontSizeChanged(14)` unconditionally on every commit, so
///      [record] stores 14 — but `setTerminalFontSize(14)` is a no-op, so the
///      listener never fires and the guard is never consumed.
///   2. The user drags the slider to 16 → listener fires. With read-and-clear,
///      [shouldPush] sees recorded 14 != 16, clears it, and returns true (push
///      16). A clear-on-match-only guard would still hold 14 here.
///   3. The user drags back to 14 → listener fires. The stale guard (14) would
///      match and wrongly suppress the push, leaving the WebView rendering 16
///      while the setting says 14. With read-and-clear the guard is already
///      empty, so [shouldPush] returns true and 14 is pushed correctly.
@visibleForTesting
class FontSizeEchoGuard {
  int? _recorded;

  /// Record the px the WebView just reported via `onFontSizeChanged`.
  void record(int px) => _recorded = px;

  /// Returns whether the listener should push [next] to the WebView, always
  /// clearing the recorded value. Returns false ONLY when [next] equals the
  /// value the WebView itself reported (the echo we want to suppress).
  bool shouldPush(int next) {
    final recorded = _recorded;
    _recorded = null;
    return recorded != next;
  }
}
