import 'dart:async';
import 'dart:io';

import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:go_router/go_router.dart';

import 'package:remote_dev/infrastructure/api/remote_dev_client.dart';
import 'package:remote_dev/infrastructure/storage/secure_storage_service.dart';

/// Manages FCM push notification lifecycle: token registration,
/// foreground handling, tap navigation, and token refresh.
class PushNotificationService {
  PushNotificationService({
    required RemoteDevClient client,
    required SecureStorageService storage,
    required GoRouter router,
  })  : _client = client,
        _storage = storage,
        _router = router;

  final RemoteDevClient _client;
  final SecureStorageService _storage;
  final GoRouter _router;
  StreamSubscription<String>? _tokenRefreshSub;
  StreamSubscription<RemoteMessage>? _foregroundMessageSub;
  StreamSubscription<RemoteMessage>? _messageOpenedSub;

  /// Initialize push notifications: request permission, get token, register,
  /// and set up tap handlers for deep linking to sessions.
  Future<bool> initialize() async {
    try {
      final messaging = FirebaseMessaging.instance;

      // Request permission (iOS shows a dialog, Android auto-grants)
      final settings = await messaging.requestPermission(
        alert: true,
        badge: true,
        sound: true,
      );

      if (settings.authorizationStatus == AuthorizationStatus.denied) {
        debugPrint('[Push] Permission denied');
        return false;
      }

      // Get FCM token
      final token = await messaging.getToken();
      if (token == null) {
        debugPrint('[Push] Failed to get FCM token');
        return false;
      }

      // Register with server
      await _registerToken(token);

      // Listen for token refresh (cancel previous if re-initialized)
      await _tokenRefreshSub?.cancel();
      _tokenRefreshSub = messaging.onTokenRefresh.listen(_registerToken);

      // Set up foreground message handler (cancel previous if re-initialized)
      await _foregroundMessageSub?.cancel();
      _foregroundMessageSub =
          FirebaseMessaging.onMessage.listen(_handleForegroundMessage);

      // Handle notification taps when app is in background
      await _messageOpenedSub?.cancel();
      _messageOpenedSub =
          FirebaseMessaging.onMessageOpenedApp.listen(_handleNotificationTap);

      // Handle notification tap that launched the app from killed state
      final initialMessage = await messaging.getInitialMessage();
      if (initialMessage != null) {
        _handleNotificationTap(initialMessage);
      }

      debugPrint('[Push] Initialized successfully');
      return true;
    } catch (e) {
      debugPrint('[Push] Initialization failed: $e');
      return false;
    }
  }

  /// Unregister the current token from the server on sign-out.
  Future<void> unregister() async {
    try {
      await _tokenRefreshSub?.cancel();
      _tokenRefreshSub = null;
      await _foregroundMessageSub?.cancel();
      _foregroundMessageSub = null;
      await _messageOpenedSub?.cancel();
      _messageOpenedSub = null;
      final token = await FirebaseMessaging.instance.getToken();
      if (token != null) {
        await _client.unregisterPushToken(token);
      }
    } catch (e) {
      debugPrint('[Push] Unregister failed: $e');
    }
  }

  Future<void> _registerToken(String token) async {
    try {
      final platform = Platform.isIOS ? 'ios' : 'android';
      final deviceId = await _storage.getDeviceId();
      await _client.registerPushToken(token, platform, deviceId);
      debugPrint('[Push] Token registered');
    } catch (e) {
      debugPrint('[Push] Token registration failed: $e');
    }
  }

  void _handleForegroundMessage(RemoteMessage message) {
    // When the app is in foreground, FCM with a `notification` key
    // does NOT auto-display on Android by default. However,
    // firebase_messaging's setForegroundNotificationPresentationOptions
    // (iOS) and the Android notification channel handle this.
    // The notification is shown by the OS; taps are handled by
    // onMessageOpenedApp.
    debugPrint('[Push] Foreground message: ${message.data}');
  }

  /// Called when notifications are dismissed on another client (via WebSocket).
  /// Clears matching OS tray notifications so they don't linger.
  Future<void> handleDismissed({
    List<String> ids = const [],
    bool all = false,
  }) async {
    if (!Platform.isAndroid) return;
    // Android: cancel all notifications from the tray when "mark all read"
    // For individual IDs, we can't cancel specific FCM-delivered notifications
    // without flutter_local_notifications — clear all as a pragmatic fallback
    // when the notification panel is explicitly cleared.
    if (all || ids.length >= 3) {
      await FirebaseMessaging.instance.android?.deleteAllNotifications();
      debugPrint('[Push] Cleared all OS notifications');
    }
  }

  /// Navigate to the session when the user taps a notification,
  /// and mark it as read in the DB so all clients sync.
  void _handleNotificationTap(RemoteMessage message) {
    final sessionId = message.data['sessionId'];
    final notificationId = message.data['notificationId'];

    // Mark as read in the DB (fire-and-forget, syncs to web)
    if (notificationId != null &&
        notificationId is String &&
        notificationId.isNotEmpty) {
      _client.markNotificationsRead([notificationId]).catchError((e) {
        debugPrint('[Push] Failed to mark notification read: $e');
      });
    }

    if (sessionId != null && sessionId is String && sessionId.isNotEmpty) {
      debugPrint('[Push] Navigating to session: $sessionId');
      _router.go('/sessions/$sessionId');
    } else {
      debugPrint('[Push] Notification tapped without sessionId, going to home');
      _router.go('/sessions');
    }
  }
}

/// Top-level background message handler.
/// Must be a top-level function (not a class method) per FCM requirements.
@pragma('vm:entry-point')
Future<void> firebaseMessagingBackgroundHandler(RemoteMessage message) async {
  // Background/terminated messages with a `notification` key are
  // automatically displayed by the OS. No additional handling needed.
  debugPrint('[Push] Background message: ${message.messageId}');
}
