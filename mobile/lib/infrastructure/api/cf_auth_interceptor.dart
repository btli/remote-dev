import 'dart:async';
import 'dart:io' show HttpHeaders;

import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart' show debugPrint;

import '../../domain/auth_cookie.dart';
import 'cf_identity_jwt.dart';

/// Holds the auth material attached by [CfAuthInterceptor] on each
/// outbound request.
///
/// At least one of [apiKey] / [cookies] must be non-empty for the
/// request to succeed against a remote server:
/// - Servers fronted by CF Access or OIDC need a `Cookie:` header carrying
///   the relevant tokens (e.g. `CF_Authorization=<jwt>` or
///   `__Secure-next-auth.session-token=<tok>`). All cookies in [cookies]
///   are joined as `name=value; …` and appended to any existing `Cookie`
///   header on the outbound request.
/// - The Next.js auth layer accepts either an authenticated session
///   (impossible from a Dio client) OR `Authorization: Bearer <apiKey>`.
/// - With both present we get the strongest combo: the tunnel admits the
///   request, and the app server authenticates it via the API key.
///
/// [cfCookie] is a **deprecated** single-cookie shorthand kept for call-site
/// compatibility during migration. New code should pass credentials via
/// [cookies]. When [cfCookie] is non-null and [cookies] is empty, the
/// interceptor synthesises `[AuthCookie(name:"CF_Authorization", ...)]`
/// so that old callers continue to work unchanged.
///
/// [serviceClientId] / [serviceClientSecret] carry an optional per-host
/// Cloudflare Access **service token** (the `CF-Access-Client-Id` /
/// `CF-Access-Client-Secret` pair). Unlike the harvested `CF_Authorization`
/// cookie — which expires with the CF Access session and so leaves headless
/// work (e.g. the push registrar) unauthenticated off-LAN until the next
/// interactive open — a service token is a permanent credential validated by
/// Cloudflare at the edge with no session and no expiry.
///
/// IMPORTANT (remote-dev-2w1o follow-up): the service token is an EDGE-ONLY,
/// NON-IDENTITY credential. It clears the Cloudflare perimeter, but the JWT
/// Cloudflare then injects toward the origin carries `common_name` and NO
/// `email`, so it can NEVER establish a user session — `validateAccessJWT`
/// rejects it and identity-dependent surfaces fall back to `/login`.
///
/// The interceptor therefore NEVER sends the service token alongside a valid
/// identity cookie. Cloudflare Access evaluates **Service Auth policies FIRST**
/// and stops at the first match, so a request carrying both would be admitted by
/// the Service Auth policy and the origin would get the NON-identity JWT — the
/// exact regression this guards against. Instead the interceptor makes a
/// deterministic, client-side, per-request choice (see [cfIdentityCookieValue] /
/// `cfCookieIsFreshIdentity`):
///   * `CF_Authorization` present AND unexpired → send ONLY the cookie, attach
///     NO service headers (the edge admits WITH identity → pages + identity API
///     routes work — this is the branch that fixes the off-LAN reauth loop).
///   * `CF_Authorization` absent / expired / undecodable → attach the service
///     headers and DROP `CF_Authorization` from the cookies (a stale cookie sent
///     next to the service token only muddies the edge and can never help); the
///     origin still authenticates via the Bearer API key.
/// Either way EVERY OTHER cookie (the instance's OIDC session) is retained. The
/// service HEADERS are additionally suppressed on a refresh replay or a tripped
/// breaker so a revoked/misconfigured token can't defeat cookie-path recovery.
class AuthMaterial {
  const AuthMaterial({
    this.apiKey,
    this.cfCookie,
    this.cookies = const [],
    this.serviceClientId,
    this.serviceClientSecret,
  });

  final String? apiKey;

  /// Deprecated: prefer [cookies].
  final String? cfCookie;

  /// Named auth cookies to be sent as `Cookie: name=value; …`.
  final List<AuthCookie> cookies;

  /// Public half of an optional CF Access service token, attached as the
  /// `CF-Access-Client-Id` header when paired with [serviceClientSecret].
  final String? serviceClientId;

  /// Confidential half of an optional CF Access service token, attached as the
  /// `CF-Access-Client-Secret` header when paired with [serviceClientId].
  ///
  /// SECURITY: never logged, printed, or interpolated anywhere.
  final String? serviceClientSecret;

  /// True when a complete service token (both halves, both non-empty) is
  /// present. Cloudflare only honours the pair, so a half-populated token is
  /// treated as absent.
  bool get hasServiceToken =>
      serviceClientId != null &&
      serviceClientId!.isNotEmpty &&
      serviceClientSecret != null &&
      serviceClientSecret!.isNotEmpty;

  /// Whether this material has any usable credential, ignoring any per-request
  /// suppression (the interceptor decides attachment per request). A complete
  /// service token counts on its own — it is sufficient edge auth material.
  bool get isEmpty =>
      (apiKey == null || apiKey!.isEmpty) &&
      _baseCookies.isEmpty &&
      !hasServiceToken;

  /// The value of the `CF_Authorization` identity cookie, or `null` when none is
  /// present. Used by the interceptor to decide (via `cfCookieIsFreshIdentity`)
  /// whether a still-valid identity cookie should be preferred over the
  /// non-identity service token for THIS request.
  String? get cfIdentityCookieValue {
    for (final c in _baseCookies) {
      if (c.name == 'CF_Authorization') return c.value;
    }
    return null;
  }

  /// The cookies to send for a request, given whether the service token is
  /// actually being attached to THAT request ([includeServiceToken]).
  ///
  /// When the service token IS attached the `CF_Authorization` edge cookie is
  /// filtered out: the interceptor only attaches the service token when the
  /// identity cookie is absent or EXPIRED (see the class doc), so a lingering
  /// stale `CF_Authorization` sent alongside the service headers can never help
  /// — it would only add a second, dead edge credential. Every OTHER cookie is
  /// preserved — the instance behind the edge still authenticates via its OIDC
  /// session cookies, which the service token does not replace.
  ///
  /// When the service token is NOT attached (absent, a FRESH identity cookie was
  /// preferred instead, suppressed on a refresh replay, or disabled by the
  /// breaker) the cookie list is returned intact, including any
  /// `CF_Authorization` — that cookie is then the edge identity credential and
  /// must ride along.
  List<AuthCookie> cookiesFor({required bool includeServiceToken}) {
    final base = _baseCookies;
    if (!includeServiceToken) return base;
    return base.where((c) => c.name != 'CF_Authorization').toList();
  }

  /// The cookie list: [cookies] when non-empty; otherwise synthesise from legacy
  /// [cfCookie] for backwards compatibility.
  List<AuthCookie> get _baseCookies {
    if (cookies.isNotEmpty) return cookies;
    final cf = cfCookie;
    if (cf != null && cf.isNotEmpty) {
      return [AuthCookie(name: 'CF_Authorization', value: cf, path: '/')];
    }
    return const [];
  }
}

/// Reads the active server's auth material (API key + CF Access JWT +
/// optional CF Access service token) and attaches them to every outbound
/// request:
/// - `Authorization: Bearer <apiKey>` when an API key is stored
/// - `CF-Access-Client-Id` / `CF-Access-Client-Secret` when a complete
///   per-host service token is stored (the permanent off-LAN edge credential)
///   AND no fresh `CF_Authorization` identity cookie is available for this
///   request. When a fresh identity cookie IS available the service headers are
///   NOT attached — the identity cookie is preferred so the origin receives a
///   real user identity (see [AuthMaterial] for why both must never be sent).
/// - `Cookie: CF_Authorization=<cfCookie>` (plus any other auth cookies)
///   appended to any existing `Cookie` header so upstream interceptors are
///   preserved
///
/// The `onError` silent-refresh / interactive-reauth flow below is unchanged
/// by the service token: if a service token is revoked at the edge Cloudflare
/// still answers with a `302 → cloudflareaccess.com`, which this interceptor
/// classifies as an auth failure and recovers from via the existing path.
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

  /// Per-request [RequestOptions.extra] flag set on a replay when the ORIGINAL
  /// request carried service-token headers and still drew a CF auth failure.
  /// When set, [onRequest] resolves auth material AS IF no service token
  /// existed: it attaches no `CF-Access-Client-*` headers and does NOT exclude
  /// `CF_Authorization` from the cookies. This lets the silent-refresh replay
  /// fall back to the freshly-harvested CF cookie path so a revoked or
  /// misconfigured service token can't permanently defeat interactive recovery.
  static const _skipServiceTokenKey = 'rdv.cfAuth.skipServiceToken';

  /// Per-request [RequestOptions.extra] flag recording that [onRequest]
  /// actually attached service-token headers to this request. [onError] reads
  /// it to decide whether a CF auth failure should trip the breaker and replay
  /// the request with the service token suppressed.
  static const _serviceHeadersAttachedKey = 'rdv.cfAuth.serviceHeadersAttached';

  /// Per-request [RequestOptions.extra] key holding the exact `(clientId,
  /// clientSecret)` pair [onRequest] attached to THIS request. On a CF auth
  /// failure [onError] trips the breaker with this request-local pair rather
  /// than re-reading storage — otherwise a token the user re-saved between the
  /// request going out and its 302 being handled would be recorded as the
  /// "failed" pair and wrongly suppressed.
  ///
  /// SECURITY: the values it holds are the SAME strings already present in this
  /// in-memory request's `headers` map, so stamping them here adds no new
  /// exposure. They are NEVER logged.
  static const _attachedServicePairKey = 'rdv.cfAuth.attachedServicePair';

  /// HTTP header names for the CF Access service-token pair. Centralised so the
  /// attach path and the stale-header scrub agree on exact spelling.
  static const _serviceClientIdHeader = 'CF-Access-Client-Id';
  static const _serviceClientSecretHeader = 'CF-Access-Client-Secret';

  /// Per-request [RequestOptions.extra] key holding the PRE-EXISTING `Cookie`
  /// header value captured the FIRST time [onRequest] composed cookies for this
  /// request (the empty string when there was none, i.e. nothing upstream set
  /// one). Composition is then always `base (+ '; ' + ourPart)`, so it is
  /// idempotent across the original pass and any number of refresh replays:
  /// `dio.fetch` reuses the same RequestOptions whose `Cookie` header already
  /// carries the previous pass's contribution, and appending blindly would
  /// duplicate cookie names (`sess=x; sess=x; …`) — benign when values match,
  /// but a stale FIRST occurrence shadows a refreshed value at the server and
  /// fails the replay into the interactive path. Stamping the genuinely-upstream
  /// base once and rebuilding from it preserves upstream cookies exactly while
  /// keeping our contribution fresh and single.
  static const _cookieBaseKey = 'rdv.cfAuth.cookieBase';

  /// Mutex so a burst of concurrent failures dedupes to a single
  /// browser launch — every caller awaits the same Completer.
  Completer<AuthMaterial?>? _refreshInFlight;

  /// Circuit breaker for a bad service token (revoked / misconfigured), scoped
  /// to THIS interceptor instance (one app session). Once a CF auth failure is
  /// observed on a request that carried service-token headers, the breaker
  /// trips and subsequent requests stop attaching the service token (the cookie
  /// path resumes) — otherwise every request would re-attach the dead token,
  /// re-fail at the edge, and trigger a browser-refresh flash on each call.
  ///
  /// The breaker holds the exact pair that failed ([_breakerClientId] /
  /// [_breakerClientSecret], in memory only, NEVER logged). When [authReader]
  /// later returns a DIFFERENT pair (the user re-saved the token) the breaker
  /// resets and the new token is attached again. Storage is never touched —
  /// clearing or replacing the token is the user's call.
  bool _serviceTokenBreakerTripped = false;
  String? _breakerClientId;
  String? _breakerClientSecret;

  @override
  Future<void> onRequest(
    RequestOptions options,
    RequestInterceptorHandler handler,
  ) async {
    // Force every non-2xx response (including 3xx) through `onError` so
    // `_isAuthFailure` can detect CF Access's 302→cloudflareaccess.com
    // login redirect instead of it being silently followed and decoded
    // as JSON. The Remote Dev API never legitimately returns a 3xx the
    // client should follow — if that changes, callers will need an
    // opt-out per request (e.g., a RequestOptions.extra flag).
    options.followRedirects = false;
    options.validateStatus =
        (status) => status != null && status >= 200 && status < 300;

    final material = await authReader(serverId);

    // Decide whether the service token applies to THIS request. It is suppressed
    // when any of:
    //   - a FRESH `CF_Authorization` identity cookie is available — the edge
    //     admits WITH identity, so we must NOT also send the non-identity service
    //     token (Service Auth policies match first and would strip the identity);
    //   - this is a refresh replay of a request whose service headers already
    //     failed at the CF edge (the per-request skip flag), or
    //   - the in-session circuit breaker has tripped for the SAME pair.
    // In all cases we behave as if no service token existed: no service headers
    // are attached, and `CF_Authorization` is NOT dropped from the cookies (see
    // [cookiesFor]) so the identity/cookie path is used and can recover.
    //
    // If the breaker is tripped but [authReader] now returns a DIFFERENT pair,
    // the user re-saved the token: reset the breaker and let the new token ride.
    if (_serviceTokenBreakerTripped && material.hasServiceToken) {
      final samePair = material.serviceClientId == _breakerClientId &&
          material.serviceClientSecret == _breakerClientSecret;
      if (!samePair) _resetServiceTokenBreaker();
    }
    // Prefer a still-valid identity cookie over the non-identity service token.
    // Decoded locally (public `exp` claim only — no verification) so the choice
    // is deterministic and never depends on Cloudflare's policy-evaluation order.
    final hasFreshIdentityCookie =
        cfCookieIsFreshIdentity(material.cfIdentityCookieValue);
    final skipThisRequest = hasFreshIdentityCookie ||
        options.extra[_skipServiceTokenKey] == true ||
        _serviceTokenBreakerTripped;
    final useServiceToken = material.hasServiceToken && !skipThisRequest;

    final apiKey = material.apiKey;
    if (apiKey != null && apiKey.isNotEmpty) {
      options.headers[HttpHeaders.authorizationHeader] = 'Bearer $apiKey';
    }

    // Cloudflare Access service token: when a complete pair is present AND not
    // suppressed (no fresh identity cookie / replay / breaker), attach both
    // headers so Cloudflare admits the request at the edge with no session and no
    // expiry (the permanent off-LAN credential). In this branch any stale
    // `CF_Authorization` is dropped from the cookies (see [cookiesFor]); the
    // origin re-authenticates via the Bearer API key. SECURITY: only a boolean
    // "present" fact is ever logged below — never the values.
    if (useServiceToken) {
      options.headers[_serviceClientIdHeader] = material.serviceClientId;
      options.headers[_serviceClientSecretHeader] = material.serviceClientSecret;
      // Record that service headers rode on this request so [onError] can,
      // on a CF auth failure, trip the breaker and replay without them — and
      // stamp the exact pair so the breaker captures THIS request's creds, not
      // whatever storage holds by the time the 302 is handled.
      options.extra[_serviceHeadersAttachedKey] = true;
      options.extra[_attachedServicePairKey] =
          <String>[material.serviceClientId!, material.serviceClientSecret!];
      // Host-only, boolean-only breadcrumb to aid on-device validation. Must
      // NOT include either credential value (the id is the public half, but we
      // keep the log minimal and value-free on principle).
      debugPrint('[CfAuth] service token attached for $serverId');
    } else {
      // The effective decision is "no service token" — either it was never
      // present, or it is suppressed (refresh replay / tripped breaker). Scrub
      // any stale service headers left on this request object. This matters on
      // a replay: `dio.fetch` reuses the SAME RequestOptions, whose headers map
      // still carries the `CF-Access-Client-*` pair from the failed attempt; if
      // we didn't remove them the "clean" cookie-path replay would still send
      // the dead headers and 302 again, killing recovery.
      _removeServiceHeaders(options);
    }

    final effectiveCookies =
        material.cookiesFor(includeServiceToken: useServiceToken);
    if (effectiveCookies.isNotEmpty) {
      // Build the cookie string from all auth cookies: "name=value; name=value".
      final newPart = effectiveCookies.map((c) => '${c.name}=${c.value}').join('; ');

      // Dio's headers map is case-sensitive; look up any existing Cookie key
      // (regardless of casing) so we append rather than shadow when something
      // upstream already set one.
      final existingKey = options.headers.keys.firstWhere(
        (k) => k.toLowerCase() == HttpHeaders.cookieHeader,
        orElse: () => HttpHeaders.cookieHeader,
      );

      // Idempotent composition: compose from the PRE-EXISTING (genuinely
      // upstream) Cookie value, not from whatever a prior pass wrote. On the
      // first pass we stamp the current header (or '' if none) as the base; on
      // a replay we reuse that stamp instead of the header `dio.fetch` carried
      // forward — so our cookies appear exactly once with the freshest values,
      // while any upstream cookie survives untouched. See [_cookieBaseKey].
      final String base;
      final stamped = options.extra[_cookieBaseKey];
      if (stamped is String) {
        base = stamped;
      } else {
        base = (options.headers[existingKey] as String?) ?? '';
        options.extra[_cookieBaseKey] = base;
      }

      options.headers[existingKey] = base.isEmpty ? newPart : '$base; $newPart';
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

    // If this failed request carried service-token headers, the token is bad
    // at the edge (revoked / misconfigured). Trip the in-session breaker so
    // future requests stop attaching it (cookie path resumes, no per-request
    // browser-refresh flash), and mark THIS request to be replayed without it
    // so the refresh below can recover via the freshly-harvested CF cookie.
    if (err.requestOptions.extra[_serviceHeadersAttachedKey] == true) {
      // Trip with the pair THIS request actually sent (stamped at attach time),
      // not whatever storage holds now — the user may have re-saved the token
      // between the request going out and this 302 being handled.
      _tripServiceTokenBreaker(
        err.requestOptions.extra[_attachedServicePairKey],
      );
      err.requestOptions.extra[_skipServiceTokenKey] = true;
      // Physically strip the dead service headers from the reused
      // RequestOptions so the replay's `dio.fetch` doesn't resend them. The
      // skip flag makes onRequest avoid re-attaching them and also scrub
      // defensively, but remove them here too so the request is clean even if
      // a future change bypasses that path.
      _removeServiceHeaders(err.requestOptions);
      // Allow this request one more retry on the cookie path even if it was
      // already retried once with the (bad) service token — the service-token
      // attempt and the cookie attempt are distinct credentials.
      err.requestOptions.extra.remove(_retrySentinelKey);
      err.requestOptions.extra.remove(_serviceHeadersAttachedKey);
      err.requestOptions.extra.remove(_attachedServicePairKey);
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
      if (location != null && location.toLowerCase().contains(_cfAccessHost)) {
        return true;
      }
    }

    if (status == 200) {
      final contentType = _headerValue(response, HttpHeaders.contentTypeHeader);
      if (contentType != null &&
          contentType.toLowerCase().contains('text/html')) {
        return true;
      }
    }

    return false;
  }

  /// Trip the in-session service-token breaker, capturing the exact pair that
  /// the failed request carried — passed in from [RequestOptions.extra] (the
  /// [_attachedServicePairKey] stamp) so it is THIS request's creds, not a pair
  /// the user may have re-saved in the meantime. A later DIFFERENT pair (the
  /// re-saved token) then resets the breaker in [onRequest]. Idempotent:
  /// tripping again with the same pair leaves it tripped.
  ///
  /// [attachedPair] is the `dynamic` value read straight from the extra map; it
  /// is expected to be the `<String>[clientId, clientSecret]` list stamped at
  /// attach time. Anything else (absent / wrong shape) just trips the breaker
  /// without a captured pair — still safe (suppresses the token until the next
  /// app restart or a successful different-pair attach).
  ///
  /// SECURITY: the captured pair is held in memory only and is NEVER logged.
  void _tripServiceTokenBreaker(Object? attachedPair) {
    _serviceTokenBreakerTripped = true;
    if (attachedPair is List && attachedPair.length == 2) {
      final id = attachedPair[0];
      final secret = attachedPair[1];
      if (id is String && secret is String) {
        _breakerClientId = id;
        _breakerClientSecret = secret;
      }
    }
  }

  /// Clear the breaker so the (newly-saved) service token is attached again.
  void _resetServiceTokenBreaker() {
    _serviceTokenBreakerTripped = false;
    _breakerClientId = null;
    _breakerClientSecret = null;
  }

  /// Remove both `CF-Access-Client-*` headers from [options], matching the key
  /// case-insensitively (Dio's headers map is case-sensitive, but an upstream
  /// caller could conceivably have set a differently-cased variant). Used to
  /// scrub a revoked service token off a request before it is replayed on the
  /// cookie path.
  void _removeServiceHeaders(RequestOptions options) {
    final targets = <String>{
      _serviceClientIdHeader.toLowerCase(),
      _serviceClientSecretHeader.toLowerCase(),
    };
    options.headers.removeWhere((k, _) => targets.contains(k.toLowerCase()));
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
        // Clear AFTER waiting awaiters have resumed (their listeners are
        // microtasks queued by complete/completeError). Clearing
        // synchronously here would let a CF failure in the same tick miss
        // the mutex and launch a redundant browser refresh.
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
