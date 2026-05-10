import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'application/state/reauth_signal_provider.dart';
import 'infrastructure/deep_link/app_link_listener.dart';
import 'presentation/router/app_router.dart';
import 'presentation/screens/biometric/biometric_lock_overlay.dart';

final appRouterProvider = Provider<AppRouter>((ref) => AppRouter());

/// Boots the [AppLinkListener] eagerly on first read. Read once at startup
/// (e.g. from `main()` via a `ProviderContainer`) so that custom-scheme deep
/// links are picked up from cold-start onward.
final appLinkListenerProvider = Provider<AppLinkListener>((ref) {
  final router = ref.read(appRouterProvider);
  final listener = AppLinkListener(router: router);
  unawaited(listener.start());
  ref.onDispose(() {
    unawaited(listener.stop());
  });
  return listener;
});

class RemoteDevApp extends ConsumerWidget {
  const RemoteDevApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final router = ref.watch(appRouterProvider);
    // One-shot reauth signal: API interceptor fires on 401/403 and the
    // shell routes to /reauth here. The signal is a monotonic counter
    // so every request triggers a listen callback (not just transitions).
    ref.listen<int>(reauthSignalProvider, (previous, next) {
      if (previous == null || next == previous) return;
      router.config.go('/reauth');
    });
    return MaterialApp.router(
      title: 'Remote Dev',
      theme: ThemeData(
        useMaterial3: true,
        colorSchemeSeed: const Color(0xFF7AA2F7),
        brightness: Brightness.dark,
        scaffoldBackgroundColor: const Color(0xFF1A1B26),
      ),
      routerConfig: router.config,
      // Layer the lock overlay above every route so backgrounding any
      // screen still re-locks. Using `builder` (not wrapping `MaterialApp`)
      // ensures Navigator + Overlay sit above MediaQuery & Theme.
      builder: (context, child) =>
          BiometricLockOverlay(child: child ?? const SizedBox()),
    );
  }
}
