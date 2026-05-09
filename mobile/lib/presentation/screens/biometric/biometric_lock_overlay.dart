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
      setState(() => _locked = true);
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      _maybeLockOnResume();
    }
  }

  Future<void> _maybeLockOnResume() async {
    final settings = await ref.read(biometricSettingsStoreProvider).load();
    if (!mounted) return;
    if (!settings.enabled) return;
    final elapsed = DateTime.now().difference(_lastUnlock);
    if (elapsed.inSeconds >= settings.gracePeriodSeconds) {
      setState(() => _locked = true);
    }
  }

  Future<void> _authenticate() async {
    final port = ref.read(biometricPortProvider);
    final ok = await port.authenticate();
    if (!mounted) return;
    if (ok) {
      setState(() {
        _locked = false;
        _lastUnlock = DateTime.now();
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Stack(
      children: [
        widget.child,
        if (_locked) BiometricLockScreen(onAuthenticate: _authenticate),
      ],
    );
  }
}
