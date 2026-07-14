import 'dart:convert';
import 'dart:io' show HttpHeaders;
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:remote_dev/application/add_host_flow_controller.dart';
import 'package:remote_dev/application/ports/secure_storage_port.dart';
import 'package:remote_dev/domain/host_config.dart';
import 'package:remote_dev/infrastructure/api/instances_api.dart';
import 'package:remote_dev/infrastructure/auth/mobile_callback_login_launcher.dart';
import 'package:remote_dev/infrastructure/auth/mobile_credentials.dart';
import 'package:remote_dev/infrastructure/storage/host_workspace_store_impl.dart';

class _FakeStorage implements SecureStoragePort {
  final Map<String, String?> data = <String, String?>{};
  String _key(String ns, String key) => 'server.$ns.$key';
  @override
  Future<String?> read(String ns, String key) async => data[_key(ns, key)];
  @override
  Future<void> write(String ns, String key, String value) async =>
      data[_key(ns, key)] = value;
  @override
  Future<void> delete(String ns, String key) async =>
      data.remove(_key(ns, key));
  @override
  Future<void> deleteAll(String ns) async =>
      data.removeWhere((k, _) => k.startsWith('server.$ns.'));
}

class _CannedAdapter implements HttpClientAdapter {
  _CannedAdapter({required this.body, this.statusCode = 200});
  final String body;
  final int statusCode;
  @override
  void close({bool force = false}) {}
  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<dynamic>? cancelFuture,
  ) async =>
      ResponseBody.fromString(
        body,
        statusCode,
        headers: {
          HttpHeaders.contentTypeHeader: ['application/json'],
        },
      );
}

class _ThrowingAdapter implements HttpClientAdapter {
  _ThrowingAdapter(this.type);
  final DioExceptionType type;
  @override
  void close({bool force = false}) {}
  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<dynamic>? cancelFuture,
  ) async =>
      throw DioException(requestOptions: options, type: type);
}

InstancesApi _api(HostConfig host, HttpClientAdapter adapter) {
  final dio = Dio()..httpClientAdapter = adapter;
  return InstancesApi(
    origin: host.origin,
    hostId: host.id,
    storage: _FakeStorage(),
    dio: dio,
  );
}

InstanceCallback _instanceCb({
  String apiKey = 'sk-single',
  String cfToken = 'identity-jwt',
}) =>
    InstanceCallback(
      apiKey: apiKey,
      cfToken: cfToken,
      userId: 'u1',
      email: 'a@b.com',
      authCookies: const [],
    );

void main() {
  late _FakeStorage storage;
  late HostWorkspaceStoreImpl store;
  late MobileCredentialsStore creds;
  var idCounter = 0;

  AddHostFlowController controller(HttpClientAdapter adapter) {
    idCounter = 0;
    return AddHostFlowController(
      store: store,
      credentials: creds,
      instancesApiFactory: (host) => _api(host, adapter),
      idGenerator: () => 'id-${++idCounter}',
      clock: () => DateTime(2026, 6, 1),
    );
  }

  setUp(() {
    storage = _FakeStorage();
    store = HostWorkspaceStoreImpl(storage);
    creds = MobileCredentialsStore(storage);
  });

  test(
    'single instance (404 → NotASupervisor): host persisted single, workspace '
    'activated from the callback, creds persisted, outcome = SingleActivated',
    () async {
      final c = controller(
        _CannedAdapter(
          body: jsonEncode(<String, dynamic>{'error': 'Not found'}),
          statusCode: 404,
        ),
      );

      final outcome = await c.completeFromCallback(
        origin: 'https://dev.example.com',
        label: 'Work',
        callback: _instanceCb(apiKey: 'sk-single', cfToken: 'fresh-jwt'),
      );

      expect(outcome, isA<AddHostSingleWorkspaceActivated>());
      final single = outcome as AddHostSingleWorkspaceActivated;
      expect(single.host.kind, HostKind.singleWorkspace);
      expect(single.host.origin, 'https://dev.example.com');
      expect(single.workspace.slug, '');
      expect(single.workspace.basePath, '');

      // Persisted + active.
      final hosts = await store.loadHosts();
      expect(hosts.single.kind, HostKind.singleWorkspace);
      final active = await store.loadActiveWorkspace();
      expect(active!.id, single.workspace.id);

      // Credentials from the callback.
      expect(await creds.getWorkspaceApiKey(single.workspace.id), 'sk-single');
      expect(await creds.getHostCfToken(single.host.id), 'fresh-jwt');
    },
  );

  test(
    'supervisor (200): host upgraded to multiWorkspace, outcome = Supervisor '
    'with the parsed instances; nothing activated',
    () async {
      final c = controller(
        _CannedAdapter(
          body: jsonEncode(<String, dynamic>{
            'instances': <Map<String, dynamic>>[
              <String, dynamic>{
                'slug': 'demo',
                'displayName': 'Demo',
                'status': 'ready',
              },
            ],
          }),
        ),
      );

      final outcome = await c.completeFromCallback(
        origin: 'https://sup.example.com',
        label: 'Cluster',
        callback: HostCallback(
          cfToken: 'host-jwt',
          email: 'a@b.com',
          userId: 'u1',
          authCookies: const [],
        ),
      );

      expect(outcome, isA<AddHostSupervisorDetected>());
      final sup = outcome as AddHostSupervisorDetected;
      expect(sup.host.kind, HostKind.multiWorkspace);
      expect(sup.instances.single.slug, 'demo');

      expect((await store.loadHosts()).single.kind, HostKind.multiWorkspace);
      expect(await store.loadWorkspaces(), isEmpty);
      expect(await store.loadActiveWorkspace(), isNull);
    },
  );

  test(
    'detect network error: host kept, nothing activated, outcome = DetectFailed',
    () async {
      final c = controller(_ThrowingAdapter(DioExceptionType.connectionTimeout));

      final outcome = await c.completeFromCallback(
        origin: 'https://dev.example.com',
        label: 'Work',
        callback: _instanceCb(),
      );

      expect(outcome, isA<AddHostDetectFailed>());
      // Host row + host CF token kept; no workspace activated.
      expect((await store.loadHosts()).single.origin, 'https://dev.example.com');
      expect(await creds.getHostCfToken((outcome as AddHostDetectFailed).host.id),
          'identity-jwt');
      expect(await store.loadWorkspaces(), isEmpty);
      expect(await store.loadActiveWorkspace(), isNull);
    },
  );
}
