/// Initialize, retrieve, and observe FCM tokens. Implementations should
/// gracefully degrade (return false / null) when Firebase config is
/// absent or platform doesn't support FCM.
abstract class PushPort {
  /// Initialize FCM (Firebase.initializeApp + permission + presentation).
  /// Idempotent. Returns true on success.
  Future<bool> initialize();

  /// Current FCM token (null if not initialized).
  Future<String?> getToken();

  /// Stream of token-refresh events.
  Stream<String> get onTokenRefresh;

  /// Unregister token from FCM (used on app reset / sign-out).
  Future<void> deleteToken();
}
