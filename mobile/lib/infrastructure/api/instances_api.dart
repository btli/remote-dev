import 'package:dio/dio.dart';

import '../../application/ports/secure_storage_port.dart';
import '../../domain/instance_summary.dart';
import '../auth/mobile_credentials.dart';
import 'cf_auth_interceptor.dart';

/// Thrown when an origin answers `GET /api/instances` with a 404 — i.e. it is a
/// plain single-workspace Remote Dev server, not a Supervisor that hosts a
/// fleet of path-prefixed instances.
///
/// This is deliberately distinct from a transport failure: a 404 is a
/// *definitive* "no discovery here, fall back to single-workspace", whereas a
/// timeout / connection-refused is a retryable network error the UI should
/// surface as such (see [InstancesApi.list]).
class NotASupervisorException implements Exception {
  const NotASupervisorException(this.origin);

  /// The host origin (`scheme://host[:port]`) that returned 404.
  final String origin;

  @override
  String toString() =>
      'NotASupervisorException: $origin does not expose /api/instances '
      '(not a Supervisor host)';
}

/// Discovers the workspaces hosted by a Supervisor at a given host [origin].
///
/// Targets the host ROOT (no basePath): `GET {origin}/api/instances`. The
/// host-wide CF Access cookie is the only credential — there is no per-instance
/// API key at this layer — so it reuses [CfAuthInterceptor] with an API-key-less
/// [AuthMaterial], keeping the cookie convention (`Cookie: CF_Authorization=…`)
/// identical to the rest of the app rather than hand-rolling a second one.
///
/// Construction mirrors [RemoteDevClient.forWorkspace]'s DI: pass a
/// [MobileCredentialsStore] + the [hostId] (the picker already has both), and
/// the host CF token is read via [MobileCredentialsStore.getHostCfToken].
class InstancesApi {
  InstancesApi({
    required String origin,
    required String hostId,
    required SecureStoragePort storage,
    Dio? dio,
  })  : _origin = origin,
        _dio = dio ?? Dio() {
    final credentials = MobileCredentialsStore(storage);
    _dio.options
      ..baseUrl = origin
      ..connectTimeout = const Duration(seconds: 15)
      ..receiveTimeout = const Duration(seconds: 30);
    _dio.interceptors.add(
      CfAuthInterceptor(
        dio: _dio,
        serverId: hostId,
        // Host-auth-only: no API key at the host-root discovery layer.
        // The interceptor attaches all host auth cookies (OIDC session cookie,
        // CF Authorization, etc.) from the resolved list, PLUS the host-wide
        // CF Access service token when one is saved — without it, host-root
        // discovery (workspace picker refresh, "Open another workspace") would
        // still die behind CF Access once the harvested CF_Authorization cookie
        // expires, even though the user saved a permanent token. When the token
        // is attached the interceptor drops the redundant CF_Authorization
        // cookie and keeps the OIDC session cookie.
        authReader: (id) async {
          final hostCookies = await credentials.getHostAuthCookies(id);
          final service = await credentials.getHostServiceToken(id);
          return AuthMaterial(
            cookies: hostCookies,
            serviceClientId: service?.clientId,
            serviceClientSecret: service?.clientSecret,
          );
        },
        // Discovery does not drive an interactive re-auth: the caller already
        // owns a host auth token, and a failed discovery just surfaces as an
        // error the picker can retry. Null refresh → interceptor falls through.
        refreshAuth: (_) async => null,
        onReauthNeeded: () {},
      ),
    );
  }

  static const _path = '/api/instances';

  final String _origin;
  final Dio _dio;

  /// Fetch the host's instances.
  ///
  /// - 200 → parse the `instances` array into [InstanceSummary]s (applying the
  ///   `displayName` → `slug` fallback).
  /// - 404 → throw [NotASupervisorException] (definitively "not a supervisor").
  /// - any other non-2xx, timeout, or connection error → rethrow the underlying
  ///   [DioException] so the UI treats it as a retryable error.
  Future<List<InstanceSummary>> list() async {
    final Response<dynamic> response;
    try {
      response = await _dio.get<dynamic>(_path);
    } on DioException catch (err) {
      // A 404 is the one status we reinterpret: it means this origin is a plain
      // single-workspace server, not a Supervisor — regardless of the response
      // body (an HTML 404 page, a JSON `{error}`, or an empty body all mean the
      // same thing here). Everything else (401/403, 5xx, timeouts,
      // connection-refused) stays a normal error to retry.
      if (err.response?.statusCode == 404) {
        throw NotASupervisorException(_origin);
      }
      rethrow;
    }

    // Defense-in-depth: the default Dio `validateStatus` already routes a 404
    // into the catch above, but if a caller ever relaxes it (so a 404 surfaces
    // as a "successful" response) we MUST still treat it as "not a supervisor"
    // rather than trying to parse the body as an instances list.
    if (response.statusCode == 404) {
      throw NotASupervisorException(_origin);
    }

    final data = response.data;
    if (data is! Map<String, dynamic>) {
      throw DioException(
        requestOptions: response.requestOptions,
        response: response,
        type: DioExceptionType.badResponse,
        message: 'Expected a JSON object from $_path, got ${data.runtimeType}',
      );
    }

    final rawInstances = data['instances'];
    if (rawInstances is! List) {
      throw DioException(
        requestOptions: response.requestOptions,
        response: response,
        type: DioExceptionType.badResponse,
        message: 'Expected an "instances" array from $_path',
      );
    }

    return rawInstances
        .cast<Map<String, dynamic>>()
        .map(InstanceSummary.fromInstanceJson)
        .toList(growable: false);
  }
}
