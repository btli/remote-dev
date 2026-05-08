import 'package:remote_dev/infrastructure/storage/secure_storage_service.dart';

/// Wraps [SecureStorageService] to scope keys by server ID.
///
/// Each server's credentials are stored with a unique prefix,
/// preventing collision when switching between servers.
///
/// Keys follow the pattern: `rdv_{serverId}_{key}`
class ServerScopedStorage {
  ServerScopedStorage({
    required SecureStorageService storage,
    required String serverId,
  })  : _storage = storage,
        _prefix = 'rdv_${serverId}_';

  final SecureStorageService _storage;
  final String _prefix;

  String get _apiKeyKey => '${_prefix}api_key';
  String get _cfTokenKey => '${_prefix}cf_token';
  String get _userIdKey => '${_prefix}user_id';
  String get _userEmailKey => '${_prefix}user_email';

  Future<String?> getApiKey() => _storage.read(_apiKeyKey);
  Future<void> setApiKey(String value) => _storage.write(_apiKeyKey, value);

  Future<String?> getCfToken() => _storage.read(_cfTokenKey);
  Future<void> setCfToken(String value) => _storage.write(_cfTokenKey, value);

  Future<String?> getUserId() => _storage.read(_userIdKey);
  Future<void> setUserId(String value) => _storage.write(_userIdKey, value);

  Future<String?> getUserEmail() => _storage.read(_userEmailKey);
  Future<void> setUserEmail(String value) =>
      _storage.write(_userEmailKey, value);

  /// Store all credentials at once after successful login.
  Future<void> storeCredentials({
    required String apiKey,
    required String userId,
    required String email,
    String? cfToken,
  }) async {
    await Future.wait([
      setApiKey(apiKey),
      setUserId(userId),
      setUserEmail(email),
      if (cfToken != null) setCfToken(cfToken),
    ]);
  }

  /// Clear all credentials for this server.
  Future<void> clearAll() async {
    await Future.wait([
      _storage.delete(_apiKeyKey),
      _storage.delete(_cfTokenKey),
      _storage.delete(_userIdKey),
      _storage.delete(_userEmailKey),
    ]);
  }

  /// Check if credentials exist for this server.
  Future<bool> hasCredentials() async =>
      await getApiKey() != null;
}
