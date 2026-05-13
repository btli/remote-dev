import 'dart:async';
import 'dart:convert';
import 'dart:io' show HttpHeaders;
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:remote_dev/infrastructure/api/cf_auth_interceptor.dart';

class _MockRequestHandler extends Mock implements RequestInterceptorHandler {}

class _MockErrorHandler extends Mock implements ErrorInterceptorHandler {}

/// Programmable [HttpClientAdapter] used so we can drive realistic
/// `dio.fetch(...)` retries through the interceptor without touching the
/// network.
///
/// Pass a [responder] for sequence-aware behavior. The adapter records
/// every path it served so tests can assert call counts.
class _CannedAdapter implements HttpClientAdapter {
  _CannedAdapter({this.responder});

  ResponseBody Function(RequestOptions options, int callIndex)? responder;

  final List<String> calls = <String>[];

  @override
  void close({bool force = false}) {}

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<dynamic>? cancelFuture,
  ) async {
    final idx = calls.length;
    calls.add(options.path);
    final r = responder;
    if (r == null) {
      return ResponseBody.fromString(
        '{}',
        200,
        headers: {
          HttpHeaders.contentTypeHeader: ['application/json'],
        },
      );
    }
    return r(options, idx);
  }
}

ResponseBody _jsonBody(int statusCode, Object json) {
  return ResponseBody.fromString(
    jsonEncode(json),
    statusCode,
    headers: {
      HttpHeaders.contentTypeHeader: ['application/json'],
    },
  );
}

ResponseBody _redirectBody(int statusCode, String location) {
  return ResponseBody.fromString(
    '',
    statusCode,
    headers: {
      HttpHeaders.locationHeader: [location],
    },
  );
}

void main() {
  setUpAll(() {
    registerFallbackValue(RequestOptions(path: '/'));
    registerFallbackValue(
      DioException(requestOptions: RequestOptions(path: '/')),
    );
  });

  // ------------------------------------------------------------------
  // onRequest — header / cookie / redirect-disable behavior
  // ------------------------------------------------------------------

  group('onRequest', () {
    test('attaches Authorization Bearer when api key is stored', () async {
      final handler = _MockRequestHandler();
      when(() => handler.next(any())).thenAnswer((_) {});
      final interceptor = CfAuthInterceptor(
        dio: Dio(),
        serverId: 'srv-1',
        authReader: (id) async {
          expect(id, 'srv-1');
          return const AuthMaterial(apiKey: 'sk-abc');
        },
        refreshAuth: (_) async => null,
        onReauthNeeded: () => fail('should not fire on success'),
      );

      final options = RequestOptions(path: '/api/sessions');
      await interceptor.onRequest(options, handler);

      expect(options.headers['authorization'], 'Bearer sk-abc');
      expect(options.headers.containsKey('cookie'), isFalse);
      verify(() => handler.next(options)).called(1);
    });

    test('attaches CF cookie when cfCookie is stored', () async {
      final handler = _MockRequestHandler();
      when(() => handler.next(any())).thenAnswer((_) {});
      final interceptor = CfAuthInterceptor(
        dio: Dio(),
        serverId: 'srv-1',
        authReader: (_) async => const AuthMaterial(cfCookie: 'jwt-token'),
        refreshAuth: (_) async => null,
        onReauthNeeded: () {},
      );

      final options = RequestOptions(path: '/api/sessions');
      await interceptor.onRequest(options, handler);

      expect(options.headers['cookie'], 'CF_Authorization=jwt-token');
      expect(options.headers.containsKey('authorization'), isFalse);
      verify(() => handler.next(options)).called(1);
    });

    test('attaches BOTH bearer key and CF cookie when both are stored',
        () async {
      final handler = _MockRequestHandler();
      when(() => handler.next(any())).thenAnswer((_) {});
      final interceptor = CfAuthInterceptor(
        dio: Dio(),
        serverId: 'srv-1',
        authReader: (_) async =>
            const AuthMaterial(apiKey: 'sk-abc', cfCookie: 'jwt-token'),
        refreshAuth: (_) async => null,
        onReauthNeeded: () {},
      );

      final options = RequestOptions(path: '/api/sessions');
      await interceptor.onRequest(options, handler);

      expect(options.headers['authorization'], 'Bearer sk-abc');
      expect(options.headers['cookie'], 'CF_Authorization=jwt-token');
    });

    test('does not set any auth header when nothing is stored', () async {
      final handler = _MockRequestHandler();
      when(() => handler.next(any())).thenAnswer((_) {});
      final interceptor = CfAuthInterceptor(
        dio: Dio(),
        serverId: 'srv-1',
        authReader: (_) async => const AuthMaterial(),
        refreshAuth: (_) async => null,
        onReauthNeeded: () {},
      );

      final options = RequestOptions(path: '/api/sessions');
      await interceptor.onRequest(options, handler);

      expect(options.headers.containsKey('cookie'), isFalse);
      expect(options.headers.containsKey('authorization'), isFalse);
      verify(() => handler.next(options)).called(1);
    });

    test('does not set headers when stored values are empty strings',
        () async {
      final handler = _MockRequestHandler();
      when(() => handler.next(any())).thenAnswer((_) {});
      final interceptor = CfAuthInterceptor(
        dio: Dio(),
        serverId: 'srv-1',
        authReader: (_) async => const AuthMaterial(apiKey: '', cfCookie: ''),
        refreshAuth: (_) async => null,
        onReauthNeeded: () {},
      );

      final options = RequestOptions(path: '/api/sessions');
      await interceptor.onRequest(options, handler);

      expect(options.headers.containsKey('cookie'), isFalse);
      expect(options.headers.containsKey('authorization'), isFalse);
    });

    test('appends CF cookie to existing Cookie header (case-insensitive)',
        () async {
      final handler = _MockRequestHandler();
      when(() => handler.next(any())).thenAnswer((_) {});
      final interceptor = CfAuthInterceptor(
        dio: Dio(),
        serverId: 'srv-1',
        authReader: (_) async => const AuthMaterial(cfCookie: 'jwt-token'),
        refreshAuth: (_) async => null,
        onReauthNeeded: () {},
      );

      final options = RequestOptions(
        path: '/api/sessions',
        headers: {'Cookie': 'foo=bar'},
      );
      await interceptor.onRequest(options, handler);

      final cookieKeys = options.headers.keys
          .where((k) => k.toLowerCase() == 'cookie')
          .toList();
      expect(cookieKeys.length, 1);
      expect(
        options.headers[cookieKeys.first],
        'foo=bar; CF_Authorization=jwt-token',
      );
    });

    test('supports synchronous authReader return', () async {
      final handler = _MockRequestHandler();
      when(() => handler.next(any())).thenAnswer((_) {});
      final interceptor = CfAuthInterceptor(
        dio: Dio(),
        serverId: 'srv-1',
        authReader: (_) => const AuthMaterial(apiKey: 'sync-key'),
        refreshAuth: (_) async => null,
        onReauthNeeded: () {},
      );

      final options = RequestOptions(path: '/api/sessions');
      await interceptor.onRequest(options, handler);

      expect(options.headers['authorization'], 'Bearer sync-key');
    });

    test('disables follow-redirects so CF Access 302s surface as errors',
        () async {
      final handler = _MockRequestHandler();
      when(() => handler.next(any())).thenAnswer((_) {});
      final interceptor = CfAuthInterceptor(
        dio: Dio(),
        serverId: 'srv-1',
        authReader: (_) async => const AuthMaterial(cfCookie: 'jwt'),
        refreshAuth: (_) async => null,
        onReauthNeeded: () {},
      );

      final options = RequestOptions(path: '/api/sessions');
      // Confirm Dio's default is on, so we know we changed it.
      expect(options.followRedirects, isTrue);

      await interceptor.onRequest(options, handler);

      expect(options.followRedirects, isFalse);
      // 2xx must still validate; 3xx must NOT (so they fall into onError).
      expect(options.validateStatus(200), isTrue);
      expect(options.validateStatus(204), isTrue);
      expect(options.validateStatus(302), isFalse);
      expect(options.validateStatus(401), isFalse);
      expect(options.validateStatus(500), isFalse);
    });
  });

  // ------------------------------------------------------------------
  // onError — classifier: synthetic DioException, no network
  //
  // Verifies which response shapes are recognized as auth failures and
  // which pass through unchanged.
  // ------------------------------------------------------------------

  group('onError — classifier', () {
    DioException buildError(int? status, {Map<String, List<String>>? headers}) {
      final requestOptions = RequestOptions(path: '/api/sessions');
      return DioException(
        requestOptions: requestOptions,
        response: status == null
            ? null
            : Response(
                requestOptions: requestOptions,
                statusCode: status,
                headers: Headers.fromMap(headers ?? const {}),
              ),
      );
    }

    test('does not fire refresh on 500', () async {
      var refreshes = 0;
      var reauthCalls = 0;
      final handler = _MockErrorHandler();
      when(() => handler.next(any())).thenAnswer((_) {});
      final interceptor = CfAuthInterceptor(
        dio: Dio(),
        serverId: 'srv-1',
        authReader: (_) async => const AuthMaterial(),
        refreshAuth: (_) async {
          refreshes += 1;
          return null;
        },
        onReauthNeeded: () => reauthCalls += 1,
      );

      final err = buildError(500);
      await interceptor.onError(err, handler);

      expect(refreshes, 0);
      expect(reauthCalls, 0);
      verify(() => handler.next(err)).called(1);
    });

    test('does not fire refresh when response is absent (network err)',
        () async {
      var refreshes = 0;
      var reauthCalls = 0;
      final handler = _MockErrorHandler();
      when(() => handler.next(any())).thenAnswer((_) {});
      final interceptor = CfAuthInterceptor(
        dio: Dio(),
        serverId: 'srv-1',
        authReader: (_) async => const AuthMaterial(),
        refreshAuth: (_) async {
          refreshes += 1;
          return null;
        },
        onReauthNeeded: () => reauthCalls += 1,
      );

      final err = buildError(null);
      await interceptor.onError(err, handler);

      expect(refreshes, 0);
      expect(reauthCalls, 0);
      verify(() => handler.next(err)).called(1);
    });

    test('does NOT fire refresh on a 302 to a non-cloudflareaccess host',
        () async {
      var refreshes = 0;
      var reauthCalls = 0;
      final handler = _MockErrorHandler();
      when(() => handler.next(any())).thenAnswer((_) {});
      final interceptor = CfAuthInterceptor(
        dio: Dio(),
        serverId: 'srv-1',
        authReader: (_) async => const AuthMaterial(),
        refreshAuth: (_) async {
          refreshes += 1;
          return null;
        },
        onReauthNeeded: () => reauthCalls += 1,
      );

      final err = buildError(
        302,
        headers: {
          HttpHeaders.locationHeader: ['https://api.example.com/v2/sessions'],
        },
      );
      await interceptor.onError(err, handler);

      expect(refreshes, 0);
      expect(reauthCalls, 0);
      // Pass-through: caller receives the original 302 error.
      verify(() => handler.next(err)).called(1);
    });

    test('does NOT fire refresh on a 302 with no Location header', () async {
      var refreshes = 0;
      var reauthCalls = 0;
      final handler = _MockErrorHandler();
      when(() => handler.next(any())).thenAnswer((_) {});
      final interceptor = CfAuthInterceptor(
        dio: Dio(),
        serverId: 'srv-1',
        authReader: (_) async => const AuthMaterial(),
        refreshAuth: (_) async {
          refreshes += 1;
          return null;
        },
        onReauthNeeded: () => reauthCalls += 1,
      );

      final err = buildError(302);
      await interceptor.onError(err, handler);

      expect(refreshes, 0);
      expect(reauthCalls, 0);
      verify(() => handler.next(err)).called(1);
    });
  });

  // ------------------------------------------------------------------
  // onError — silent refresh + replay via dio.fetch
  //
  // Drives the full happy/sad paths against a real Dio with a canned
  // HttpClientAdapter, since dio.fetch is the load-bearing replay
  // primitive that mocked handlers can't exercise.
  // ------------------------------------------------------------------

  group('onError — silent refresh', () {
    test(
      'fires refreshAuth and retries on CF Access 302 redirect '
      '(refresh succeeds -> request succeeds)',
      () async {
        var refreshCalls = 0;
        var reauthCalls = 0;
        final dio = Dio();
        final adapter = _CannedAdapter(
          responder: (options, idx) {
            // First call: CF redirect. Second (the retry): success.
            if (idx == 0) {
              return _redirectBody(
                302,
                'https://joyfulhouse.cloudflareaccess.com/cdn-cgi/access/login/x',
              );
            }
            return _jsonBody(200, {'sessions': <dynamic>[]});
          },
        );
        dio.httpClientAdapter = adapter;

        var authReaderCalls = 0;
        dio.interceptors.add(
          CfAuthInterceptor(
            dio: dio,
            serverId: 'srv-1',
            authReader: (_) async {
              authReaderCalls += 1;
              return const AuthMaterial(apiKey: 'sk-1', cfCookie: 'old-jwt');
            },
            refreshAuth: (_) async {
              refreshCalls += 1;
              return const AuthMaterial(apiKey: 'sk-2', cfCookie: 'new-jwt');
            },
            onReauthNeeded: () => reauthCalls += 1,
          ),
        );

        final response = await dio.get<dynamic>('/api/sessions');

        expect(response.statusCode, 200);
        expect(response.data, {'sessions': <dynamic>[]});
        expect(refreshCalls, 1);
        expect(reauthCalls, 0, reason: 'silent refresh must not trip reauth');
        expect(
          adapter.calls.length,
          2,
          reason: 'one CF redirect + one retry',
        );
        expect(
          authReaderCalls,
          2,
          reason: 'onRequest fires for both the original and the retry',
        );
      },
    );

    test(
      'fires refreshAuth and retries on 401 '
      '(refresh succeeds -> request succeeds)',
      () async {
        var refreshCalls = 0;
        var reauthCalls = 0;
        final dio = Dio();
        final adapter = _CannedAdapter(
          responder: (options, idx) {
            if (idx == 0) {
              return _jsonBody(401, {'error': 'unauthorized'});
            }
            return _jsonBody(200, {'ok': true});
          },
        );
        dio.httpClientAdapter = adapter;
        dio.interceptors.add(
          CfAuthInterceptor(
            dio: dio,
            serverId: 'srv-1',
            authReader: (_) async => const AuthMaterial(apiKey: 'sk-1'),
            refreshAuth: (_) async {
              refreshCalls += 1;
              return const AuthMaterial(apiKey: 'sk-2');
            },
            onReauthNeeded: () => reauthCalls += 1,
          ),
        );

        final response = await dio.get<dynamic>('/api/sessions');

        expect(response.statusCode, 200);
        expect(response.data, {'ok': true});
        expect(refreshCalls, 1);
        expect(reauthCalls, 0);
        expect(adapter.calls.length, 2);
      },
    );

    test('fires onReauthNeeded when refresh returns null (user cancelled)',
        () async {
      var refreshCalls = 0;
      var reauthCalls = 0;
      final dio = Dio();
      final adapter = _CannedAdapter(
        responder: (_, __) => _jsonBody(401, {'error': 'unauthorized'}),
      );
      dio.httpClientAdapter = adapter;
      dio.interceptors.add(
        CfAuthInterceptor(
          dio: dio,
          serverId: 'srv-1',
          authReader: (_) async => const AuthMaterial(apiKey: 'sk-1'),
          refreshAuth: (_) async {
            refreshCalls += 1;
            return null; // user cancelled the browser sheet
          },
          onReauthNeeded: () => reauthCalls += 1,
        ),
      );

      DioException? caught;
      try {
        await dio.get<dynamic>('/api/sessions');
      } on DioException catch (e) {
        caught = e;
      }

      expect(caught, isNotNull);
      expect(refreshCalls, 1);
      expect(reauthCalls, 1, reason: 'fallback to /reauth screen');
      expect(adapter.calls.length, 1, reason: 'no retry attempted');
      expect(caught!.response?.statusCode, 401);
    });

    test('fires onReauthNeeded when refresh throws', () async {
      var refreshCalls = 0;
      var reauthCalls = 0;
      final dio = Dio();
      final adapter = _CannedAdapter(
        responder: (_, __) => _redirectBody(
          302,
          'https://x.cloudflareaccess.com/cdn-cgi/access/login/x',
        ),
      );
      dio.httpClientAdapter = adapter;
      dio.interceptors.add(
        CfAuthInterceptor(
          dio: dio,
          serverId: 'srv-1',
          authReader: (_) async => const AuthMaterial(cfCookie: 'old'),
          refreshAuth: (_) async {
            refreshCalls += 1;
            throw StateError('browser launch failed');
          },
          onReauthNeeded: () => reauthCalls += 1,
        ),
      );

      DioException? caught;
      try {
        await dio.get<dynamic>('/api/sessions');
      } on DioException catch (e) {
        caught = e;
      }

      expect(caught, isNotNull);
      expect(refreshCalls, 1);
      expect(reauthCalls, 1);
      expect(adapter.calls.length, 1, reason: 'no retry attempted');
    });

    test('fires onReauthNeeded when refresh returns empty AuthMaterial',
        () async {
      var refreshCalls = 0;
      var reauthCalls = 0;
      final dio = Dio();
      final adapter = _CannedAdapter(
        responder: (_, __) => _jsonBody(403, {'error': 'forbidden'}),
      );
      dio.httpClientAdapter = adapter;
      dio.interceptors.add(
        CfAuthInterceptor(
          dio: dio,
          serverId: 'srv-1',
          authReader: (_) async => const AuthMaterial(),
          refreshAuth: (_) async {
            refreshCalls += 1;
            // Empty AuthMaterial == as good as null.
            return const AuthMaterial();
          },
          onReauthNeeded: () => reauthCalls += 1,
        ),
      );

      DioException? caught;
      try {
        await dio.get<dynamic>('/api/sessions');
      } on DioException catch (e) {
        caught = e;
      }

      expect(caught, isNotNull);
      expect(refreshCalls, 1);
      expect(reauthCalls, 1);
      expect(adapter.calls.length, 1);
    });

    test(
      'concurrent failed requests share a single refresh call',
      () async {
        var refreshCalls = 0;
        var reauthCalls = 0;
        final refreshStarted = Completer<void>();
        final refreshGate = Completer<AuthMaterial?>();
        final dio = Dio();
        final adapter = _CannedAdapter(
          responder: (options, idx) {
            // First 3 calls (one per concurrent request) get 401.
            // Subsequent calls (the retries after refresh) succeed.
            if (idx < 3) {
              return _jsonBody(401, {'error': 'unauthorized'});
            }
            return _jsonBody(200, {'idx': idx});
          },
        );
        dio.httpClientAdapter = adapter;
        dio.interceptors.add(
          CfAuthInterceptor(
            dio: dio,
            serverId: 'srv-1',
            authReader: (_) async => const AuthMaterial(apiKey: 'sk-old'),
            refreshAuth: (_) async {
              refreshCalls += 1;
              if (!refreshStarted.isCompleted) refreshStarted.complete();
              // Hold the refresh open so all three failures pile up on
              // the same in-flight Completer.
              return refreshGate.future;
            },
            onReauthNeeded: () => reauthCalls += 1,
          ),
        );

        final futures = [
          dio.get<dynamic>('/api/a'),
          dio.get<dynamic>('/api/b'),
          dio.get<dynamic>('/api/c'),
        ];

        // Wait until the first refresh has been triggered, then release
        // the gate so all three queued callers replay their requests.
        await refreshStarted.future;
        refreshGate.complete(const AuthMaterial(apiKey: 'sk-new'));

        final responses = await Future.wait(futures);

        expect(responses.length, 3);
        for (final r in responses) {
          expect(r.statusCode, 200);
        }
        expect(
          refreshCalls,
          1,
          reason: 'all three failures must share one refresh',
        );
        expect(reauthCalls, 0);
        // 3 originals + 3 retries.
        expect(adapter.calls.length, 6);
      },
    );

    test(
      'does NOT retry twice — sentinel guards infinite loop',
      () async {
        var refreshCalls = 0;
        var reauthCalls = 0;
        final dio = Dio();
        // Every call returns a CF redirect, including the retry.
        final adapter = _CannedAdapter(
          responder: (_, __) => _redirectBody(
            302,
            'https://x.cloudflareaccess.com/cdn-cgi/access/login/x',
          ),
        );
        dio.httpClientAdapter = adapter;
        dio.interceptors.add(
          CfAuthInterceptor(
            dio: dio,
            serverId: 'srv-1',
            authReader: (_) async => const AuthMaterial(cfCookie: 'jwt'),
            refreshAuth: (_) async {
              refreshCalls += 1;
              // Refresh succeeds, but the server still rejects.
              return const AuthMaterial(apiKey: 'sk', cfCookie: 'jwt2');
            },
            onReauthNeeded: () => reauthCalls += 1,
          ),
        );

        DioException? caught;
        try {
          await dio.get<dynamic>('/api/sessions');
        } on DioException catch (e) {
          caught = e;
        }

        expect(caught, isNotNull);
        expect(refreshCalls, 1, reason: 'must not refresh twice');
        expect(
          reauthCalls,
          1,
          reason: 'sentinel-guarded retry escalates to /reauth',
        );
        expect(
          adapter.calls.length,
          2,
          reason: 'original + exactly one retry',
        );
      },
    );

    test(
      'allows a fresh refresh on a subsequent unrelated request '
      '(in-flight mutex resets when refresh resolves)',
      () async {
        var refreshCalls = 0;
        final dio = Dio();
        final adapter = _CannedAdapter(
          responder: (options, idx) {
            // Even-indexed calls = 401; odd-indexed calls = 200.
            return idx.isEven
                ? _jsonBody(401, {'error': 'unauthorized'})
                : _jsonBody(200, {'idx': idx});
          },
        );
        dio.httpClientAdapter = adapter;
        dio.interceptors.add(
          CfAuthInterceptor(
            dio: dio,
            serverId: 'srv-1',
            authReader: (_) async => const AuthMaterial(apiKey: 'sk-1'),
            refreshAuth: (_) async {
              refreshCalls += 1;
              return AuthMaterial(apiKey: 'sk-$refreshCalls-fresh');
            },
            onReauthNeeded: () {},
          ),
        );

        // First round: 401 -> refresh -> retry succeeds.
        final r1 = await dio.get<dynamic>('/api/a');
        expect(r1.statusCode, 200);

        // Second round, fresh request: 401 again -> refresh AGAIN
        // (because the in-flight mutex was cleared in finally).
        final r2 = await dio.get<dynamic>('/api/b');
        expect(r2.statusCode, 200);

        expect(refreshCalls, 2);
        // 4 round trips: a (401), a-retry (200), b (401), b-retry (200).
        expect(adapter.calls.length, 4);
      },
    );
  });
}
