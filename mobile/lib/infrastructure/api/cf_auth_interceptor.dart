import 'dart:async';
import 'dart:io' show HttpHeaders;

import 'package:dio/dio.dart';

/// Reads the active server's `CF_Authorization` cookie from secure
/// storage and attaches it as `Cookie: CF_Authorization=<value>` on every
/// outbound request. On a 401/403 response, fires [onReauthNeeded] so
/// the UI layer can route the user back through the CF Access flow.
///
/// Spec §2.2 rule 3: Dio NEVER reads from the WebView's cookie jar.
/// The cookie is captured by [CookieReader] during the WebView login
/// flow and persisted to flutter_secure_storage; this interceptor is
/// the only thing that pulls it back out and ships it on the wire.
///
/// Cookie composition:
/// - When no `Cookie` header exists, sets it to `CF_Authorization=<v>`.
/// - When a `Cookie` header already exists, appends with `; ` separator
///   so any cookies set by upstream interceptors are preserved.
class CfAuthInterceptor extends Interceptor {
  CfAuthInterceptor({
    required this.serverId,
    required this.cookieReader,
    required this.onReauthNeeded,
  });

  /// Server scope used by [cookieReader] to look up the right cookie.
  final String serverId;

  /// Reads the persisted CF_Authorization cookie for [serverId]. Returns
  /// `null` (or empty string) when no cookie has been captured yet.
  final FutureOr<String?> Function(String serverId) cookieReader;

  /// Fires once per failed (401/403) response. Idempotent on the
  /// consumer side: the UI debounces by routing to `/reauth` only when
  /// not already there.
  final void Function() onReauthNeeded;

  @override
  Future<void> onRequest(
    RequestOptions options,
    RequestInterceptorHandler handler,
  ) async {
    final cookie = await cookieReader(serverId);
    if (cookie != null && cookie.isNotEmpty) {
      // Dio's headers map is case-sensitive; look up any existing
      // Cookie key (regardless of casing) so we append rather than
      // shadow when something upstream already set one.
      final existingKey = options.headers.keys.firstWhere(
        (k) => k.toLowerCase() == HttpHeaders.cookieHeader,
        orElse: () => HttpHeaders.cookieHeader,
      );
      final existing = options.headers[existingKey] as String?;
      final cfPart = 'CF_Authorization=$cookie';
      options.headers[existingKey] = existing == null || existing.isEmpty
          ? cfPart
          : '$existing; $cfPart';
    }
    handler.next(options);
  }

  @override
  void onError(DioException err, ErrorInterceptorHandler handler) {
    final status = err.response?.statusCode;
    if (status == 401 || status == 403) {
      onReauthNeeded();
    }
    handler.next(err);
  }
}
