import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

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
