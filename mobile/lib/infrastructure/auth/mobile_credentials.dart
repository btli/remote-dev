import 'dart:convert';

import '../../application/ports/secure_storage_port.dart';
import '../../domain/auth_cookie.dart';

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

  // --- Host / Workspace hierarchy keys -------------------------------------

  /// Namespace prefix for host-wide credentials: `host.<hostId>`.
  static const hostNsPrefix = 'host.';

  /// Namespace prefix for per-workspace credentials: `workspace.<workspaceId>`.
  static const workspaceNsPrefix = 'workspace.';

  /// Host-wide CF Access JWT. Logical key: `host.<hostId>.cfToken`.
  static const hostCfToken = 'cfToken';

  /// Host-wide auth cookies (JSON array). Logical key: `host.<hostId>.authCookies`.
  ///
  /// Preferred over [hostCfToken] for new installs (OIDC + CF both use this).
  /// Reads fall back to [hostCfToken] if this key is absent.
  static const hostAuthCookies = 'authCookies';

  /// Per-workspace API key. Logical key: `workspace.<workspaceId>.apiKey`.
  static const workspaceApiKey = 'apiKey';

  /// Per-workspace auth cookies (JSON array). Logical key:
  /// `workspace.<workspaceId>.authCookies`.
  ///
  /// Preferred over a non-existent workspace cfToken for new installs.
  /// No legacy fallback exists for workspace cookies (there was never a
  /// workspace-scoped cfToken).
  static const workspaceAuthCookies = 'authCookies';
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

  // --- Host / Workspace credentials (multi-workspace hierarchy) ------------
  //
  // The CF Access token is host-wide; the API key is per-workspace. Both ride
  // on the same [SecureStoragePort] by treating `host.<hostId>` and
  // `workspace.<workspaceId>` as the namespace, mirroring the existing
  // per-server `server.<id>.<key>` layout. The logical credential keys are
  // therefore `host.<hostId>.cfToken` and `workspace.<workspaceId>.apiKey`.

  static String _hostNs(String hostId) =>
      '${MobileCredentialsKeys.hostNsPrefix}$hostId';

  static String _workspaceNs(String workspaceId) =>
      '${MobileCredentialsKeys.workspaceNsPrefix}$workspaceId';

  Future<void> setHostCfToken(String hostId, String token) => _storage.write(
        _hostNs(hostId),
        MobileCredentialsKeys.hostCfToken,
        token,
      );

  Future<String?> getHostCfToken(String hostId) =>
      _storage.read(_hostNs(hostId), MobileCredentialsKeys.hostCfToken);

  /// Persist [cookies] as a JSON array at `host.<hostId>.authCookies`.
  Future<void> setHostAuthCookies(String hostId, List<AuthCookie> cookies) =>
      _storage.write(
        _hostNs(hostId),
        MobileCredentialsKeys.hostAuthCookies,
        jsonEncode(cookies.map((c) => c.toJson()).toList()),
      );

  /// Insert-or-replace a single host auth cookie by name, preserving every
  /// other host cookie.
  ///
  /// Used by the WebView CF_Authorization harvest (remote-dev off-LAN CF
  /// Access): when the session WebView completes the interactive CF Access
  /// login, the harvested `CF_Authorization` is upserted here so the existing
  /// [CfAuthInterceptor] sends it on every Dio call. Merging (rather than
  /// overwriting the whole list) is deliberate — a CF instance callback may
  /// already have stored other host cookies, and a fresh CF JWT must not
  /// clobber them. Reads the current list via [getHostAuthCookies] (which
  /// includes the legacy `cfToken` fallback), drops any existing entry with
  /// the same [AuthCookie.name], appends [cookie], and writes the result back.
  Future<void> upsertHostAuthCookie(String hostId, AuthCookie cookie) async {
    final existing = await getHostAuthCookies(hostId);
    final merged = [
      ...existing.where((c) => c.name != cookie.name),
      cookie,
    ];
    await setHostAuthCookies(hostId, merged);
  }

  /// Read the host's auth cookies.
  ///
  /// Priority:
  ///   1. `host.<hostId>.authCookies` (new-style JSON array).
  ///   2. Legacy fallback: `host.<hostId>.cfToken` → synthesised as
  ///      `[AuthCookie(name:"CF_Authorization", value: token, path:"/")]`.
  ///   3. Empty list if neither key exists.
  Future<List<AuthCookie>> getHostAuthCookies(String hostId) async {
    final raw = await _storage.read(
      _hostNs(hostId),
      MobileCredentialsKeys.hostAuthCookies,
    );
    if (raw != null && raw.isNotEmpty) {
      try {
        final list = jsonDecode(raw) as List;
        return list
            .cast<Map<String, dynamic>>()
            .map(AuthCookie.fromJson)
            .toList();
      } catch (_) {
        // Malformed JSON — fall through to legacy.
      }
    }
    // Legacy fallback: cfToken.
    final cfToken = await getHostCfToken(hostId);
    if (cfToken != null && cfToken.isNotEmpty) {
      return [AuthCookie(name: 'CF_Authorization', value: cfToken, path: '/')];
    }
    return const [];
  }

  /// Best-effort clear of every credential under this host's namespace.
  Future<void> clearHost(String hostId) => _storage.deleteAll(_hostNs(hostId));

  Future<void> setWorkspaceApiKey(String workspaceId, String key) =>
      _storage.write(
        _workspaceNs(workspaceId),
        MobileCredentialsKeys.workspaceApiKey,
        key,
      );

  Future<String?> getWorkspaceApiKey(String workspaceId) => _storage.read(
        _workspaceNs(workspaceId),
        MobileCredentialsKeys.workspaceApiKey,
      );

  /// Persist [cookies] as a JSON array at `workspace.<workspaceId>.authCookies`.
  Future<void> setWorkspaceAuthCookies(
    String workspaceId,
    List<AuthCookie> cookies,
  ) =>
      _storage.write(
        _workspaceNs(workspaceId),
        MobileCredentialsKeys.workspaceAuthCookies,
        jsonEncode(cookies.map((c) => c.toJson()).toList()),
      );

  /// Read the workspace's auth cookies.
  ///
  /// Reads `workspace.<workspaceId>.authCookies`. No legacy workspace-level
  /// cfToken key ever existed, so there is no fallback — returns `[]` when
  /// absent.
  Future<List<AuthCookie>> getWorkspaceAuthCookies(String workspaceId) async {
    final raw = await _storage.read(
      _workspaceNs(workspaceId),
      MobileCredentialsKeys.workspaceAuthCookies,
    );
    if (raw != null && raw.isNotEmpty) {
      try {
        final list = jsonDecode(raw) as List;
        return list
            .cast<Map<String, dynamic>>()
            .map(AuthCookie.fromJson)
            .toList();
      } catch (_) {
        return const [];
      }
    }
    return const [];
  }

  /// The cookies an INSTANCE request/WebView should carry for workspace
  /// [workspaceId] under host [hostId]: the workspace's OWN cookies (the
  /// per-instance OIDC session-token, or a CF JWT a CF instance callback
  /// persisted) PLUS the host-wide `CF_Authorization` EDGE cookie, which the
  /// Cloudflare perimeter requires on every request to the host (instance
  /// subpaths included). The supervisor's app-level session cookie is
  /// deliberately excluded — it must never leak to instances (design §7.2).
  /// Single source of truth shared by [RemoteDevClient.forWorkspace] (REST)
  /// and the WebView cookie seeder.
  Future<List<AuthCookie>> getInstanceCookies(
    String hostId,
    String workspaceId,
  ) async {
    final ws = await getWorkspaceAuthCookies(workspaceId);
    final wsNames = ws.map((c) => c.name).toSet();
    final host = await getHostAuthCookies(hostId);
    final edge = host.where(
      (c) => c.name == 'CF_Authorization' && !wsNames.contains(c.name),
    );
    return [...ws, ...edge];
  }

  /// Best-effort clear of every credential under this workspace's namespace.
  Future<void> clearWorkspace(String workspaceId) =>
      _storage.deleteAll(_workspaceNs(workspaceId));
}
