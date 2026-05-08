import 'dart:math';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Secure storage wrapper for sensitive credentials.
///
/// Uses iOS Keychain and Android EncryptedSharedPreferences.
class SecureStorageService {
  SecureStorageService()
      : _storage = const FlutterSecureStorage(
          aOptions: AndroidOptions(encryptedSharedPreferences: true),
          iOptions: IOSOptions(
            accessibility: KeychainAccessibility.first_unlock,
          ),
        );

  final FlutterSecureStorage _storage;

  // Generic key-value operations (used by ServerScopedStorage)
  Future<String?> read(String key) => _storage.read(key: key);
  Future<void> write(String key, String value) =>
      _storage.write(key: key, value: value);
  Future<void> delete(String key) => _storage.delete(key: key);

  // Storage keys
  static const _apiKeyKey = 'rdv_api_key';
  static const _serverUrlKey = 'rdv_server_url';
  static const _terminalPortKey = 'rdv_terminal_port';
  static const _userIdKey = 'rdv_user_id';
  static const _userEmailKey = 'rdv_user_email';
  static const _cfTokenKey = 'rdv_cf_token';
  static const _deviceIdKey = 'rdv_device_id';

  // API Key
  Future<String?> getApiKey() => _storage.read(key: _apiKeyKey);
  Future<void> setApiKey(String value) =>
      _storage.write(key: _apiKeyKey, value: value);

  // Server URL (base URL for REST API)
  Future<String?> getServerUrl() => _storage.read(key: _serverUrlKey);
  Future<void> setServerUrl(String value) =>
      _storage.write(key: _serverUrlKey, value: value);

  // Terminal port (WebSocket server)
  Future<String?> getTerminalPort() => _storage.read(key: _terminalPortKey);
  Future<void> setTerminalPort(String value) =>
      _storage.write(key: _terminalPortKey, value: value);

  // User identity
  Future<String?> getUserId() => _storage.read(key: _userIdKey);
  Future<void> setUserId(String value) =>
      _storage.write(key: _userIdKey, value: value);

  Future<String?> getUserEmail() => _storage.read(key: _userEmailKey);
  Future<void> setUserEmail(String value) =>
      _storage.write(key: _userEmailKey, value: value);

  // CF Access token (for passing through Cloudflare Access)
  Future<String?> getCfToken() => _storage.read(key: _cfTokenKey);
  Future<void> setCfToken(String value) =>
      _storage.write(key: _cfTokenKey, value: value);

  // Device ID (stable across sessions, for push token deduplication)
  Future<String?> getDeviceId() async {
    var id = await _storage.read(key: _deviceIdKey);
    if (id == null) {
      // Generate a stable device ID on first access using secure random
      final rng = Random.secure();
      id = List.generate(16, (_) => rng.nextInt(256))
          .map((b) => b.toRadixString(16).padLeft(2, '0'))
          .join();
      await _storage.write(key: _deviceIdKey, value: id);
    }
    return id;
  }

  /// Store all auth credentials at once after successful login.
  Future<void> storeCredentials({
    required String serverUrl,
    required String terminalPort,
    required String apiKey,
    required String userId,
    required String email,
    String? cfToken,
  }) async {
    await Future.wait([
      setServerUrl(serverUrl),
      setTerminalPort(terminalPort),
      setApiKey(apiKey),
      setUserId(userId),
      setUserEmail(email),
      if (cfToken != null) setCfToken(cfToken),
    ]);
  }

  /// Clear all stored credentials on sign-out.
  Future<void> clearAll() => _storage.deleteAll();

  /// Check if credentials exist (does not validate them).
  Future<bool> hasCredentials() async =>
      await getApiKey() != null && await getServerUrl() != null;
}
