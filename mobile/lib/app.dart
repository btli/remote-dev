import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'application/state/appearance_provider.dart';
import 'application/state/reauth_signal_provider.dart';
import 'infrastructure/deep_link/app_link_listener.dart';
import 'infrastructure/deep_link/deep_link_stream_provider.dart';
import 'infrastructure/push/notification_tap_handler.dart';
import 'presentation/router/app_router.dart';
import 'presentation/screens/biometric/biometric_lock_overlay.dart';
import 'presentation/screens/notifications/notifications_tab_screen.dart'
    show notificationsApiProvider;

final appRouterProvider = Provider<AppRouter>((ref) => AppRouter());

/// Boots the [AppLinkListener] eagerly on first read. Read once at startup
/// (e.g. from `main()` via a `ProviderContainer`) so that custom-scheme deep
/// links are picked up from cold-start onward.
final appLinkListenerProvider = Provider<AppLinkListener>((ref) {
  final router = ref.read(appRouterProvider);
  final stream = ref.watch(deepLinkStreamProvider);
  final links = ref.watch(appLinksProvider);
  final listener =
      AppLinkListener(router: router, linkStream: stream, links: links);
  unawaited(listener.start());
  ref.onDispose(() {
    unawaited(listener.stop());
  });
  return listener;
});

/// Boots the [NotificationTapHandler] eagerly on first read. Subscribes to
/// `FirebaseMessaging.onMessageOpenedApp` and drains `getInitialMessage()`
/// so cold-start taps route to the correct surface. Read once at startup
/// from `main()` via a `ProviderContainer`.
final notificationTapHandlerProvider =
    Provider<NotificationTapHandler>((ref) {
  final router = ref.read(appRouterProvider);
  final listener = NotificationTapHandler(
    router: router,
    onMarkRead: (id) async {
      // `notificationsApiProvider` throws `NoActiveServerError`
      // synchronously when no server is bound; inside this async body that
      // becomes a rejected Future, which the handler's own `.catchError`
      // logs and swallows. Don't double-handle here.
      await ref.read(notificationsApiProvider).markRead([id]);
    },
  );
  unawaited(listener.initialize());
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
    final appearance = ref.watch(appearanceSettingsProvider);
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
      //
      // We also override MediaQuery here to honor the user's appearance
      // preferences app-wide:
      //   - `disableAnimations` propagates Reduce Motion to every Material
      //     widget that respects accessibility flags.
      //   - `textScaler` applies the user's font-scale slider to all text
      //     in native Flutter chrome (PWA WebView text uses its own bridge).
      builder: (context, child) {
        final mq = MediaQuery.of(context);
        return MediaQuery(
          data: mq.copyWith(
            disableAnimations: mq.disableAnimations || appearance.reduceMotion,
            textScaler: TextScaler.linear(appearance.fontScale),
          ),
          child: BiometricLockOverlay(child: child ?? const SizedBox()),
        );
      },
    );
  }
}
