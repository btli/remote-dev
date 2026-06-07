// Tests for the Cloudflare Access service-token support in CfAuthInterceptor /
// AuthMaterial (remote-dev-2j8g):
//   - both CF-Access-Client-* headers attached when a complete pair is present
//   - the redundant CF_Authorization cookie is EXCLUDED while every other
//     cookie (the instance's OIDC session) is retained
//   - behaviour is unchanged when service creds are absent
//   - a half-populated pair attaches nothing and does not exclude the cookie
//   - isEmpty / hasServiceToken semantics
//   - revoked-token recovery: a CF-302 on a service-token request trips the
//     in-session breaker, the replay falls back to the CF cookie (no service
//     headers), subsequent requests skip the token, and the breaker resets
//     when the stored pair changes (finding 1)
import 'dart:io' show HttpHeaders;
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:remote_dev/domain/auth_cookie.dart';
import 'package:remote_dev/infrastructure/api/cf_auth_interceptor.dart';

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
      'excludes CF_Authorization but KEEPS other cookies when service creds set',
      () async {
        final handler = _MockRequestHandler();
        when(() => handler.next(any())).thenAnswer((_) {});

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
        // The redundant edge cookie is dropped (service headers supersede it).
        expect(cookie, isNot(contains('CF_Authorization')));
        expect(cookie, isNot(contains('stale-jwt')));
        // The OIDC session cookie — still required behind the edge — is kept.
        expect(cookie, contains('__Secure-next-auth.session-token=oidc-tok'));
        // Headers still attached alongside the retained cookie.
        expect(options.headers['CF-Access-Client-Id'], 'cid');
        expect(options.headers['CF-Access-Client-Secret'], 'csecret');
      },
    );

    test(
      'when service creds set and CF_Authorization is the only cookie, no Cookie '
      'header is emitted',
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

        // The sole cookie was CF_Authorization → excluded → no Cookie header.
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
        // Original request: service headers attached, CF cookie excluded.
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
        // Service token attached again → CF_Authorization excluded once more.
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
