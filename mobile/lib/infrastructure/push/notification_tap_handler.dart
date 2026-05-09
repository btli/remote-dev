import 'dart:async';

import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';

import '../../presentation/router/app_route.dart';
import '../../presentation/router/app_router.dart';

/// Translates FCM notification taps into native AppRoute navigations.
/// Spec §5: payload's sessionId | channelId | notificationId.
class NotificationTapHandler {
  NotificationTapHandler({required this.router});

  final AppRouter router;
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
    final sessionId = data['sessionId']?.toString();
    final channelId = data['channelId']?.toString();
    if (sessionId != null && sessionId.isNotEmpty) {
      router.navigateTo(AppRoute.session(sessionId));
      return;
    }
    if (channelId != null && channelId.isNotEmpty) {
      router.navigateTo(AppRoute.channel(channelId));
      return;
    }
    router.navigateTo(const AppRoute.notifications());
  }
}
