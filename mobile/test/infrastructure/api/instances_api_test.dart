import 'dart:convert';
import 'dart:io' show HttpHeaders;
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:remote_dev/application/ports/secure_storage_port.dart';
import 'package:remote_dev/domain/instance_summary.dart';
import 'package:remote_dev/infrastructure/api/instances_api.dart';
import 'package:remote_dev/infrastructure/auth/mobile_credentials.dart';

/// Map-backed [SecureStoragePort] mirroring the real key layout
/// (`server.<namespace>.<key>`) so the host credential namespace (`host.<id>`)
/// resolves exactly as in production — identical to the helper used by
/// `remote_dev_client_workspace_test.dart`.
class _FakeStorage implements SecureStoragePort {
  final Map<String, String?> data = <String, String?>{};

  String _key(String ns, String key) => 'server.$ns.$key';

  @override
  Future<String?> read(String ns, String key) async => data[_key(ns, key)];

  @override
  Future<void> write(String ns, String key, String value) async {
    data[_key(ns, key)] = value;
  }

  @override
  Future<void> delete(String ns, String key) async {
    data.remove(_key(ns, key));
  }

  @override
  Future<void> deleteAll(String ns) async {
    data.removeWhere((k, _) => k.startsWith('server.$ns.'));
  }
}

/// Returns a canned JSON body + status, capturing the outbound request so the
/// test can assert the headers/URL the interceptor produced.
class _CannedAdapter implements HttpClientAdapter {
  _CannedAdapter({required this.body, this.statusCode = 200});

  final String body;
  final int statusCode;
  RequestOptions? captured;

  @override
  void close({bool force = false}) {}

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<dynamic>? cancelFuture,
  ) async {
    captured = options;
    return ResponseBody.fromString(
      body,
      statusCode,
      headers: {
        HttpHeaders.contentTypeHeader: ['application/json'],
      },
    );
  }
}

/// Returns a non-JSON (HTML) 404 page. Used to prove the 404→NotASupervisor
/// mapping is independent of the response body: a plain server's 404 is often
/// an HTML page, not JSON.
class _Html404Adapter implements HttpClientAdapter {
  _Html404Adapter(this.body);

  final String body;

  @override
  void close({bool force = false}) {}

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<dynamic>? cancelFuture,
  ) async {
    return ResponseBody.fromString(
      body,
      404,
      headers: {
        HttpHeaders.contentTypeHeader: ['text/html; charset=utf-8'],
      },
    );
  }
}

/// Simulates a transport failure (timeout / connection-refused) by throwing the
/// kind of [DioException] Dio raises when the socket never completes.
class _ThrowingAdapter implements HttpClientAdapter {
  _ThrowingAdapter(this.type);

  final DioExceptionType type;
  RequestOptions? captured;

  @override
  void close({bool force = false}) {}

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<dynamic>? cancelFuture,
  ) async {
    captured = options;
    throw DioException(requestOptions: options, type: type);
  }
}

InstancesApi _api(
  Dio dio, {
  String origin = 'https://host.example.com',
  String hostId = 'h_1',
  required SecureStoragePort storage,
}) =>
    InstancesApi(
      origin: origin,
      hostId: hostId,
      storage: storage,
      dio: dio,
    );

void main() {
  group('InstancesApi.list', () {
    test('200 parses the instances array into InstanceSummary DTOs '
        '(with displayName→slug fallback)', () async {
      final storage = _FakeStorage();
      await MobileCredentialsStore(storage).setHostCfToken('h_1', 'host-jwt');

      // Realistic supervisor payload: a ready instance with a displayName, and
      // a provisioning one with NO displayName (must fall back to its slug).
      final adapter = _CannedAdapter(
        body: jsonEncode(<String, dynamic>{
          'instances': <Map<String, dynamic>>[
            <String, dynamic>{
              'id': 'i_demo',
              'slug': 'demo',
              'displayName': 'Demo',
              'status': 'ready',
              'namespace': 'rdv-demo',
            },
            <String, dynamic>{
              'id': 'i_wip',
              'slug': 'wip',
              'status': 'provisioning',
              'namespace': 'rdv-wip',
            },
          ],
        }),
      );
      final dio = Dio()..httpClientAdapter = adapter;

      final result = await _api(dio, storage: storage).list();

      expect(result, hasLength(2));
      expect(
        result[0],
        const InstanceSummary(
          slug: 'demo',
          displayName: 'Demo',
          status: 'ready',
        ),
      );
      // displayName absent server-side → defaults to slug.
      expect(
        result[1],
        const InstanceSummary(
          slug: 'wip',
          displayName: 'wip',
          status: 'provisioning',
        ),
      );
    });

    test('sends Cookie: CF_Authorization=<token> and hits '
        '<origin>/api/instances (no basePath)', () async {
      final storage = _FakeStorage();
      await MobileCredentialsStore(storage).setHostCfToken('h_1', 'host-jwt');

      final adapter = _CannedAdapter(
        body: jsonEncode(<String, dynamic>{'instances': <dynamic>[]}),
      );
      final dio = Dio()..httpClientAdapter = adapter;

      await _api(dio, storage: storage).list();

      final sent = adapter.captured;
      expect(sent, isNotNull);
      // Host-wide CF cookie attached; NO Authorization (no API key at host root).
      expect(sent!.headers[HttpHeaders.cookieHeader], 'CF_Authorization=host-jwt');
      expect(sent.headers.containsKey(HttpHeaders.authorizationHeader), isFalse);
      // Host ROOT, no basePath prefix.
      expect(sent.uri.toString(), 'https://host.example.com/api/instances');
    });

    test('an empty instances array parses to an empty list', () async {
      final storage = _FakeStorage();
      await MobileCredentialsStore(storage).setHostCfToken('h_1', 'host-jwt');

      final adapter = _CannedAdapter(
        body: jsonEncode(<String, dynamic>{'instances': <dynamic>[]}),
      );
      final dio = Dio()..httpClientAdapter = adapter;

      expect(await _api(dio, storage: storage).list(), isEmpty);
    });

    test('404 throws NotASupervisorException (NOT a generic error)', () async {
      final storage = _FakeStorage();
      await MobileCredentialsStore(storage).setHostCfToken('h_1', 'host-jwt');

      final adapter = _CannedAdapter(
        body: jsonEncode(<String, dynamic>{'error': 'Not found'}),
        statusCode: 404,
      );
      final dio = Dio()..httpClientAdapter = adapter;

      await expectLater(
        _api(dio, origin: 'https://plain.example.com', storage: storage).list(),
        throwsA(
          isA<NotASupervisorException>().having(
            (e) => e.origin,
            'origin',
            'https://plain.example.com',
          ),
        ),
      );
    });

    test('a non-JSON (HTML) 404 ALSO throws NotASupervisorException '
        '(body/content-type is irrelevant to the 404 mapping)', () async {
      final storage = _FakeStorage();
      await MobileCredentialsStore(storage).setHostCfToken('h_1', 'host-jwt');

      // A plain Remote Dev server typically answers an unknown route with an
      // HTML 404 page, not a JSON body. It must still map to "not a supervisor"
      // rather than blowing up as a parse error.
      final dio = Dio()
        ..httpClientAdapter =
            _Html404Adapter('<!doctype html><title>404</title>Not Found');

      await expectLater(
        _api(dio, origin: 'https://plain.example.com', storage: storage).list(),
        throwsA(
          isA<NotASupervisorException>().having(
            (e) => e.origin,
            'origin',
            'https://plain.example.com',
          ),
        ),
      );
    });

    test('a connection timeout surfaces as a normal DioException '
        '(distinct from not-a-supervisor)', () async {
      final storage = _FakeStorage();
      await MobileCredentialsStore(storage).setHostCfToken('h_1', 'host-jwt');

      final dio = Dio()
        ..httpClientAdapter =
            _ThrowingAdapter(DioExceptionType.connectionTimeout);

      await expectLater(
        _api(dio, storage: storage).list(),
        throwsA(
          isA<DioException>()
              .having((e) => e.type, 'type', DioExceptionType.connectionTimeout),
        ),
      );
    });

    test('a connection error (refused) surfaces as a normal DioException, '
        'NOT NotASupervisorException', () async {
      final storage = _FakeStorage();
      await MobileCredentialsStore(storage).setHostCfToken('h_1', 'host-jwt');

      final dio = Dio()
        ..httpClientAdapter =
            _ThrowingAdapter(DioExceptionType.connectionError);

      await expectLater(
        _api(dio, storage: storage).list(),
        throwsA(
          isA<DioException>()
              .having((e) => e.type, 'type', DioExceptionType.connectionError),
        ),
      );
    });
  });
}
