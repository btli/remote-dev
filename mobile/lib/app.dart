import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'application/add_host_flow_controller.dart';
import 'application/state/appearance_provider.dart';
import 'application/state/reauth_signal_provider.dart';
import 'infrastructure/api/instances_api.dart';
import 'infrastructure/deep_link/add_host_login_completer.dart';
import 'infrastructure/deep_link/app_link_listener.dart';
import 'infrastructure/deep_link/deep_link_stream_provider.dart';
import 'infrastructure/push/notification_tap_handler.dart';
import 'presentation/router/app_router.dart';
import 'presentation/screens/biometric/biometric_lock_overlay.dart';
import 'presentation/screens/host_picker/workspace_picker_screen.dart'
    show WorkspacePickerArgs;
import 'presentation/screens/notifications/notifications_tab_screen.dart'
    show notificationsApiProvider;
import 'presentation/screens/server_picker/server_picker_screen.dart'
    show serverPickerDataProvider;
import 'presentation/screens/webview_host/session_route_host.dart'
    show
        activeWorkspaceProvider,
        hostWorkspaceStoreProvider,
        mobileCredentialsStoreProvider,
        pendingAddHostLoginStoreProvider,
        secureStorageProvider;

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

/// Boots the app-global [AddHostLoginCompleter] on first read. This is what
/// makes interactive add-host STATE-INDEPENDENT: it subscribes to the deep-link
/// broadcast stream (and drains the cold-start initial link) and, when a
/// `remotedev://auth/callback` matches the durable pending-login record, runs
/// the whole persist → detect → activate → navigate flow via
/// [AddHostFlowController] — even though `AddHostScreen` was rebuilt/disposed on
/// the callback return. Read once at startup from `main()`.
final addHostLoginCompleterProvider = Provider<AddHostLoginCompleter>((ref) {
  final router = ref.read(appRouterProvider);
  final controller = AddHostFlowController(
    store: ref.read(hostWorkspaceStoreProvider),
    credentials: ref.read(mobileCredentialsStoreProvider),
    instancesApiFactory: (host) => InstancesApi(
      origin: host.origin,
      hostId: host.id,
      storage: ref.read(secureStorageProvider),
    ),
  );
  final completer = AddHostLoginCompleter(
    linkStream: ref.watch(deepLinkStreamProvider),
    pendingStore: ref.read(pendingAddHostLoginStoreProvider),
    controller: controller,
    // Deliberately NOT wiring `initialLink` here: `AppLinkListener` already
    // drains the shared `AppLinks.getInitialLink()` for cold-start route
    // dispatch, and a second reader of the same instance could race it and make
    // a genuine cold-start route link be missed. The confirmed bug is the
    // WARM-start return (browser → back to the live app), which the broadcast
    // `linkStream` handles. (`initialLink` remains a tested capability for a
    // future single-owner cold-start wiring.)
    onSingleWorkspaceActivated: (_) {
      // The single workspace is persisted + active; refresh the active
      // connection + picker data and land on the session.
      ref.invalidate(activeWorkspaceProvider);
      ref.invalidate(serverPickerDataProvider);
      router.config.go('/home');
    },
    onSupervisorDetected: (host, instances) {
      // Root at the server list, then push the workspace picker on top so no
      // empty `/hosts/add` page is left stranded and Back returns to servers.
      ref.invalidate(serverPickerDataProvider);
      router.config.go('/servers');
      router.config.push(
        '/hosts/workspaces',
        extra: WorkspacePickerArgs(host: host, instances: instances),
      );
    },
    onDetectFailed: (_, __) {
      // Host row + host credentials are kept; land on the server list so the
      // user can see/retry it rather than being stranded on an empty add form.
      ref.invalidate(serverPickerDataProvider);
      router.config.go('/servers');
    },
    onUnexpectedError: (_) {
      // An unexpected throw during completion (pending already cleared) — don't
      // leave the trigger screen stuck on the waiting spinner; land on servers.
      ref.invalidate(serverPickerDataProvider);
      router.config.go('/servers');
    },
  );
  completer.start();
  ref.onDispose(() {
    unawaited(completer.stop());
  });
  return completer;
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
