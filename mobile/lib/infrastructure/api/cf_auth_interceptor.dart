import 'dart:async';
import 'dart:io' show HttpHeaders;

import 'package:dio/dio.dart';

/// Holds the auth material attached by [CfAuthInterceptor] on each
/// outbound request.
///
/// At least one of [apiKey] / [cfCookie] must be non-empty for the
/// request to succeed against a remote server:
/// - Servers fronted by CF Access need `Cookie: CF_Authorization=<jwt>`
///   for the CF tunnel to admit the request.
/// - The Next.js auth layer accepts either an authenticated session
///   (impossible from a Dio client) OR `Authorization: Bearer <apiKey>`.
/// - With both present we get the strongest combo: CF admits the
///   request, and the app server authenticates it via the API key.
class AuthMaterial {
  const AuthMaterial({this.apiKey, this.cfCookie});

  final String? apiKey;
  final String? cfCookie;

  bool get isEmpty =>
      (apiKey == null || apiKey!.isEmpty) &&
      (cfCookie == null || cfCookie!.isEmpty);
}

/// Reads the active server's auth material (API key + CF Access JWT) and
/// attaches them to every outbound request:
/// - `Authorization: Bearer <apiKey>` when an API key is stored
/// - `Cookie: CF_Authorization=<cfCookie>` appended to any existing
///   `Cookie` header so upstream interceptors are preserved
///
/// On a 401/403 response, fires [onReauthNeeded] so the UI can route
/// the user back through the system-browser CF Access flow.
///
/// Cookie composition:
/// - When no `Cookie` header exists, sets it to `CF_Authorization=<v>`.
/// - When a `Cookie` header already exists, appends with `; ` separator.
///
/// History: this class was originally `CfAuthInterceptor` and only
/// attached the cookie. The class name is preserved for source-stability
/// with the import sites in `remote_dev_client.dart`; the doc and shape
/// reflect the post-jch1 dual-auth model.
class CfAuthInterceptor extends Interceptor {
  CfAuthInterceptor({
    required this.serverId,
    required this.authReader,
    required this.onReauthNeeded,
  });

  /// Server scope used by [authReader] to look up the right material.
  final String serverId;

  /// Reads the persisted auth material for [serverId]. Returns an
  /// [AuthMaterial] with `null`/empty fields when no credentials have
  /// been captured yet — the interceptor then sends an unauthenticated
  /// request and the server returns 401/403, which fires [onReauthNeeded].
  final FutureOr<AuthMaterial> Function(String serverId) authReader;

  /// Fires once per failed (401/403) response. Idempotent on the
  /// consumer side: the UI debounces by routing to `/reauth` only when
  /// not already there.
  final void Function() onReauthNeeded;

  @override
  Future<void> onRequest(
    RequestOptions options,
    RequestInterceptorHandler handler,
  ) async {
    final material = await authReader(serverId);

    final apiKey = material.apiKey;
    if (apiKey != null && apiKey.isNotEmpty) {
      options.headers[HttpHeaders.authorizationHeader] = 'Bearer $apiKey';
    }

    final cookie = material.cfCookie;
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
