import 'dart:async';
import 'dart:convert';
import 'dart:io' show HttpHeaders;
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:remote_dev/application/ports/secure_storage_port.dart';
import 'package:remote_dev/application/state/active_connection.dart';
import 'package:remote_dev/domain/host_config.dart';
import 'package:remote_dev/domain/server_config.dart';
import 'package:remote_dev/domain/workspace_config.dart';
import 'package:remote_dev/infrastructure/api/remote_dev_client.dart';
import 'package:remote_dev/infrastructure/auth/mobile_credentials.dart';
import 'package:remote_dev/presentation/screens/webview_host/session_route_host.dart'
    show activeServerProvider, activeWorkspaceProvider;

/// Map-backed [SecureStoragePort] mirroring the real key layout
/// (`server.<namespace>.<key>`), so host/workspace credential namespaces
/// (`host.<id>` / `workspace.<id>`) resolve exactly as in production.
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

/// Captures the single outbound request so we can assert the headers the
/// interceptor attached.
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
  group('RemoteDevClient.forWorkspace credential sourcing', () {
    test(
        'reads workspace API key + host CF token via the host/workspace '
        'methods and attaches Bearer + CF_Authorization cookie', () async {
      final storage = _FakeStorage();
      final creds = MobileCredentialsStore(storage);
      // Seed the NEW namespaces only (no legacy per-server keys exist).
      await creds.setHostCfToken('h_1', 'host-jwt');
      await creds.setWorkspaceApiKey('w_1', 'sk-workspace');

      final adapter = _CapturingAdapter();
      final dio = Dio()..httpClientAdapter = adapter;

      final client = RemoteDevClient.forWorkspace(
        origin: 'https://dev.example.com',
        basePath: '',
        hostId: 'h_1',
        workspaceId: 'w_1',
        storage: storage,
        dio: dio,
      );

      await client.get('/api/sessions');

      final sent = adapter.captured;
      expect(sent, isNotNull);
      // API key comes from the WORKSPACE namespace.
      expect(
        sent!.headers[HttpHeaders.authorizationHeader],
        'Bearer sk-workspace',
      );
      // CF token comes from the HOST namespace.
      expect(
        sent.headers[HttpHeaders.cookieHeader],
        'CF_Authorization=host-jwt',
      );
    });

    test(
        'sends NO auth headers when neither host nor workspace credentials '
        'are stored (fresh install)', () async {
      final storage = _FakeStorage();
      final adapter = _CapturingAdapter();
      final dio = Dio()..httpClientAdapter = adapter;

      final client = RemoteDevClient.forWorkspace(
        origin: 'https://dev.example.com',
        basePath: '',
        hostId: 'h_missing',
        workspaceId: 'w_missing',
        storage: storage,
        dio: dio,
      );

      await client.get('/api/sessions');

      final sent = adapter.captured;
      expect(sent, isNotNull);
      expect(sent!.headers.containsKey(HttpHeaders.authorizationHeader), isFalse);
      expect(sent.headers.containsKey(HttpHeaders.cookieHeader), isFalse);
    });

    test(
        'baseUrl is the bare origin for a migrated single-workspace config '
        '(basePath is stored but not yet applied to request paths — Task B)',
        () async {
      final storage = _FakeStorage();
      final adapter = _CapturingAdapter();
      final dio = Dio()..httpClientAdapter = adapter;

      final client = RemoteDevClient.forWorkspace(
        origin: 'https://dev.example.com',
        basePath: '',
        hostId: 'h_1',
        workspaceId: 'w_1',
        storage: storage,
        dio: dio,
      );
      expect(client.basePath, '');

      await client.get('/api/sessions');
      // Effective request URI == origin + path, unchanged from the legacy
      // client (no base-path prefixing yet).
      expect(
        adapter.captured!.uri.toString(),
        'https://dev.example.com/api/sessions',
      );
    });
  });

  group('activeServerProvider shim derives from activeWorkspaceProvider', () {
    ActiveConnection conn({
      String origin = 'https://dev.example.com',
      String basePath = '',
      String displayName = 'Work',
      String workspaceId = 'w_1',
    }) {
      final now = DateTime.utc(2026, 5, 1);
      return ActiveConnection(
        host: HostConfig(
          id: 'h_1',
          label: 'Host Label',
          origin: origin,
          kind: HostKind.singleWorkspace,
          createdAt: now,
          lastUsedAt: now,
        ),
        workspace: WorkspaceConfig(
          id: workspaceId,
          hostId: 'h_1',
          slug: basePath.isEmpty ? '' : basePath.substring(1),
          basePath: basePath,
          displayName: displayName,
          lastUsedAt: now,
        ),
      );
    }

    test('maps id/label/url/lastUsedAt for a single-workspace config',
        () async {
      final container = ProviderContainer(
        overrides: [
          activeWorkspaceProvider.overrideWith((ref) async => conn()),
        ],
      );
      addTearDown(container.dispose);

      final server = await container.read(activeServerProvider.future);
      expect(server, isNotNull);
      expect(server!.id, 'w_1'); // workspace id, NOT host id
      expect(server.label, 'Work'); // workspace.displayName
      // url == host.origin + workspace.basePath; basePath '' → bare origin.
      expect(server.url, 'https://dev.example.com');
      expect(server.lastUsedAt, DateTime.utc(2026, 5, 1));
    });

    test('joins host origin + non-empty basePath into the shim url',
        () async {
      final container = ProviderContainer(
        overrides: [
          activeWorkspaceProvider.overrideWith(
            (ref) async => conn(
              origin: 'https://h2',
              basePath: '/demo',
              displayName: 'Demo',
              workspaceId: 'w_demo',
            ),
          ),
        ],
      );
      addTearDown(container.dispose);

      final server = await container.read(activeServerProvider.future);
      expect(server, isA<ServerConfig>());
      expect(server!.url, 'https://h2/demo');
      expect(server.id, 'w_demo');
      expect(server.label, 'Demo');
    });

    test('resolves to null when there is no active connection', () async {
      final container = ProviderContainer(
        overrides: [
          activeWorkspaceProvider.overrideWith((ref) async => null),
        ],
      );
      addTearDown(container.dispose);

      expect(await container.read(activeServerProvider.future), isNull);
    });
  });
}
