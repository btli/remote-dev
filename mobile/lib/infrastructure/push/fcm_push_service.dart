import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';

import '../../application/ports/push_port.dart';

class FcmPushService implements PushPort {
  bool _initialized = false;
  bool _initFailed = false;

  @override
  Future<bool> initialize() async {
    if (_initialized) return true;
    if (_initFailed) return false;

    try {
      // Idempotent: main() may have already initialized Firebase to register
      // the background message handler. Skip the duplicate call to avoid the
      // [core/duplicate-app] exception. If config files are absent both here
      // and in main() the first attempt throws and Firebase.apps stays empty.
      if (Firebase.apps.isEmpty) {
        await Firebase.initializeApp();
      }
    } catch (e) {
      debugPrint('[Push] Firebase.initializeApp failed (config missing?): $e');
      _initFailed = true;
      return false;
    }

    try {
      final messaging = FirebaseMessaging.instance;

      // Request permission (iOS shows dialog; Android auto-grants pre-13,
      // prompts on 13+).
      final settings = await messaging.requestPermission(
        alert: true,
        badge: true,
        sound: true,
      );

      if (settings.authorizationStatus == AuthorizationStatus.denied) {
        debugPrint('[Push] Permission denied');
        return false;
      }

      // iOS: present foreground notifications instead of suppressing them.
      await messaging.setForegroundNotificationPresentationOptions(
        alert: true,
        badge: true,
        sound: true,
      );

      _initialized = true;
      return true;
    } catch (e) {
      debugPrint('[Push] FCM permission/options setup failed: $e');
      _initFailed = true;
      return false;
    }
  }

  @override
  Future<String?> getToken() async {
    if (!_initialized) return null;
    try {
      return await FirebaseMessaging.instance.getToken();
    } catch (e) {
      debugPrint('[Push] getToken failed: $e');
      return null;
    }
  }

  @override
  Stream<String> get onTokenRefresh {
    if (!_initialized) {
      return const Stream<String>.empty();
    }
    return FirebaseMessaging.instance.onTokenRefresh;
  }

  @override
  Future<void> deleteToken() async {
    if (!_initialized) return;
    try {
      await FirebaseMessaging.instance.deleteToken();
    } catch (e) {
      debugPrint('[Push] deleteToken failed: $e');
    }
  }
}
