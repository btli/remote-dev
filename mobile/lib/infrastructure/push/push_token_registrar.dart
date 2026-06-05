import 'dart:async';
import 'dart:io';

import 'package:flutter/foundation.dart';

import '../../application/ports/api_client_port.dart';
import '../../application/ports/connectivity_port.dart';
import '../../application/ports/host_workspace_store.dart';
import '../../application/ports/push_port.dart';
import '../../domain/host_config.dart';
import '../../domain/workspace_config.dart';
import '../auth/mobile_credentials.dart';

/// Registers the FCM token with every saved WORKSPACE. Subscribes to
/// onTokenRefresh and re-registers across all workspaces on each event.
///
/// Spec §5: the deprecated app only re-registered with the *active* server, so
/// users with multiple servers stopped receiving notifications from non-active
/// servers after a token rotation. This class is the explicit fix.
///
/// Multi-workspace migration (Task D3): the registrar iterates the
/// Host/Workspace store. For each workspace it builds a
/// [RemoteDevClient.forWorkspace] (origin + basePath + per-workspace API key +
/// host-wide CF cookie) and POSTs the token to `/api/notifications/push-token`.
/// Workspaces with no stored API key AND no session cookies are skipped (they
/// were never signed into). OIDC workspaces authenticate by cookie and have no
/// API key, so a stored auth cookie is just as valid a "signed-in" signal as an
/// API key — the client built by [clientFactory] cookie-authenticates either
/// way.
///
/// Background-POST constraint: the workspace clients are constructed with NO
/// interactive refresh, so a token POST against a workspace with a stale CF
/// cookie fails-and-logs rather than popping a system browser.
///
/// Retry-on-failure (remote-dev-0ir2): a registration can fail transiently —
/// classically the app is launched behind the screensaver, Doze restricts the
/// app's network, and EVERY workspace POST fails `Failed host lookup` even
/// though the device is otherwise reachable. The deprecated behaviour logged
/// and forgot, so the token never reached the instance and push silently never
/// worked until the next token refresh. The registrar now remembers every
/// workspace whose registration of the *current* token has not yet succeeded
/// ([_pending]) and retries them when:
///   • connectivity is (re)gained ([ConnectivityPort.onConnectivityChanged]),
///   • the app is resumed (main.dart drives [retryPending] from a lifecycle
///     observer — foregrounding is what un-Dozes the network), and
///   • a bounded exponential backoff timer fires (safety net for when neither
///     event arrives).
/// Each successful POST clears that workspace from [_pending]; once nothing is
/// pending the backoff timer stops.
///
/// Concurrency: at most one registration pass (register-all OR retry) runs at a
/// time ([_busy]); triggers that arrive mid-pass coalesce into a single
/// follow-up ([_reregisterQueued]/[_retryQueued]) run by [_afterPass] rather
/// than racing [_pending]. [stop] latches [_stopped] so no late pass re-arms
/// the backoff timer.
class PushTokenRegistrar {
  PushTokenRegistrar({
    required this.push,
    required this.store,
    required this.credentials,
    required this.clientFactory,
    required this.deviceId,
    this.connectivity,
    this.backoffBase,
    this.backoffCap = const Duration(minutes: 5),
  })  : assert(
          backoffBase == null || backoffBase > Duration.zero,
          'backoffBase must be positive (or null to disable the timer); a zero '
          'base would arm a zero-delay timer that spins.',
        ),
        _nextBackoff = backoffBase ?? Duration.zero;

  final PushPort push;

  /// Source of truth for hosts + workspaces.
  final HostWorkspaceStore store;

  /// Reads the per-workspace API key and/or auth cookies (to decide whether a
  /// workspace was ever signed into) before building a client for it.
  final MobileCredentialsStore credentials;

  /// Builds an [ApiClientPort] for a (host, workspace) pair. Production wires
  /// [RemoteDevClient.forWorkspace]; tests substitute a fake. MUST NOT carry an
  /// interactive refresh — see the class doc.
  final ApiClientPort Function(HostConfig host, WorkspaceConfig workspace)
      clientFactory;

  final String deviceId;

  /// Optional: drives a retry whenever connectivity is regained. When null
  /// (e.g. in unit tests that don't exercise the connectivity path) no
  /// connectivity subscription is created.
  final ConnectivityPort? connectivity;

  /// Optional: base delay for the backoff retry timer. When null the timer is
  /// disabled (tests that don't want a background timer leave it null). Must be
  /// strictly positive when set (see the constructor assert).
  final Duration? backoffBase;

  /// Ceiling for the exponential backoff delay.
  final Duration backoffCap;

  static const _pushPath = '/api/notifications/push-token';

  StreamSubscription<String>? _refreshSub;
  StreamSubscription<bool>? _connectivitySub;
  Timer? _backoffTimer;
  Duration _nextBackoff;

  /// The most recent token we are trying to register. Null until [start] /
  /// [registerWithAll] has run.
  String? _lastToken;

  /// Workspace ids whose registration of [_lastToken] has not yet succeeded.
  final Set<String> _pending = <String>{};

  /// A registration pass (register-all OR retry-pending) is currently running.
  bool _busy = false;

  /// A register-all (refreshed token) arrived mid-pass — a FULL re-register of
  /// the latest token must run afterward (a pending-only retry is not enough: a
  /// refreshed token must also reach already-registered workspaces).
  bool _reregisterQueued = false;

  /// A retry trigger (connectivity / resume / backoff) arrived mid-pass.
  bool _retryQueued = false;

  /// [stop] has been called — suppress any further passes / timer re-arming.
  bool _stopped = false;

  /// Initialize push, register the current token with every workspace, and
  /// subscribe to refresh + connectivity. Returns true on success.
  Future<bool> start() async {
    final ok = await push.initialize();
    if (!ok) {
      debugPrint('[Push] registrar.start: init failed; skipping registration');
      return false;
    }
    final token = await push.getToken();
    if (token != null) {
      await registerWithAll(token);
    }
    _refreshSub = push.onTokenRefresh.listen(registerWithAll);
    _connectivitySub = connectivity?.onConnectivityChanged
        .where((online) => online)
        .listen((_) => unawaited(_retryPending()));
    return true;
  }

  /// POST [token] to every saved workspace that has a stored API key OR stored
  /// session cookies. Per-workspace failures don't block the others; a failed
  /// workspace is remembered in [_pending] and retried later. Coalesces with an
  /// in-flight pass via [_reregisterQueued].
  Future<void> registerWithAll(String token) async {
    if (_stopped) return;
    _lastToken = token;
    if (_busy) {
      _reregisterQueued = true;
      return;
    }
    _busy = true;
    try {
      final platform = _platform;
      for (final ws in await store.loadWorkspaces()) {
        if (_stopped) return;
        await _attempt(ws, token, platform);
      }
    } finally {
      _busy = false;
      _afterPass();
    }
  }

  /// Retry workspaces whose registration of the current token has not yet
  /// succeeded. No-ops when there is no token or nothing pending. Safe to call
  /// repeatedly; wired to app-resume in main.dart and to connectivity-restored
  /// internally.
  Future<void> retryPending() => _retryPending();

  Future<void> _retryPending() async {
    if (_stopped) return;
    final token = _lastToken;
    if (token == null || _pending.isEmpty) return;
    if (_busy) {
      _retryQueued = true;
      return;
    }
    _busy = true;
    try {
      final platform = _platform;
      final byId = {
        for (final w in await store.loadWorkspaces()) w.id: w,
      };
      for (final id in _pending.toList()) {
        if (_stopped) return;
        final ws = byId[id];
        if (ws == null) {
          _pending.remove(id); // workspace removed since it was queued
          continue;
        }
        await _attempt(ws, token, platform);
      }
    } finally {
      _busy = false;
      _afterPass();
    }
  }

  /// Run the highest-priority queued follow-up after a pass: a full re-register
  /// (refreshed token) beats a pending-only retry; with neither queued, fall
  /// back to (re)scheduling the backoff timer for anything still pending.
  /// No-op once [stop] has run.
  void _afterPass() {
    if (_stopped) return;
    if (_reregisterQueued) {
      _reregisterQueued = false;
      _retryQueued = false; // a full re-register supersedes a pending-only retry
      final token = _lastToken;
      if (token != null) unawaited(registerWithAll(token));
      return;
    }
    if (_retryQueued) {
      _retryQueued = false;
      unawaited(_retryPending());
      return;
    }
    _scheduleBackoffIfNeeded();
  }

  /// Attempt a single workspace registration, updating [_pending]: removed on
  /// success or when the workspace is not (or no longer) signed in; added on a
  /// network/auth failure so a later trigger retries it.
  Future<void> _attempt(
    WorkspaceConfig ws,
    String token,
    String platform,
  ) async {
    // Never signed into this workspace (no API key AND no session cookies) →
    // nothing to register against. OIDC workspaces authenticate by cookie and
    // have no API key; the clientFactory still cookie-auths the POST.
    final apiKey = await credentials.getWorkspaceApiKey(ws.id);
    final cookies = await credentials.getWorkspaceAuthCookies(ws.id);
    if ((apiKey == null || apiKey.isEmpty) && cookies.isEmpty) {
      _pending.remove(ws.id);
      return;
    }

    final host = await store.loadHost(ws.hostId);
    if (host == null) {
      _pending.remove(ws.id);
      return;
    }

    try {
      final client = clientFactory(host, ws);
      await client.post(
        _pushPath,
        body: {'token': token, 'platform': platform, 'deviceId': deviceId},
      );
      _pending.remove(ws.id);
    } catch (e) {
      _pending.add(ws.id);
      debugPrint('[Push] register on workspace ${ws.id} failed: $e');
    }
  }

  /// (Re)schedule the backoff timer based on [_pending]. Empty → cancel and
  /// reset the delay. Non-empty with no timer running → schedule one at the
  /// current delay and double it (capped) for next time. No-op when the timer
  /// is disabled ([backoffBase] null) or after [stop].
  void _scheduleBackoffIfNeeded() {
    final base = backoffBase;
    if (base == null || _stopped) return;
    if (_pending.isEmpty) {
      _backoffTimer?.cancel();
      _backoffTimer = null;
      _nextBackoff = base;
      return;
    }
    if (_backoffTimer != null) return;
    final delay = _nextBackoff;
    _nextBackoff = _doubled(_nextBackoff);
    _backoffTimer = Timer(delay, () {
      _backoffTimer = null;
      unawaited(_retryPending());
    });
  }

  Duration _doubled(Duration d) {
    final next = d * 2;
    return next > backoffCap ? backoffCap : next;
  }

  String get _platform => Platform.isIOS ? 'ios' : 'android';

  /// DELETE the token from a single workspace (used on sign-out /
  /// delete-workspace). Best-effort: a missing workspace, a workspace that was
  /// never signed into (no API key AND no session cookies), or a network
  /// failure is swallowed (logged) so the caller's delete/sign-out is never
  /// blocked. Also drops the workspace from [_pending] so a signed-out
  /// workspace is never retried.
  Future<void> unregisterWorkspace(String workspaceId) async {
    // Sign-out / delete: stop retrying this workspace regardless of outcome.
    _pending.remove(workspaceId);
    _scheduleBackoffIfNeeded();

    final token = await push.getToken();
    if (token == null) return;

    final workspaces = await store.loadWorkspaces();
    WorkspaceConfig? target;
    for (final ws in workspaces) {
      if (ws.id == workspaceId) {
        target = ws;
        break;
      }
    }
    if (target == null) return;

    // Never signed into this workspace (no API key AND no session cookies) →
    // nothing to unregister against. OIDC workspaces authenticate by cookie and
    // have no API key; the clientFactory still cookie-auths the DELETE.
    final apiKey = await credentials.getWorkspaceApiKey(target.id);
    final cookies = await credentials.getWorkspaceAuthCookies(target.id);
    if ((apiKey == null || apiKey.isEmpty) && cookies.isEmpty) return;

    final host = await store.loadHost(target.hostId);
    if (host == null) return;

    try {
      final client = clientFactory(host, target);
      await client.delete(
        _pushPath,
        body: {'token': token},
      );
    } catch (e) {
      debugPrint('[Push] unregister on workspace $workspaceId failed: $e');
    }
  }

  Future<void> stop() async {
    _stopped = true;
    await _refreshSub?.cancel();
    _refreshSub = null;
    await _connectivitySub?.cancel();
    _connectivitySub = null;
    _backoffTimer?.cancel();
    _backoffTimer = null;
  }
}
