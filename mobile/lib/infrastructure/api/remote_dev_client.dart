import 'package:dio/dio.dart';

import '../../application/ports/api_client_port.dart';
import '../../application/ports/secure_storage_port.dart';
import '../auth/mobile_credentials.dart';
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
  /// `''` or `/<slug>`. Per Task A2 scope, [basePath] is a stored field only —
  /// request paths are NOT yet prefixed with it (that is Task B). For a
  /// migrated single-workspace config [basePath] is `''`, so the effective
  /// requests are byte-identical to the pre-migration client.
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
      // baseUrl stays at the bare origin for now — see Task B note above.
      baseUrl: origin,
      scopeId: workspaceId,
      authReader: (_) async {
        final apiKey = await _credentials.getWorkspaceApiKey(workspaceId);
        final cfToken = await _credentials.getHostCfToken(hostId);
        return AuthMaterial(apiKey: apiKey, cfCookie: cfToken);
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

  /// `''` or `/<slug>`. Stored for Task B; not yet applied to request paths.
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

  @override
  Future<dynamic> get(String path) async {
    final response = await _dio.get<dynamic>(path);
    return response.data;
  }

  @override
  Future<dynamic> post(String path, {Map<String, dynamic>? body}) async {
    final response = await _dio.post<dynamic>(path, data: body);
    return response.data;
  }

  @override
  Future<dynamic> patch(String path, {Map<String, dynamic>? body}) async {
    final response = await _dio.patch<dynamic>(path, data: body);
    return response.data;
  }

  @override
  Future<void> delete(String path, {Map<String, dynamic>? body}) async {
    await _dio.delete<dynamic>(path, data: body);
  }
}
