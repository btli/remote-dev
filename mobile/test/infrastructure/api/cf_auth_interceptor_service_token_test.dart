// Tests for the Cloudflare Access service-token support in CfAuthInterceptor /
// AuthMaterial (remote-dev-2j8g + remote-dev-2w1o follow-up):
//   - both CF-Access-Client-* headers attached when a complete pair is present
//   - DETERMINISTIC edge-credential selection: the interceptor decodes the
//     CF_Authorization JWT's `exp` locally and picks ONE credential per request
//     (Cloudflare evaluates Service Auth policies FIRST, so sending both would
//     let the non-identity service token win):
//       * FRESH identity cookie  → cookie sent, NO service headers, no reauth
//       * EXPIRED / MALFORMED / absent cookie → service headers attached,
//         CF_Authorization dropped, OIDC session cookie kept
//   - behaviour is unchanged when service creds are absent
//   - a half-populated pair attaches nothing and keeps the cookie
//   - isEmpty / hasServiceToken semantics
//   - revoked-token recovery: a CF-302 on a service-token request trips the
//     in-session breaker, the replay falls back to the CF cookie (no service
//     headers), subsequent requests skip the token, and the breaker resets
//     when the stored pair changes (finding 1)
//   - idempotent cookie composition across replays: each cookie name appears
//     exactly once on the replay, the refreshed CF value (not a stale
//     duplicate) rides, and an upstream-set Cookie survives both passes
//
// NOTE: the placeholder cookie values below ('jwt', 'harvested-jwt', …) are NOT
// decodable JWTs, so cfCookieIsFreshIdentity treats them as expired → the
// service-token branch (headers attached, CF_Authorization dropped). The
// dedicated "identity cookie freshness" group uses REAL exp-bearing JWTs built
// by [_jwtWithExp] to exercise the fresh vs expired split.
import 'dart:convert';
import 'dart:io' show HttpHeaders;
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:remote_dev/domain/auth_cookie.dart';
import 'package:remote_dev/infrastructure/api/cf_auth_interceptor.dart';

/// Seconds-since-epoch [offset] away from now (negative = in the past).
int _epochOffset(Duration offset) =>
    DateTime.now().add(offset).millisecondsSinceEpoch ~/ 1000;

/// Build a decodable, UNSIGNED JWT (`header.payload.`) whose payload carries the
/// given [expSeconds] `exp` claim. cfCookieIsFreshIdentity only reads the public
/// `exp`, so the empty signature segment is irrelevant. base64url segments are
/// emitted WITHOUT `=` padding, exactly as a real JWT does — proving the decoder
/// re-pads correctly.
String _jwtWithExp(int expSeconds, {String email = 'user@example.com'}) {
  String seg(Map<String, dynamic> m) =>
      base64Url.encode(utf8.encode(jsonEncode(m))).replaceAll('=', '');
  final header = seg(<String, dynamic>{'alg': 'RS256', 'typ': 'JWT'});
  final payload = seg(<String, dynamic>{'email': email, 'exp': expSeconds});
  return '$header.$payload.';
}

class _MockRequestHandler extends Mock implements RequestInterceptorHandler {}

/// Sequence-aware [HttpClientAdapter]: serves whatever [responder] returns and
/// records each outbound request so a test can assert what the interceptor
/// transmitted on every call (original + replays).
///
/// IMPORTANT: Dio reuses the SAME [RequestOptions] instance across the original
/// request and an interceptor-driven `dio.fetch` replay, so the live [captured]
/// objects all alias one mutable headers map — reading `captured[0].headers`
/// after the flow shows the FINAL state, not what call 0 sent. To assert the
/// per-call wire state we therefore snapshot a COPY of the headers map at each
/// fetch into [capturedHeaders]; index it (not `captured[i].headers`) when a
/// test cares what a specific call carried.
class _SeqAdapter implements HttpClientAdapter {
  _SeqAdapter(this.responder);

  final ResponseBody Function(RequestOptions options, int callIndex) responder;
  final List<RequestOptions> captured = <RequestOptions>[];
  final List<Map<String, dynamic>> capturedHeaders = <Map<String, dynamic>>[];

  @override
  void close({bool force = false}) {}

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<dynamic>? cancelFuture,
  ) async {
    final idx = captured.length;
    captured.add(options);
    // Snapshot the headers at the moment of transmission (see class doc).
    capturedHeaders.add(Map<String, dynamic>.from(options.headers));
    return responder(options, idx);
  }
}

ResponseBody _redirect302(String location) => ResponseBody.fromString(
      '',
      302,
      headers: {
        HttpHeaders.locationHeader: [location],
      },
    );

ResponseBody _json200() => ResponseBody.fromString(
      '{"ok":true}',
      200,
      headers: {
        HttpHeaders.contentTypeHeader: ['application/json'],
      },
    );

const _cfLoginRedirect =
    'https://joyfulhouse.cloudflareaccess.com/cdn-cgi/access/login/x';

/// Count how many times a cookie [name] appears in a `Cookie` header value
/// (`a=1; b=2; a=3` → name `a` → 2). Used to prove composition is idempotent
/// across replays (no duplicate `name=` segments).
int _cookieNameCount(String? cookieHeader, String name) {
  if (cookieHeader == null || cookieHeader.isEmpty) return 0;
  return cookieHeader
      .split(';')
      .map((p) => p.trim())
      .where((p) => p == name || p.startsWith('$name='))
      .length;
}

void main() {
  setUpAll(() {
    registerFallbackValue(RequestOptions(path: '/'));
  });

  CfAuthInterceptor build(AuthMaterial material) => CfAuthInterceptor(
        dio: Dio(),
        serverId: 'host-1',
        authReader: (_) async => material,
        refreshAuth: (_) async => null,
        onReauthNeeded: () => fail('should not fire'),
      );

  group('CfAuthInterceptor — CF Access service token', () {
    test(
      'attaches both CF-Access-Client-* headers when a complete pair is present',
      () async {
        final handler = _MockRequestHandler();
        when(() => handler.next(any())).thenAnswer((_) {});

        final interceptor = build(
          const AuthMaterial(
            serviceClientId: 'cid.public',
            serviceClientSecret: 'csecret.value',
          ),
        );

        final options = RequestOptions(path: '/api/sessions');
        await interceptor.onRequest(options, handler);

        expect(options.headers['CF-Access-Client-Id'], 'cid.public');
        expect(options.headers['CF-Access-Client-Secret'], 'csecret.value');
        verify(() => handler.next(options)).called(1);
      },
    );

    test(
      'with an EXPIRED (undecodable) CF_Authorization, drops it but KEEPS other '
      'cookies when service creds set',
      () async {
        final handler = _MockRequestHandler();
        when(() => handler.next(any())).thenAnswer((_) {});

        // 'stale-jwt' is not a decodable JWT → treated as expired → the service
        // token is preferred and the dead CF_Authorization is dropped.
        final interceptor = build(
          const AuthMaterial(
            serviceClientId: 'cid',
            serviceClientSecret: 'csecret',
            cookies: [
              AuthCookie(name: 'CF_Authorization', value: 'stale-jwt', path: '/'),
              AuthCookie(
                name: '__Secure-next-auth.session-token',
                value: 'oidc-tok',
                path: '/',
              ),
            ],
          ),
        );

        final options = RequestOptions(path: '/api/sessions');
        await interceptor.onRequest(options, handler);

        final cookie = options.headers['cookie'] as String;
        // The dead edge cookie is dropped (service headers are the credential).
        expect(cookie, isNot(contains('CF_Authorization')));
        expect(cookie, isNot(contains('stale-jwt')));
        // The OIDC session cookie — still required behind the edge — is kept.
        expect(cookie, contains('__Secure-next-auth.session-token=oidc-tok'));
        // Headers attached because the identity cookie was not fresh.
        expect(options.headers['CF-Access-Client-Id'], 'cid');
        expect(options.headers['CF-Access-Client-Secret'], 'csecret');
      },
    );

    test(
      'when service creds set and an EXPIRED CF_Authorization is the only '
      'cookie, no Cookie header is emitted',
      () async {
        final handler = _MockRequestHandler();
        when(() => handler.next(any())).thenAnswer((_) {});

        final interceptor = build(
          const AuthMaterial(
            serviceClientId: 'cid',
            serviceClientSecret: 'csecret',
            cookies: [
              AuthCookie(name: 'CF_Authorization', value: 'jwt', path: '/'),
            ],
          ),
        );

        final options = RequestOptions(path: '/api/sessions');
        await interceptor.onRequest(options, handler);

        // The sole cookie was an expired CF_Authorization → dropped → no Cookie
        // header, and the service token carries the request past the edge.
        expect(options.headers.containsKey('cookie'), isFalse);
        expect(options.headers['CF-Access-Client-Id'], 'cid');
      },
    );

    test(
      'behaviour unchanged when service creds are absent (cookie incl. CF_Auth)',
      () async {
        final handler = _MockRequestHandler();
        when(() => handler.next(any())).thenAnswer((_) {});

        final interceptor = build(
          const AuthMaterial(
            apiKey: 'sk-abc',
            cookies: [
              AuthCookie(name: 'CF_Authorization', value: 'jwt', path: '/'),
            ],
          ),
        );

        final options = RequestOptions(path: '/api/sessions');
        await interceptor.onRequest(options, handler);

        // No service token → no headers, and CF_Authorization is sent as before.
        expect(options.headers.containsKey('CF-Access-Client-Id'), isFalse);
        expect(options.headers.containsKey('CF-Access-Client-Secret'), isFalse);
        expect(options.headers['cookie'], 'CF_Authorization=jwt');
        expect(options.headers['authorization'], 'Bearer sk-abc');
      },
    );

    test(
      'a half-populated pair (id only) attaches nothing and keeps CF_Authorization',
      () async {
        final handler = _MockRequestHandler();
        when(() => handler.next(any())).thenAnswer((_) {});

        final interceptor = build(
          const AuthMaterial(
            serviceClientId: 'cid',
            // secret missing → not a usable pair.
            cookies: [
              AuthCookie(name: 'CF_Authorization', value: 'jwt', path: '/'),
            ],
          ),
        );

        final options = RequestOptions(path: '/api/sessions');
        await interceptor.onRequest(options, handler);

        expect(options.headers.containsKey('CF-Access-Client-Id'), isFalse);
        expect(options.headers.containsKey('CF-Access-Client-Secret'), isFalse);
        // No complete pair → cookie is NOT excluded.
        expect(options.headers['cookie'], 'CF_Authorization=jwt');
      },
    );

    group('hasServiceToken / isEmpty semantics', () {
      test('hasServiceToken is true only for a complete non-empty pair', () {
        expect(
          const AuthMaterial(
            serviceClientId: 'i',
            serviceClientSecret: 's',
          ).hasServiceToken,
          isTrue,
        );
        expect(
          const AuthMaterial(serviceClientId: 'i').hasServiceToken,
          isFalse,
        );
        expect(
          const AuthMaterial(serviceClientSecret: 's').hasServiceToken,
          isFalse,
        );
        expect(
          const AuthMaterial(serviceClientId: '', serviceClientSecret: '')
              .hasServiceToken,
          isFalse,
        );
      });

      test('isEmpty is false when a service token is present (no other creds)',
          () {
        expect(
          const AuthMaterial(
            serviceClientId: 'i',
            serviceClientSecret: 's',
          ).isEmpty,
          isFalse,
        );
      });

      test('isEmpty is true when only a half-pair is present', () {
        expect(const AuthMaterial(serviceClientId: 'i').isEmpty, isTrue);
        expect(const AuthMaterial(serviceClientSecret: 's').isEmpty, isTrue);
      });
    });
  });

  group('CfAuthInterceptor — deterministic identity-vs-service selection', () {
    test(
      '(a) FRESH CF_Authorization + service creds → cookie sent, NO '
      'CF-Access-Client-* headers, no reauth bounce (remote-dev-2w1o loop fix)',
      () async {
        final dio = Dio();
        // Edge admits WITH identity (fresh cookie) → the origin sees a real user
        // → 200 on the FIRST try (no 302, no refresh, no reauth).
        final adapter = _SeqAdapter((options, idx) => _json200());
        dio.httpClientAdapter = adapter;

        final freshJwt = _jwtWithExp(_epochOffset(const Duration(hours: 1)));
        var reauthCalls = 0;
        dio.interceptors.add(
          CfAuthInterceptor(
            dio: dio,
            serverId: 'host-1',
            authReader: (_) async => AuthMaterial(
              serviceClientId: 'cid',
              serviceClientSecret: 'csecret',
              cookies: [
                AuthCookie(
                  name: 'CF_Authorization',
                  value: freshJwt,
                  path: '/',
                ),
              ],
            ),
            refreshAuth: (_) async => fail('no auth failure → no refresh'),
            onReauthNeeded: () => reauthCalls += 1,
          ),
        );

        final response = await dio.get<dynamic>('/api/sessions');
        expect(response.statusCode, 200);
        expect(reauthCalls, 0, reason: 'identity cookie authenticates → no loop');
        expect(adapter.captured.length, 1, reason: 'no replay needed');

        final sent = adapter.capturedHeaders.single;
        // The identity cookie is on the wire and the service token is WITHHELD
        // (sending both would let Cloudflare's Service-Auth-first policy strip
        // the identity).
        expect(sent['cookie'], contains('CF_Authorization=$freshJwt'));
        expect(sent.containsKey('CF-Access-Client-Id'), isFalse);
        expect(sent.containsKey('CF-Access-Client-Secret'), isFalse);
      },
    );

    test(
      '(b) EXPIRED CF_Authorization + service creds → headers attached, '
      'CF_Authorization dropped, OIDC cookie kept',
      () async {
        final handler = _MockRequestHandler();
        when(() => handler.next(any())).thenAnswer((_) {});

        final expiredJwt = _jwtWithExp(_epochOffset(const Duration(hours: -1)));
        final interceptor = build(
          AuthMaterial(
            serviceClientId: 'cid',
            serviceClientSecret: 'csecret',
            cookies: [
              AuthCookie(
                name: 'CF_Authorization',
                value: expiredJwt,
                path: '/',
              ),
              const AuthCookie(
                name: '__Secure-next-auth.session-token',
                value: 'oidc-tok',
                path: '/',
              ),
            ],
          ),
        );

        final options = RequestOptions(path: '/api/sessions');
        await interceptor.onRequest(options, handler);

        final cookie = options.headers['cookie'] as String;
        // Expired identity → service token wins, dead cookie dropped…
        expect(cookie, isNot(contains('CF_Authorization')));
        expect(cookie, isNot(contains(expiredJwt)));
        // …OIDC session cookie kept; service headers attached.
        expect(cookie, contains('__Secure-next-auth.session-token=oidc-tok'));
        expect(options.headers['CF-Access-Client-Id'], 'cid');
        expect(options.headers['CF-Access-Client-Secret'], 'csecret');
      },
    );

    test(
      '(b2) an identity cookie within the 30s skew window is treated as expired '
      '→ service token wins',
      () async {
        final handler = _MockRequestHandler();
        when(() => handler.next(any())).thenAnswer((_) {});

        // exp is in the future but inside the skew guard (10s < 30s) → stale.
        final almostExpired =
            _jwtWithExp(_epochOffset(const Duration(seconds: 10)));
        final interceptor = build(
          AuthMaterial(
            serviceClientId: 'cid',
            serviceClientSecret: 'csecret',
            cookies: [
              AuthCookie(
                name: 'CF_Authorization',
                value: almostExpired,
                path: '/',
              ),
            ],
          ),
        );

        final options = RequestOptions(path: '/api/sessions');
        await interceptor.onRequest(options, handler);

        expect(options.headers.containsKey('cookie'), isFalse);
        expect(options.headers['CF-Access-Client-Id'], 'cid');
      },
    );

    test(
      '(c) MALFORMED CF_Authorization + service creds → treated as expired '
      '(service token wins, cookie dropped)',
      () async {
        final handler = _MockRequestHandler();
        when(() => handler.next(any())).thenAnswer((_) {});

        // Not a JWT at all (no exp to decode) → treated as expired.
        final interceptor = build(
          const AuthMaterial(
            serviceClientId: 'cid',
            serviceClientSecret: 'csecret',
            cookies: [
              AuthCookie(
                name: 'CF_Authorization',
                value: 'not-a-jwt',
                path: '/',
              ),
            ],
          ),
        );

        final options = RequestOptions(path: '/api/sessions');
        await interceptor.onRequest(options, handler);

        expect(options.headers.containsKey('cookie'), isFalse);
        expect(options.headers['CF-Access-Client-Id'], 'cid');
        expect(options.headers['CF-Access-Client-Secret'], 'csecret');
      },
    );
  });

  group('CfAuthInterceptor — revoked service-token recovery (finding 1)', () {
    test(
      'bad service token → refresh returns CF cookie → replay sends CF cookie '
      'and NO service headers',
      () async {
        final dio = Dio();
        // 1st call (service headers, CF cookie excluded) → CF 302.
        // 2nd call (the replay) → 200.
        final adapter = _SeqAdapter((options, idx) {
          if (idx == 0) return _redirect302(_cfLoginRedirect);
          return _json200();
        });
        dio.httpClientAdapter = adapter;

        var reauthCalls = 0;
        dio.interceptors.add(
          CfAuthInterceptor(
            dio: dio,
            serverId: 'host-1',
            // Stored material: a complete service token + a CF_Authorization
            // cookie (the harvested edge cookie) + an OIDC session cookie.
            authReader: (_) async => const AuthMaterial(
              serviceClientId: 'cid',
              serviceClientSecret: 'csecret',
              cookies: [
                AuthCookie(
                  name: 'CF_Authorization',
                  value: 'harvested-jwt',
                  path: '/',
                ),
                AuthCookie(
                  name: '__Secure-next-auth.session-token',
                  value: 'oidc',
                  path: '/',
                ),
              ],
            ),
            // Silent refresh "succeeds" (browser SSO still valid) → returns the
            // same material; the replay's recovery comes from suppressing the
            // service token, not from new creds.
            refreshAuth: (_) async => const AuthMaterial(
              cookies: [
                AuthCookie(
                  name: 'CF_Authorization',
                  value: 'harvested-jwt',
                  path: '/',
                ),
              ],
            ),
            onReauthNeeded: () => reauthCalls += 1,
          ),
        );

        final response = await dio.get<dynamic>('/api/sessions');
        expect(response.statusCode, 200);
        expect(reauthCalls, 0, reason: 'cookie-path replay recovers silently');
        expect(adapter.captured.length, 2, reason: 'original + one replay');

        // Use the per-call header SNAPSHOTS (not the aliased live RequestOptions
        // — see _SeqAdapter doc) so each assertion reflects what that specific
        // call transmitted.
        // Original request: the harvested CF cookie is an undecodable placeholder
        // → treated as expired → the service token is preferred, its headers are
        // attached, and the dead CF_Authorization is dropped. The OIDC session
        // cookie is kept.
        final first = adapter.capturedHeaders[0];
        expect(first['CF-Access-Client-Id'], 'cid');
        expect(first['CF-Access-Client-Secret'], 'csecret');
        expect(first['cookie'], isNot(contains('CF_Authorization')));
        expect(
          first['cookie'],
          contains('__Secure-next-auth.session-token=oidc'),
        );

        // Replay: the dead service headers must be GONE from the wire (finding
        // 1 — the stale CF-Access-Client-* from the failed attempt were being
        // resent on the "clean" cookie-path replay), and the CF cookie now
        // rides along for recovery.
        final replay = adapter.capturedHeaders[1];
        expect(replay.containsKey('CF-Access-Client-Id'), isFalse);
        expect(replay.containsKey('CF-Access-Client-Secret'), isFalse);
        expect(
          replay['cookie'],
          contains('CF_Authorization=harvested-jwt'),
        );
        expect(
          replay['cookie'],
          contains('__Secure-next-auth.session-token=oidc'),
        );
        // Idempotent composition (last code fix): each cookie name appears
        // EXACTLY once on the replay — no `sess=x; sess=x` duplication from the
        // reused RequestOptions whose Cookie header already held pass 1's value.
        final replayCookie = replay['cookie'] as String;
        expect(_cookieNameCount(replayCookie, 'CF_Authorization'), 1);
        expect(
          _cookieNameCount(replayCookie, '__Secure-next-auth.session-token'),
          1,
        );
      },
    );

    test(
      'when refresh UPDATES the CF cookie value, the replay sends the FRESH '
      'value exactly once (no stale duplicate shadowing it)',
      () async {
        final dio = Dio();
        final adapter = _SeqAdapter((options, idx) {
          if (idx == 0) return _redirect302(_cfLoginRedirect);
          return _json200();
        });
        dio.httpClientAdapter = adapter;

        // The harvested CF cookie is refreshed mid-flight: the original pass
        // sends the STALE value; after the 302, refresh persists a FRESH value
        // and the replay's authReader returns it. With naive append the replay
        // header would be `CF_Authorization=stale; CF_Authorization=fresh` and
        // the server would honour the stale FIRST occurrence → fail. Idempotent
        // composition rebuilds from the (empty) upstream base, so only the fresh
        // value rides, exactly once.
        var cfValue = 'stale-jwt';
        dio.interceptors.add(
          CfAuthInterceptor(
            dio: dio,
            serverId: 'host-1',
            authReader: (_) async => AuthMaterial(
              cookies: [
                AuthCookie(
                  name: 'CF_Authorization',
                  value: cfValue,
                  path: '/',
                ),
              ],
            ),
            refreshAuth: (_) async {
              cfValue = 'fresh-jwt'; // refresh updated the stored cookie
              return const AuthMaterial(
                cookies: [
                  AuthCookie(
                    name: 'CF_Authorization',
                    value: 'fresh-jwt',
                    path: '/',
                  ),
                ],
              );
            },
            onReauthNeeded: () => fail('refresh succeeds → no interactive path'),
          ),
        );

        final response = await dio.get<dynamic>('/api/sessions');
        expect(response.statusCode, 200);
        expect(adapter.captured.length, 2);

        // Original pass carried the stale value.
        expect(adapter.capturedHeaders[0]['cookie'], 'CF_Authorization=stale-jwt');

        // Replay: the FRESH value, exactly once, with NO stale duplicate.
        final replayCookie = adapter.capturedHeaders[1]['cookie'] as String;
        expect(replayCookie, contains('CF_Authorization=fresh-jwt'));
        expect(replayCookie, isNot(contains('stale-jwt')));
        expect(_cookieNameCount(replayCookie, 'CF_Authorization'), 1);
      },
    );

    test(
      'an upstream-set Cookie header (set before the interceptor) survives both '
      'passes exactly once',
      () async {
        final dio = Dio();
        final adapter = _SeqAdapter((options, idx) {
          if (idx == 0) return _redirect302(_cfLoginRedirect);
          return _json200();
        });
        dio.httpClientAdapter = adapter;

        // An interceptor added BEFORE CfAuthInterceptor sets an upstream cookie.
        dio.interceptors.add(
          InterceptorsWrapper(
            onRequest: (options, handler) {
              options.headers['Cookie'] = 'upstream=keep';
              handler.next(options);
            },
          ),
        );
        dio.interceptors.add(
          CfAuthInterceptor(
            dio: dio,
            serverId: 'host-1',
            authReader: (_) async => const AuthMaterial(
              cookies: [
                AuthCookie(name: 'CF_Authorization', value: 'jwt', path: '/'),
              ],
            ),
            refreshAuth: (_) async => const AuthMaterial(
              cookies: [
                AuthCookie(name: 'CF_Authorization', value: 'jwt', path: '/'),
              ],
            ),
            onReauthNeeded: () {},
          ),
        );

        final response = await dio.get<dynamic>('/api/sessions');
        expect(response.statusCode, 200);

        for (final headers in adapter.capturedHeaders) {
          // The upstream interceptor set a capital-`Cookie` key and the
          // interceptor preserves that casing, so look the header up
          // case-insensitively rather than assuming a lowercase key.
          final cookieKey = headers.keys.firstWhere(
            (k) => k.toLowerCase() == 'cookie',
          );
          final cookie = headers[cookieKey] as String;
          // Upstream cookie preserved, exactly once, on BOTH passes…
          expect(_cookieNameCount(cookie, 'upstream'), 1);
          expect(cookie, contains('upstream=keep'));
          // …and our cookie appears exactly once too.
          expect(_cookieNameCount(cookie, 'CF_Authorization'), 1);
        }
      },
    );

    test(
      'after the breaker trips, the NEXT (fresh) request attaches cookies, '
      'not service headers',
      () async {
        final dio = Dio();
        // Call 0: CF 302 (trips breaker). Call 1: replay 200. Call 2: the next
        // fresh request — must already skip the service token.
        final adapter = _SeqAdapter((options, idx) {
          if (idx == 0) return _redirect302(_cfLoginRedirect);
          return _json200();
        });
        dio.httpClientAdapter = adapter;

        final interceptor = CfAuthInterceptor(
          dio: dio,
          serverId: 'host-1',
          authReader: (_) async => const AuthMaterial(
            serviceClientId: 'cid',
            serviceClientSecret: 'csecret',
            cookies: [
              AuthCookie(
                name: 'CF_Authorization',
                value: 'harvested-jwt',
                path: '/',
              ),
            ],
          ),
          refreshAuth: (_) async => const AuthMaterial(
            cookies: [
              AuthCookie(
                name: 'CF_Authorization',
                value: 'harvested-jwt',
                path: '/',
              ),
            ],
          ),
          onReauthNeeded: () {},
        );
        dio.interceptors.add(interceptor);

        // First request trips the breaker and recovers on the cookie path.
        await dio.get<dynamic>('/api/a');
        // A brand-new request (own RequestOptions, no skip flag).
        await dio.get<dynamic>('/api/b');

        expect(adapter.captured.last.path, '/api/b');
        final fresh = adapter.capturedHeaders.last;
        expect(fresh.containsKey('CF-Access-Client-Id'), isFalse);
        expect(fresh.containsKey('CF-Access-Client-Secret'), isFalse);
        // Cookie path resumed: CF_Authorization is sent (not excluded).
        expect(
          fresh['cookie'],
          contains('CF_Authorization=harvested-jwt'),
        );
      },
    );

    test(
      'breaker resets when the stored pair changes (user re-saved the token)',
      () async {
        final dio = Dio();
        // Call 0: CF 302 (trips breaker on pair A). Call 1: replay 200.
        // Call 2: fresh request after the user saved pair B → headers attached.
        final adapter = _SeqAdapter((options, idx) {
          if (idx == 0) return _redirect302(_cfLoginRedirect);
          return _json200();
        });
        dio.httpClientAdapter = adapter;

        // Mutable material so the test can swap the stored pair mid-session.
        var clientId = 'cid-A';
        var clientSecret = 'secret-A';
        dio.interceptors.add(
          CfAuthInterceptor(
            dio: dio,
            serverId: 'host-1',
            authReader: (_) async => AuthMaterial(
              serviceClientId: clientId,
              serviceClientSecret: clientSecret,
              cookies: const [
                AuthCookie(
                  name: 'CF_Authorization',
                  value: 'jwt',
                  path: '/',
                ),
              ],
            ),
            refreshAuth: (_) async => const AuthMaterial(
              cookies: [
                AuthCookie(name: 'CF_Authorization', value: 'jwt', path: '/'),
              ],
            ),
            onReauthNeeded: () {},
          ),
        );

        // Trip the breaker on pair A.
        await dio.get<dynamic>('/api/a');

        // User re-saves a DIFFERENT token.
        clientId = 'cid-B';
        clientSecret = 'secret-B';

        // Next fresh request: breaker resets, new pair attached again.
        await dio.get<dynamic>('/api/b');

        expect(adapter.captured.last.path, '/api/b');
        final fresh = adapter.capturedHeaders.last;
        expect(fresh['CF-Access-Client-Id'], 'cid-B');
        expect(fresh['CF-Access-Client-Secret'], 'secret-B');
        // Service token attached again (the 'jwt' placeholder is undecodable →
        // treated as expired) → CF_Authorization dropped once more.
        expect(
          (fresh['cookie'] as String?) ?? '',
          isNot(contains('CF_Authorization')),
        );
      },
    );

    test(
      'breaker captures the pair the request ACTUALLY sent, even if the stored '
      'pair changed before the 302 was handled (finding 2)',
      () async {
        final dio = Dio();
        // Call 0 (request A, OLD pair) → CF 302. Call 1 (replay) → 200.
        // Call 2 (request B, NEW pair) → 200.
        final adapter = _SeqAdapter((options, idx) {
          if (idx == 0) return _redirect302(_cfLoginRedirect);
          return _json200();
        });
        dio.httpClientAdapter = adapter;

        // The user saves a NEW pair AFTER request A's headers go out but BEFORE
        // its 302 is handled. We model that with a call-counted authReader:
        // call #1 (A's onRequest attach) returns OLD; every later read returns
        // NEW. The breaker must capture OLD (the pair A actually sent, stamped
        // at attach time) — NOT NEW (which a re-read of storage at trip time
        // would wrongly capture), so the re-saved NEW token is not suppressed.
        var reads = 0;
        dio.interceptors.add(
          CfAuthInterceptor(
            dio: dio,
            serverId: 'host-1',
            authReader: (_) async {
              reads += 1;
              final useOld = reads == 1;
              return AuthMaterial(
                serviceClientId: useOld ? 'cid-OLD' : 'cid-NEW',
                serviceClientSecret: useOld ? 'secret-OLD' : 'secret-NEW',
                cookies: const [
                  AuthCookie(name: 'CF_Authorization', value: 'jwt', path: '/'),
                ],
              );
            },
            refreshAuth: (_) async => const AuthMaterial(
              cookies: [
                AuthCookie(name: 'CF_Authorization', value: 'jwt', path: '/'),
              ],
            ),
            onReauthNeeded: () {},
          ),
        );

        // Request A: attaches OLD, 302, breaker trips (on OLD), cookie replay.
        await dio.get<dynamic>('/api/a');
        // Request A actually carried the OLD pair on the wire.
        expect(adapter.capturedHeaders[0]['CF-Access-Client-Id'], 'cid-OLD');

        // Request B: authReader now returns NEW. Because the breaker holds OLD,
        // NEW differs → breaker resets → NEW is attached (not suppressed).
        await dio.get<dynamic>('/api/b');

        expect(adapter.captured.last.path, '/api/b');
        final fresh = adapter.capturedHeaders.last;
        expect(
          fresh['CF-Access-Client-Id'],
          'cid-NEW',
          reason: 're-saved token must NOT be suppressed by the breaker',
        );
        expect(fresh['CF-Access-Client-Secret'], 'secret-NEW');
      },
    );
  });
}
