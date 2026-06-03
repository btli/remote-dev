import 'package:dio/dio.dart';

import '../../application/ports/api_client_port.dart';
import '../../application/ports/secure_storage_port.dart';
import '../auth/mobile_credentials.dart';
import '../url/workspace_urls.dart';
import 'cf_auth_interceptor.dart';

class RemoteDevClient implements ApiClientPort {
  /// Legacy per-server client. Credentials are read with the per-server
  /// keys (`readApiKey` / `readCfToken`) scoped to [serverId]. Still used by
  /// the push-token registrar, which iterates legacy [ServerConfig] rows.
  RemoteDevClient({
    required this.serverOrigin,
    required this.serverId,
    required SecureStoragePort storage,
    void Function()? onReauthNeeded,
    Future<AuthMaterial?> Function(String serverId)? refreshAuth,
    Dio? dio,
  })  : basePath = '',
        _dio = dio ?? Dio(),
        _credentials = MobileCredentialsStore(storage) {
    _configure(
      baseUrl: serverOrigin.toString(),
      scopeId: serverId,
      authReader: (id) async {
        final apiKey = await _credentials.readApiKey(id);
        final cfToken = await _credentials.readCfToken(id);
        // Legacy per-server client uses the old cfCookie field for compat.
        return AuthMaterial(apiKey: apiKey, cfCookie: cfToken);
      },
      refreshAuth: refreshAuth ?? ((_) async => null),
      onReauthNeeded: onReauthNeeded,
    );
  }

  /// Host/Workspace client. The CF Access token is host-wide
  /// ([MobileCredentialsStore.getHostCfToken]) and the API key is
  /// per-workspace ([MobileCredentialsStore.getWorkspaceApiKey]).
  ///
  /// [origin] is `scheme://host[:port]` (no trailing slash); [basePath] is
  /// `''` or `/<slug>`. Every request path is prefixed with [basePath] (via
  /// [WorkspaceUrls.api]) while `Dio.baseUrl` stays the bare [origin] — so
  /// with basePath `/demo`, `get('/api/sessions')` hits
  /// `<origin>/demo/api/sessions`. For a migrated single-workspace config
  /// [basePath] is `''`, so the effective requests are byte-identical to the
  /// pre-migration client.
  RemoteDevClient.forWorkspace({
    required String origin,
    required this.basePath,
    required String hostId,
    required String workspaceId,
    required SecureStoragePort storage,
    void Function()? onReauthNeeded,
    Future<AuthMaterial?> Function()? refreshAuth,
    Dio? dio,
  })  : serverOrigin = Uri.parse(origin),
        serverId = workspaceId,
        _dio = dio ?? Dio(),
        _credentials = MobileCredentialsStore(storage) {
    _configure(
      // baseUrl stays at the bare origin; basePath is applied per-request
      // via [_path] so a single Dio instance serves a path-prefixed
      // workspace without rewriting its baseUrl.
      baseUrl: origin,
      scopeId: workspaceId,
      authReader: (_) async {
        final apiKey = await _credentials.getWorkspaceApiKey(workspaceId);
        // A workspace request carries that workspace's OWN cookies (e.g. the
        // per-instance OIDC session-token, or the CF JWT a CF instance callback
        // persisted). On a Cloudflare-Access host the perimeter additionally
        // blocks ANY request to the host (instance subpaths included) that
        // lacks the host-wide `CF_Authorization` edge cookie, so that one
        // EDGE cookie must ride along too. We deliberately do NOT forward the
        // supervisor's app-level session cookie (e.g.
        // `__Secure-authjs.session-token`) to instances: it would leak the
        // supervisor session to the instance server and serves no purpose
        // there (the instance reads its own slug-scoped cookie). See design
        // §7.2 (scope isolation).
        final wsCookies =
            await _credentials.getWorkspaceAuthCookies(workspaceId);
        final wsNames = wsCookies.map((c) => c.name).toSet();
        final hostCookies = await _credentials.getHostAuthCookies(hostId);
        final edgeHostCookies = hostCookies.where(
          (c) => c.name == 'CF_Authorization' && !wsNames.contains(c.name),
        );
        final merged = [...wsCookies, ...edgeHostCookies];
        return AuthMaterial(apiKey: apiKey, cookies: merged);
      },
      // The interceptor passes its captured scope id; the workspace refresh
      // closure ignores it (it already closes over the right host/workspace),
      // so adapt the signature here.
      refreshAuth: (_) async => refreshAuth == null ? null : refreshAuth(),
      onReauthNeeded: onReauthNeeded,
    );
  }

  final Uri serverOrigin;
  final String serverId;

  /// `''` or `/<slug>`. Prefixed onto every request path via [_path] so
  /// requests for a path-prefixed workspace hit `<origin><basePath><path>`.
  final String basePath;

  final Dio _dio;
  final MobileCredentialsStore _credentials;

  void _configure({
    required String baseUrl,
    required String scopeId,
    required Future<AuthMaterial> Function(String scopeId) authReader,
    required Future<AuthMaterial?> Function(String scopeId) refreshAuth,
    required void Function()? onReauthNeeded,
  }) {
    _dio.options
      ..baseUrl = baseUrl
      ..connectTimeout = const Duration(seconds: 15)
      ..receiveTimeout = const Duration(seconds: 30);
    _dio.interceptors.add(
      CfAuthInterceptor(
        dio: _dio,
        serverId: scopeId,
        authReader: authReader,
        // Default no-op refresh (returns null → interceptor falls through
        // to onReauthNeeded). Production callers in main.dart inject a
        // real refresh that drives the system-browser callback flow.
        refreshAuth: refreshAuth,
        onReauthNeeded: onReauthNeeded ?? () {},
      ),
    );
  }

  /// Prefixes the workspace [basePath] onto a request [path]. `Dio.baseUrl`
  /// is the bare origin, so the effective URL is `<origin><basePath><path>`.
  /// With basePath `''` this returns [path] unchanged (modulo a guaranteed
  /// leading slash), keeping single-workspace requests byte-identical.
  ///
  /// Callers pass paths that may carry a query string (e.g.
  /// `/api/channels?nodeId=x`); since the basePath is only ever prepended to
  /// the front, the query is preserved verbatim.
  String _path(String path) =>
      // `api()` only consumes basePath + path; origin is irrelevant here
      // (Dio.baseUrl already supplies it), so we pass an empty origin.
      WorkspaceUrls('', basePath).api(path);

  @override
  Future<dynamic> get(String path) async {
    final response = await _dio.get<dynamic>(_path(path));
    return response.data;
  }

  @override
  Future<dynamic> post(String path, {Map<String, dynamic>? body}) async {
    final response = await _dio.post<dynamic>(_path(path), data: body);
    return response.data;
  }

  @override
  Future<dynamic> patch(String path, {Map<String, dynamic>? body}) async {
    final response = await _dio.patch<dynamic>(_path(path), data: body);
    return response.data;
  }

  @override
  Future<void> delete(String path, {Map<String, dynamic>? body}) async {
    await _dio.delete<dynamic>(_path(path), data: body);
  }
}
