import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../application/ports/biometric_port.dart';
import '../../../domain/biometric_settings.dart';
import '../../../infrastructure/biometric/biometric_settings_store.dart';
import 'biometric_lock_screen.dart';

/// DI seam for the biometric implementation. Overridden in `main.dart` with
/// [LocalAuthService]; tests override with a mock.
final biometricPortProvider = Provider<BiometricPort>((ref) {
  throw UnimplementedError(
    'biometricPortProvider must be overridden in main.dart',
  );
});

/// DI seam for the settings store. Overridden in `main.dart` with a store
/// bound to the existing `secureStorageProvider`.
final biometricSettingsStoreProvider = Provider<BiometricSettingsStore>((ref) {
  throw UnimplementedError(
    'biometricSettingsStoreProvider must be overridden in main.dart',
  );
});

/// Convenience read-side provider; the settings screen invalidates this
/// after a save to refresh any consumers.
final biometricSettingsProvider = FutureProvider<BiometricSettings>((ref) {
  return ref.read(biometricSettingsStoreProvider).load();
});

/// Layers a biometric lock screen over [child] when the app is locked.
///
/// Lock triggers:
///   1. Cold start, when settings.enabled && settings.requireOnColdStart.
///   2. App resumed from background after settings.gracePeriodSeconds have
///      elapsed since last successful unlock.
///
/// On each fresh lock the OS biometric / device-credential prompt is presented
/// automatically (at most once per lock episode) so the user doesn't have to
/// tap "Authenticate" first. After a cancel/failure the prompt is NOT
/// re-presented automatically — the user retries via the on-screen button — so
/// a cancel can never trap the user in a re-prompt loop. The button stays as
/// the manual fallback.
///
/// We use a [Stack] (rather than swapping the whole subtree) so the wrapped
/// widget keeps its state — no router pop, no WebView teardown.
class BiometricLockOverlay extends ConsumerStatefulWidget {
  const BiometricLockOverlay({required this.child, super.key});

  final Widget child;

  @override
  ConsumerState<BiometricLockOverlay> createState() =>
      _BiometricLockOverlayState();
}

class _BiometricLockOverlayState extends ConsumerState<BiometricLockOverlay>
    with WidgetsBindingObserver {
  bool _locked = false;
  // Sentinel "long ago" so the first foreground always exceeds any grace.
  DateTime _lastUnlock = DateTime.fromMillisecondsSinceEpoch(0);
  // Inline error shown on the lock screen when auth fails. A SnackBar would
  // be hidden behind the opaque lock screen, so we render this inline.
  String? _lastError;

  // True while the OS prompt is up. Presenting the system biometric sheet fires
  // its own paused→resumed lifecycle churn; this guard stops that churn (and
  // double taps) from re-entering the auth flow.
  bool _authInProgress = false;

  // We auto-present the prompt at most once per lock episode. After a
  // cancel/failure the user retries via the button — auto-looping would
  // re-present the sheet the instant they cancel and trap them.
  bool _autoPrompted = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _checkColdStart();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  Future<void> _checkColdStart() async {
    final settings = await ref.read(biometricSettingsStoreProvider).load();
    if (!mounted) return;
    if (settings.enabled && settings.requireOnColdStart) {
      await _lock();
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      _maybeLockOnResume();
    }
  }

  Future<void> _maybeLockOnResume() async {
    // Ignore the resume the biometric sheet itself triggers while a prompt is
    // up, and don't re-present over a lock the user is already retrying.
    if (_authInProgress || _locked) return;
    final settings = await ref.read(biometricSettingsStoreProvider).load();
    if (!mounted) return;
    if (!settings.enabled) return;
    final elapsed = DateTime.now().difference(_lastUnlock);
    if (elapsed.inSeconds >= settings.gracePeriodSeconds) {
      await _lock();
    }
  }

  /// Engage the lock and immediately present the OS prompt (once per episode).
  Future<void> _lock() async {
    if (!_locked) {
      setState(() {
        _locked = true;
        _autoPrompted = false;
        _lastError = null;
      });
    }
    if (!_autoPrompted) {
      _autoPrompted = true;
      await _authenticate();
    }
  }

  Future<void> _authenticate() async {
    if (_authInProgress) return;
    _authInProgress = true;
    // Clear any previous error before a retry so the user gets fresh feedback.
    if (_lastError != null) {
      setState(() => _lastError = null);
    }
    try {
      final port = ref.read(biometricPortProvider);
      final ok = await port.authenticate();
      if (!mounted) return;
      if (ok) {
        setState(() {
          _locked = false;
          _lastUnlock = DateTime.now();
          _lastError = null;
          _autoPrompted = false;
        });
      } else {
        // Surface silent failures (canceled prompt, not-enrolled, etc.) so the
        // user knows the lock is intentional. We render inline rather than via
        // SnackBar because the lock screen is opaque and would hide it.
        setState(() => _lastError = 'Authentication failed');
      }
    } finally {
      _authInProgress = false;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Stack(
      children: [
        widget.child,
        if (_locked)
          BiometricLockScreen(
            onAuthenticate: _authenticate,
            errorMessage: _lastError,
          ),
      ],
    );
  }
}
