import 'package:dio/dio.dart';

import '../../application/ports/secure_storage_port.dart';

/// Reads CF_Authorization from flutter_secure_storage on every outbound
/// request and injects it as a Cookie header. Spec §2.2 rule 3: Dio
/// NEVER reads from the WebView cookie store.
class AuthInterceptor extends Interceptor {
  AuthInterceptor({required this.storage, required this.serverId});

  final SecureStoragePort storage;
  final String serverId;

  @override
  Future<void> onRequest(
    RequestOptions options,
    RequestInterceptorHandler handler,
  ) async {
    final token = await storage.read(serverId, 'cf_authorization');
    if (token != null && token.isNotEmpty) {
      final existing = options.headers['Cookie'] as String?;
      final newCookie = 'CF_Authorization=$token';
      options.headers['Cookie'] = existing == null || existing.isEmpty
          ? newCookie
          : '$existing; $newCookie';
    }
    handler.next(options);
  }
}
