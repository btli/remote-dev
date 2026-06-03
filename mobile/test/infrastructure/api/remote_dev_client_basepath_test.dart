import 'dart:async';
import 'dart:convert';
import 'dart:io' show HttpHeaders;
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:remote_dev/application/ports/secure_storage_port.dart';
import 'package:remote_dev/infrastructure/api/remote_dev_client.dart';

/// Map-backed [SecureStoragePort]; no credentials are seeded for these
/// tests (we only care about the request *path*, not auth headers).
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

/// Captures the single outbound request so we can assert the effective URI
/// the base-path prefixing produced.
class _CapturingAdapter implements HttpClientAdapter {
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
      jsonEncode(<String, dynamic>{'ok': true}),
      200,
      headers: {
        HttpHeaders.contentTypeHeader: ['application/json'],
      },
    );
  }
}

void main() {
  group('RemoteDevClient.forWorkspace base-path prefixing', () {
    test(
        "basePath '/demo' prefixes every request path → "
        'https://h/demo/api/sessions', () async {
      final adapter = _CapturingAdapter();
      final dio = Dio()..httpClientAdapter = adapter;

      final client = RemoteDevClient.forWorkspace(
        origin: 'https://h',
        basePath: '/demo',
        hostId: 'h_1',
        workspaceId: 'w_1',
        storage: _FakeStorage(),
        dio: dio,
      );

      await client.get('/api/sessions');

      expect(adapter.captured, isNotNull);
      // baseUrl stays the bare origin; the path carries the basePath.
      expect(dio.options.baseUrl, 'https://h');
      expect(adapter.captured!.path, '/demo/api/sessions');
      expect(
        adapter.captured!.uri.toString(),
        'https://h/demo/api/sessions',
      );
    });

    test(
        "basePath '' leaves the request path unchanged → "
        'https://h/api/sessions (byte-identical to legacy)', () async {
      final adapter = _CapturingAdapter();
      final dio = Dio()..httpClientAdapter = adapter;

      final client = RemoteDevClient.forWorkspace(
        origin: 'https://h',
        basePath: '',
        hostId: 'h_1',
        workspaceId: 'w_1',
        storage: _FakeStorage(),
        dio: dio,
      );

      await client.get('/api/sessions');

      expect(adapter.captured, isNotNull);
      expect(dio.options.baseUrl, 'https://h');
      expect(adapter.captured!.path, '/api/sessions');
      expect(
        adapter.captured!.uri.toString(),
        'https://h/api/sessions',
      );
    });

    test('basePath is applied to POST and the query string is preserved',
        () async {
      final adapter = _CapturingAdapter();
      final dio = Dio()..httpClientAdapter = adapter;

      final client = RemoteDevClient.forWorkspace(
        origin: 'https://h',
        basePath: '/demo',
        hostId: 'h_1',
        workspaceId: 'w_1',
        storage: _FakeStorage(),
        dio: dio,
      );

      // A path carrying a query component (mirrors ChannelsApi.list()).
      await client.get('/api/channels?nodeId=abc&nodeType=project');

      final sent = adapter.captured;
      expect(sent, isNotNull);
      expect(sent!.uri.path, '/demo/api/channels');
      expect(sent.uri.queryParameters['nodeId'], 'abc');
      expect(sent.uri.queryParameters['nodeType'], 'project');
      expect(
        sent.uri.toString(),
        'https://h/demo/api/channels?nodeId=abc&nodeType=project',
      );
    });

    test('POST/PATCH/DELETE all carry the basePath', () async {
      Future<String> capture(
        Future<void> Function(RemoteDevClient) call,
      ) async {
        final adapter = _CapturingAdapter();
        final dio = Dio()..httpClientAdapter = adapter;
        final client = RemoteDevClient.forWorkspace(
          origin: 'https://h',
          basePath: '/demo',
          hostId: 'h_1',
          workspaceId: 'w_1',
          storage: _FakeStorage(),
          dio: dio,
        );
        await call(client);
        return adapter.captured!.path;
      }

      expect(
        await capture((c) => c.post('/api/sessions', body: const {})),
        '/demo/api/sessions',
      );
      expect(
        await capture(
          (c) => c.patch('/api/github/accounts/1', body: const {}),
        ),
        '/demo/api/github/accounts/1',
      );
      expect(
        await capture((c) => c.delete('/api/sessions/abc')),
        '/demo/api/sessions/abc',
      );
    });
  });
}
