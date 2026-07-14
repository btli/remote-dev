import 'dart:async';

import 'package:flutter/foundation.dart';

import '../../application/add_host_flow_controller.dart';
import '../../domain/host_config.dart';
import '../../domain/instance_summary.dart';
import '../../domain/workspace_config.dart';
import '../auth/mobile_callback_login_launcher.dart';
import '../auth/pending_add_host_login.dart';

/// APP-GLOBAL completer for the state-independent add-host login.
///
/// This is the piece that makes interactive add-host survive the activity
/// recreation / GoRouter rebuild that disposes `AddHostScreen.State`. It is
/// created once at app boot (see `addHostLoginCompleterProvider`) and subscribes
/// to the shared deep-link broadcast stream. When a `remotedev://auth/callback`
/// arrives AND a matching [PendingAddHostLogin] record exists, it runs the WHOLE
/// remainder of the flow via [AddHostFlowController] and drives navigation — the
/// triggering screen need not still be alive.
///
/// Anti-forgery: a callback completes the pending add ONLY when its echoed
/// `state` EXACTLY matches the pending record's nonce. A missing/mismatched
/// `state` is ignored WITHOUT clearing the record (it may be a forged/unrelated
/// callback; the real one can still arrive). Non-callback URIs and callbacks
/// with no pending record are ignored so the reauth/workspace launchers (which
/// own their own in-flight subscription + nonce) are unaffected.
class AddHostLoginCompleter {
  AddHostLoginCompleter({
    required Stream<Uri> linkStream,
    required PendingAddHostLoginStore pendingStore,
    required AddHostFlowController controller,
    required void Function(WorkspaceConfig workspace) onSingleWorkspaceActivated,
    required void Function(HostConfig host, List<InstanceSummary> instances)
        onSupervisorDetected,
    required void Function(HostConfig host, Object error) onDetectFailed,
    required void Function(Object error) onUnexpectedError,
    Future<Uri?> Function()? initialLink,
  })  : _linkStream = linkStream,
        _pendingStore = pendingStore,
        _controller = controller,
        _onSingle = onSingleWorkspaceActivated,
        _onSupervisor = onSupervisorDetected,
        _onDetectFailed = onDetectFailed,
        _onUnexpectedError = onUnexpectedError,
        _initialLink = initialLink;

  final Stream<Uri> _linkStream;
  final PendingAddHostLoginStore _pendingStore;
  final AddHostFlowController _controller;
  final void Function(WorkspaceConfig) _onSingle;
  final void Function(HostConfig, List<InstanceSummary>) _onSupervisor;
  final void Function(HostConfig, Object) _onDetectFailed;

  /// Fired when [completeFromCallback] throws an UNEXPECTED error (not the
  /// modelled transient [AddHostDetectFailed]). The pending record is already
  /// cleared by then, so the caller should route the user somewhere sensible
  /// (e.g. the server list) rather than leave the trigger screen stranded.
  final void Function(Object error) _onUnexpectedError;

  /// Optional cold-start drain: the `remotedev://auth/callback` that launched
  /// the app (app was killed while the browser was open) arrives via
  /// `getInitialLink`, NOT the warm-start stream. Injected so it is testable and
  /// so a matching pending record is still completed after a cold start.
  final Future<Uri?> Function()? _initialLink;

  StreamSubscription<Uri>? _sub;

  /// Guards against a duplicate emit (Android can deliver a callback twice)
  /// re-entering completion for the same record while the async work is still
  /// in flight — the record is cleared on entry, but the two events can arrive
  /// in the same tick before the clear resolves.
  bool _completing = false;

  void start() {
    _sub ??= _linkStream.listen(
      (uri) => unawaited(handleLink(uri)),
      onError: (Object e) =>
          debugPrint('[AddHostFlow] link stream error: $e'),
    );
    final getInitial = _initialLink;
    if (getInitial != null) {
      unawaited(
        getInitial().then((uri) {
          if (uri != null) return handleLink(uri);
          return null;
        }).catchError(
          (Object e) => debugPrint('[AddHostFlow] getInitialLink failed: $e'),
        ),
      );
    }
  }

  Future<void> stop() async {
    await _sub?.cancel();
    _sub = null;
  }

  /// Visible for tests: process a single deep-link URI exactly as the live
  /// subscription would.
  @visibleForTesting
  Future<void> handleLink(Uri uri) async {
    if (!_isAuthCallback(uri)) return;
    // Re-entrancy guard: set BEFORE the first `await` and held across the WHOLE
    // body (try/finally) so two identical callbacks delivered in the SAME tick
    // — the live subscription dispatches `unawaited(handleLink(uri))`, so the
    // second isn't ordered after the first — can't both pass this check, read
    // the still-present record, and double-complete (duplicate workspace +
    // double navigation). The `finally` resets it on EVERY path (including the
    // early returns below), so a non-matching callback never permanently blocks
    // future add-host completions.
    if (_completing) return;
    _completing = true;
    try {
      final pending = await _pendingStore.read();
      if (pending == null) {
        // No pending add-host → this callback belongs to some other flow
        // (reauth / workspace open); its own launcher subscription handles it.
        // (Briefly ignoring a same-tick non-add-host callback is fine —
        // interactive login is single-in-flight and Android re-delivers.)
        return;
      }

      final result = parseMobileCallback(uri);
      if (result == null) {
        debugPrint('[AddHostFlow] callback unparseable — ignoring');
        return;
      }

      final returnedState = uri.queryParameters['state'];
      if (returnedState == null || returnedState != pending.state) {
        // Anti-forgery: only a callback echoing THIS pending record's nonce may
        // complete it. Keep the record so the genuine callback can still arrive.
        debugPrint(
          '[AddHostFlow] callback state ${returnedState == null ? 'missing' : 'mismatch'} '
          '— ignoring (record kept)',
        );
        return;
      }

      debugPrint('[AddHostFlow] callback matched pending record — completing');
      // Clear BEFORE running so a later duplicate emit finds no record.
      await _pendingStore.clear();
      try {
        final outcome = await _controller.completeFromCallback(
          origin: pending.origin,
          label: pending.label,
          callback: result,
        );
        switch (outcome) {
          case AddHostSingleWorkspaceActivated(:final workspace):
            debugPrint('[AddHostFlow] navigating /home (single workspace)');
            _onSingle(workspace);
          case AddHostSupervisorDetected(:final host, :final instances):
            debugPrint('[AddHostFlow] routing to workspace picker (supervisor)');
            _onSupervisor(host, instances);
          case AddHostDetectFailed(:final host, :final error):
            debugPrint('[AddHostFlow] detect failed — routing to servers');
            _onDetectFailed(host, error);
        }
      } catch (e, st) {
        // Unexpected throw (NOT the modelled transient AddHostDetectFailed): the
        // pending record is already cleared and the trigger screen is stuck on
        // the "Complete sign-in…" spinner. Route the user back to the server
        // list so they aren't stranded. [host] is unknown here (the throw may
        // predate host persistence), so pass null.
        debugPrint('[AddHostFlow] completion threw: $e\n$st — routing to servers');
        _onUnexpectedError(e);
      }
    } finally {
      _completing = false;
    }
  }

  static bool _isAuthCallback(Uri uri) =>
      uri.scheme == 'remotedev' &&
      uri.host == 'auth' &&
      uri.path == '/callback';
}
