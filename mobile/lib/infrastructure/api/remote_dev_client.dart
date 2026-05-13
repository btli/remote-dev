import 'package:dio/dio.dart';

import '../../application/ports/api_client_port.dart';
import '../../application/ports/secure_storage_port.dart';
import '../auth/mobile_credentials.dart';
import 'cf_auth_interceptor.dart';

class RemoteDevClient implements ApiClientPort {
  RemoteDevClient({
    required this.serverOrigin,
    required this.serverId,
    required SecureStoragePort storage,
    void Function()? onReauthNeeded,
    Future<AuthMaterial?> Function(String serverId)? refreshAuth,
    Dio? dio,
  })  : _dio = dio ?? Dio(),
        _credentials = MobileCredentialsStore(storage) {
    _dio.options
      ..baseUrl = serverOrigin.toString()
      ..connectTimeout = const Duration(seconds: 15)
      ..receiveTimeout = const Duration(seconds: 30);
    _dio.interceptors.add(
      CfAuthInterceptor(
        dio: _dio,
        serverId: serverId,
        authReader: (id) async {
          final apiKey = await _credentials.readApiKey(id);
          final cfToken = await _credentials.readCfToken(id);
          return AuthMaterial(apiKey: apiKey, cfCookie: cfToken);
        },
        // Default no-op refresh: returns null so the interceptor falls
        // through to onReauthNeeded. Production callers (see main.dart
        // -> buildServerScopedOverrides) inject a real refresh that
        // drives the system-browser /auth/mobile-callback flow.
        refreshAuth: refreshAuth ?? ((_) async => null),
        onReauthNeeded: onReauthNeeded ?? () {},
      ),
    );
  }

  final Uri serverOrigin;
  final String serverId;
  final Dio _dio;
  final MobileCredentialsStore _credentials;

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
