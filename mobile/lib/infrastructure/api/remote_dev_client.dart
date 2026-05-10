import 'package:dio/dio.dart';

import '../../application/ports/api_client_port.dart';
import '../../application/ports/secure_storage_port.dart';
import 'cf_auth_interceptor.dart';

class RemoteDevClient implements ApiClientPort {
  RemoteDevClient({
    required this.serverOrigin,
    required this.serverId,
    required SecureStoragePort storage,
    void Function()? onReauthNeeded,
    Dio? dio,
  }) : _dio = dio ?? Dio() {
    _dio.options
      ..baseUrl = serverOrigin.toString()
      ..connectTimeout = const Duration(seconds: 15)
      ..receiveTimeout = const Duration(seconds: 30);
    _dio.interceptors.add(
      CfAuthInterceptor(
        serverId: serverId,
        cookieReader: (id) => storage.read(id, 'cf_authorization'),
        onReauthNeeded: onReauthNeeded ?? () {},
      ),
    );
  }

  final Uri serverOrigin;
  final String serverId;
  final Dio _dio;

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
  Future<void> delete(String path) async {
    await _dio.delete<dynamic>(path);
  }
}
