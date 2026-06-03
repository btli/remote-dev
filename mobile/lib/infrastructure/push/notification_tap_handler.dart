import 'dart:async';

import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';

import '../../presentation/router/app_route.dart';
import '../../presentation/router/app_router.dart';

/// Translates FCM notification taps into native AppRoute navigations.
/// Spec §5: payload's sessionId | channelId | notificationId.
class NotificationTapHandler {
  NotificationTapHandler({required this.router, this.onMarkRead});

  final AppRouter router;

  /// Optional fire-and-forget hook invoked with `data['notificationId']` so
  /// the tap registers as a read event on the server (parity with legacy
  /// `archive/mobile-flutter` and the web client). Errors are swallowed —
  /// missing server / network failure must never block navigation.
  final Future<void> Function(String notificationId)? onMarkRead;

  StreamSubscription<RemoteMessage>? _openedSub;

  /// Wire up the three FCM lifecycle entry points. Idempotent.
  Future<void> initialize() async {
    try {
      final initial = await FirebaseMessaging.instance.getInitialMessage();
      if (initial != null) {
        _navigate(initial.data);
      }
      await _openedSub?.cancel();
      _openedSub = FirebaseMessaging.onMessageOpenedApp
          .listen((m) => _navigate(m.data));
    } catch (e) {
      debugPrint('[Push] tap-handler init failed (Firebase missing?): $e');
    }
  }

  Future<void> stop() async {
    await _openedSub?.cancel();
    _openedSub = null;
  }

  /// Public for testing: routes based on payload.
  void navigateForPayload(Map<String, dynamic> data) => _navigate(data);

  void _navigate(Map<String, dynamic> data) {
    final notificationId = data['notificationId']?.toString();
    if (notificationId != null &&
        notificationId.isNotEmpty &&
        onMarkRead != null) {
      // Fire-and-forget: don't block navigation, swallow errors so cold-start
      // taps still navigate even when no server is bound or the network is
      // unreachable.
      // ignore: discarded_futures
      onMarkRead!(notificationId).catchError((Object e) {
        debugPrint('[Push] mark-read on tap failed: $e');
        return null;
      });
    }

    final sessionId = data['sessionId']?.toString();
    final channelId = data['channelId']?.toString();
    // Use navigateDeepLink (root /home, then push) so the back button works
    // when the app is cold-started from a notification tap. A plain
    // navigateTo/go would replace the whole stack and leave nothing to pop.
    if (sessionId != null && sessionId.isNotEmpty) {
      router.navigateDeepLink(AppRoute.session(sessionId));
      return;
    }
    if (channelId != null && channelId.isNotEmpty) {
      router.navigateDeepLink(AppRoute.channel(channelId));
      return;
    }
    router.navigateDeepLink(const AppRoute.notifications());
  }
}
