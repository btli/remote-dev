import '../../application/ports/secure_storage_port.dart';

/// Credentials returned by the system-browser CF Access login flow.
///
/// The server's `/auth/mobile-callback` page generates an API key and
/// reads the user's CF JWT from the request's `CF_Authorization` cookie,
/// then 302s to `remotedev://auth/callback?apiKey=...&cfToken=...&...`.
/// Mobile parses the query params into this record.
///
/// - [apiKey]: opaque bearer token. REQUIRED — without it we can't auth
///   API calls. Sent as `Authorization: Bearer <key>` by
///   `RemoteDevAuthInterceptor`.
/// - [cfToken]: full CF Access JWT. Optional but typically present; when
///   present it is sent as `Cookie: CF_Authorization=<jwt>` so the CF
///   tunnel admits the same request that the API key authenticates.
/// - [userId] / [email]: best-effort identity hints. Stored for display
///   in the profile screen; not used for auth.
class MobileCredentials {
  const MobileCredentials({
    required this.apiKey,
    this.cfToken,
    this.userId,
    this.email,
  });

  final String apiKey;
  final String? cfToken;
  final String? userId;
  final String? email;
}

/// Storage keys used by [MobileCredentialsStore]. Exposed so tests can
/// assert exact persisted shape.
abstract final class MobileCredentialsKeys {
  /// New-style API key from `/auth/mobile-callback`.
  static const apiKey = 'api_key';

  /// CF Access JWT captured from the callback's `cfToken` query param.
  /// Distinct from the legacy `cf_authorization` key (which used to hold
  /// the same JWT, but was harvested from the in-app WebView cookie jar
  /// rather than the server-issued callback).
  static const cfToken = 'cf_token';

  /// Best-effort user id (display only).
  static const userId = 'user_id';

  /// Best-effort user email (display only).
  static const email = 'user_email';

  /// Legacy key written by the old `CfLoginWebViewScreen` /
  /// `CookieReader.captureCfAuthorization` path. Still read by
  /// `RemoteDevAuthInterceptor` so existing installs keep working until
  /// they re-auth, but new logins write [cfToken] instead.
  static const legacyCfAuthorization = 'cf_authorization';
}

/// Thin typed wrapper around [SecureStoragePort] that knows the
/// per-credential keys used by the system-browser login flow.
///
/// Wrapping the port (rather than extending it) keeps the port narrow
/// and makes the four credential operations a single discoverable surface.
class MobileCredentialsStore {
  const MobileCredentialsStore(this._storage);

  final SecureStoragePort _storage;

  /// Persist all fields of [credentials] for [serverId]. Empty optional
  /// fields are written as empty strings (NOT deleted) so partial updates
  /// don't leave stale data behind from a previous login.
  Future<void> save(String serverId, MobileCredentials credentials) async {
    await _storage.write(
      serverId,
      MobileCredentialsKeys.apiKey,
      credentials.apiKey,
    );
    final cf = credentials.cfToken;
    if (cf != null && cf.isNotEmpty) {
      await _storage.write(serverId, MobileCredentialsKeys.cfToken, cf);
      // Mirror to the legacy key so old call sites (e.g. anything that
      // still reads `cf_authorization`) keep working during the
      // transition. Safe to drop once every caller migrates.
      await _storage.write(
        serverId,
        MobileCredentialsKeys.legacyCfAuthorization,
        cf,
      );
    } else {
      await _storage.delete(serverId, MobileCredentialsKeys.cfToken);
      await _storage.delete(
        serverId,
        MobileCredentialsKeys.legacyCfAuthorization,
      );
    }
    await _storage.write(
      serverId,
      MobileCredentialsKeys.userId,
      credentials.userId ?? '',
    );
    await _storage.write(
      serverId,
      MobileCredentialsKeys.email,
      credentials.email ?? '',
    );
  }

  Future<String?> readApiKey(String serverId) =>
      _storage.read(serverId, MobileCredentialsKeys.apiKey);

  /// Read the CF Access JWT, preferring the new [cfToken] key and falling
  /// back to the legacy [legacyCfAuthorization] key for installs that
  /// signed in before this refactor.
  Future<String?> readCfToken(String serverId) async {
    final fresh = await _storage.read(serverId, MobileCredentialsKeys.cfToken);
    if (fresh != null && fresh.isNotEmpty) return fresh;
    return _storage.read(
      serverId,
      MobileCredentialsKeys.legacyCfAuthorization,
    );
  }

  Future<String?> readUserId(String serverId) =>
      _storage.read(serverId, MobileCredentialsKeys.userId);

  Future<String?> readEmail(String serverId) =>
      _storage.read(serverId, MobileCredentialsKeys.email);

  /// Best-effort clear: deletes every credential key for [serverId].
  Future<void> clear(String serverId) async {
    await _storage.delete(serverId, MobileCredentialsKeys.apiKey);
    await _storage.delete(serverId, MobileCredentialsKeys.cfToken);
    await _storage.delete(serverId, MobileCredentialsKeys.userId);
    await _storage.delete(serverId, MobileCredentialsKeys.email);
    await _storage.delete(
      serverId,
      MobileCredentialsKeys.legacyCfAuthorization,
    );
  }
}
