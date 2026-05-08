import 'package:dio/dio.dart';

import '../../application/ports/secure_storage_port.dart';

/// Reads CF_Authorization from flutter_secure_storage on every outbound
/// request and injects it as a Cookie header. Spec §2.2 rule 3: Dio
/// NEVER reads from the WebView cookie store.
///
/// On 401: invokes [onUnauthorized] (host should reload the WebView root
/// to re-run the CF Access challenge + recapture the cookie). Retries
/// the request once. After 2 failed retries, fires [onReauthRequired]
/// so the host can route to a 'reauth needed' screen.
class AuthInterceptor extends Interceptor {
  AuthInterceptor({
    required this.storage,
    required this.serverId,
    Future<bool> Function()? onUnauthorized,
    void Function()? onReauthRequired,
  })  : _onUnauthorized = onUnauthorized,
        _onReauthRequired = onReauthRequired;

  final SecureStoragePort storage;
  final String serverId;
  final Future<bool> Function()? _onUnauthorized;
  final void Function()? _onReauthRequired;
  int _retryCount = 0;

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

  @override
  Future<void> onError(
    DioException err,
    ErrorInterceptorHandler handler,
  ) async {
    if (err.response?.statusCode != 401) {
      handler.next(err);
      return;
    }
    if (_retryCount >= 2 || _onUnauthorized == null) {
      _retryCount = 0;
      _onReauthRequired?.call();
      handler.next(err);
      return;
    }
    _retryCount += 1;
    final ok = await _onUnauthorized();
    if (!ok) {
      _onReauthRequired?.call();
      handler.next(err);
      return;
    }
    try {
      // Retry the request with the (refreshed) cookie. Use a fresh
      // Dio instance so we don't recurse through this interceptor.
      final retry = Dio();
      final response = await retry.fetch<dynamic>(err.requestOptions);
      _retryCount = 0;
      handler.resolve(response);
    } on DioException catch (e) {
      handler.next(e);
    } catch (_) {
      handler.next(err);
    }
  }
}
