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
/// On a CF Access intervention (401/403, redirect to
/// `cloudflareaccess.com`, or a 200 HTML response) the interceptor first
/// tries to **silently refresh** the auth material by re-running the
/// system-browser callback flow via [refreshAuth]. The platform browser
/// (Chrome Custom Tab / SFSafariViewController) typically still holds a
/// valid CF Access SSO session even after our stored JWT has expired, so
/// the user usually sees only a brief Custom-Tab flash before the
/// original request is replayed transparently with fresh credentials.
///
/// Only when refresh **genuinely fails** (browser SSO also dead, network
/// down, user cancelled the browser sheet) does the interceptor fire
/// [onReauthNeeded] so the UI can route to a full `/reauth` screen.
///
/// Cookie composition:
/// - When no `Cookie` header exists, sets it to `CF_Authorization=<v>`.
/// - When a `Cookie` header already exists, appends with `; ` separator.
///
/// Redirect handling:
/// - Disables Dio's automatic redirect-following so CF's
///   `302 → cloudflareaccess.com/cdn-cgi/access/login/...` page surfaces
///   as a DioException we can classify, rather than being silently
///   fetched as HTML and decoded as JSON.
///
/// Concurrency:
/// - A single in-flight refresh is shared across simultaneous failures
///   via a [Completer] mutex, so a burst of three concurrent requests
///   only triggers ONE browser launch.
///
/// Retry safety:
/// - The replayed request is stamped with a sentinel in
///   `RequestOptions.extra` to guard against infinite retry loops if
///   the freshly-refreshed JWT is somehow still rejected.
class CfAuthInterceptor extends Interceptor {
  CfAuthInterceptor({
    required this.dio,
    required this.serverId,
    required this.authReader,
    required this.refreshAuth,
    required this.onReauthNeeded,
  });

  /// Back-reference to the owning Dio so the interceptor can call
  /// [Dio.fetch] to replay the original request after a successful
  /// silent refresh.
  final Dio dio;

  /// Server scope used by [authReader] / [refreshAuth] to look up or
  /// mint the right material.
  final String serverId;

  /// Reads the persisted auth material for [serverId]. Returns an
  /// [AuthMaterial] with `null`/empty fields when no credentials have
  /// been captured yet — the interceptor then sends an unauthenticated
  /// request, the server returns 401/403, and refresh kicks in.
  final FutureOr<AuthMaterial> Function(String serverId) authReader;

  /// Drives the system-browser CF Access callback flow to mint fresh
  /// credentials for [serverId], persists them via the mobile
  /// credentials store, and returns the new [AuthMaterial] (with at
  /// least an `apiKey` populated) — or `null` when the browser session
  /// is also dead, the user cancelled, the network is down, or any
  /// other failure occurred.
  ///
  /// MUST be safe to await from a Dio interceptor context: it will be
  /// called from within `onError`, so it should not depend on
  /// concurrent Dio activity against the same client.
  final FutureOr<AuthMaterial?> Function(String serverId) refreshAuth;

  /// Fired only when silent refresh via [refreshAuth] fails (returned
  /// null, threw, or the replayed request still came back with a CF
  /// intervention). The UI is expected to debounce by routing to
  /// `/reauth` only when not already there.
  final void Function() onReauthNeeded;

  static const _cfAccessHost = 'cloudflareaccess.com';
  static const _redirectStatuses = <int>{301, 302, 303, 307, 308};

  /// Namespaced sentinel key for [RequestOptions.extra] so we don't
  /// collide with anything else stashing data on the same map.
  static const _retrySentinelKey = 'rdv.cfAuth.retryAttempted';

  /// Mutex so a burst of concurrent failures dedupes to a single
  /// browser launch — every caller awaits the same Completer.
  Completer<AuthMaterial?>? _refreshInFlight;

  @override
  Future<void> onRequest(
    RequestOptions options,
    RequestInterceptorHandler handler,
  ) async {
    // All outbound API requests have follow-redirects disabled so
    // Cloudflare Access's 302→cloudflareaccess.com login redirect lands in
    // `onError` (where _isAuthFailure classifies it) instead of being
    // silently fetched as HTML and decoded as JSON. The Remote Dev API
    // itself never legitimately responds with a 3xx that the client should
    // follow — if that ever changes, this guard will need an opt-out per
    // request (e.g., a RequestOptions.extra flag). validateStatus is
    // narrowed to 2xx for the same reason: anything else flows through
    // onError where CF interventions can be detected and silently
    // refreshed.
    options.followRedirects = false;
    options.validateStatus = (status) =>
        status != null && status >= 200 && status < 300;

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
  Future<void> onError(
    DioException err,
    ErrorInterceptorHandler handler,
  ) async {
    if (!_isAuthFailure(err)) {
      handler.next(err);
      return;
    }

    // Sentinel guard: this request was already retried once with a
    // refreshed JWT and still failed. Don't spin — give up, signal
    // the UI for an interactive recovery, and let the caller's catch
    // fire with the original retry error.
    if (err.requestOptions.extra[_retrySentinelKey] == true) {
      onReauthNeeded();
      handler.next(err);
      return;
    }

    // Dedupe concurrent refreshes: the first failure starts the
    // browser flow; any subsequent failure observes a non-null
    // _refreshInFlight and awaits the same Completer.
    final AuthMaterial? fresh;
    try {
      fresh = await _runRefresh();
    } catch (_) {
      // refreshAuth itself threw — fall through to onReauthNeeded.
      onReauthNeeded();
      handler.next(err);
      return;
    }

    if (fresh == null || fresh.isEmpty) {
      onReauthNeeded();
      handler.next(err);
      return;
    }

    // Stamp the sentinel BEFORE replaying so a still-failing retry
    // can't loop. dio.fetch reuses the same RequestOptions instance.
    err.requestOptions.extra[_retrySentinelKey] = true;

    try {
      final response = await dio.fetch<dynamic>(err.requestOptions);
      handler.resolve(response);
    } on DioException catch (retryErr) {
      // Retry itself failed. If it's another CF intervention, the
      // sentinel ensures we don't recurse — onError will see the
      // sentinel and surface to onReauthNeeded directly. For any
      // other failure (network, 5xx), just propagate.
      handler.next(retryErr);
    } catch (e, st) {
      // Wrap any non-Dio throwable into a DioException so handlers
      // upstream remain typed-correct.
      handler.next(
        DioException(
          requestOptions: err.requestOptions,
          error: e,
          stackTrace: st,
          type: DioExceptionType.unknown,
          message: 'Retry after CF refresh failed: $e',
        ),
      );
    }
  }

  /// True when the error looks like CF Access intervention or an
  /// outright auth failure:
  /// - 401 or 403, OR
  /// - 3xx whose `Location` points at `cloudflareaccess.com`, OR
  /// - 200 whose Content-Type is `text/html` (defense-in-depth — once
  ///   redirects are disabled this shouldn't normally reach onError,
  ///   but `validateStatus` could conceivably surface a 200 here in
  ///   the future).
  bool _isAuthFailure(DioException err) {
    final response = err.response;
    final status = response?.statusCode;

    if (status == 401 || status == 403) return true;

    if (status != null && _redirectStatuses.contains(status)) {
      final location = _headerValue(response, HttpHeaders.locationHeader);
      if (location != null &&
          location.toLowerCase().contains(_cfAccessHost)) {
        return true;
      }
    }

    if (status == 200) {
      final contentType =
          _headerValue(response, HttpHeaders.contentTypeHeader);
      if (contentType != null &&
          contentType.toLowerCase().contains('text/html')) {
        return true;
      }
    }

    return false;
  }

  /// Coalesces concurrent refresh calls onto a single browser launch.
  Future<AuthMaterial?> _runRefresh() {
    final pending = _refreshInFlight;
    if (pending != null) return pending.future;

    final completer = Completer<AuthMaterial?>();
    _refreshInFlight = completer;

    // Fire-and-forget the async work; the completer is what callers
    // await. We clear _refreshInFlight in `finally` so the next CF
    // failure can start a fresh refresh once this one resolves.
    Future<void>(() async {
      try {
        final result = await refreshAuth(serverId);
        completer.complete(result);
      } catch (e, st) {
        completer.completeError(e, st);
      } finally {
        // Defer clearing until after all current awaiters have resumed from
        // pending.future. Dart schedules completer listeners as microtasks,
        // so if we clear `_refreshInFlight` synchronously in `finally`, a
        // request that hits a CF failure in the same tick (before the
        // listeners run) would miss the mutex and launch a redundant
        // browser refresh. scheduleMicrotask runs at the end of the current
        // microtask queue, after the listeners.
        scheduleMicrotask(() => _refreshInFlight = null);
      }
    });

    return completer.future;
  }

  String? _headerValue(Response<dynamic>? response, String name) {
    final headers = response?.headers;
    if (headers == null) return null;
    return headers.value(name);
  }
}
