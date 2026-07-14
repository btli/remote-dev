import 'dart:async';
import 'dart:convert';
import 'dart:io' show HttpHeaders;
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:remote_dev/application/add_host_flow_controller.dart';
import 'package:remote_dev/application/ports/secure_storage_port.dart';
import 'package:remote_dev/domain/host_config.dart';
import 'package:remote_dev/domain/instance_summary.dart';
import 'package:remote_dev/domain/workspace_config.dart';
import 'package:remote_dev/infrastructure/api/instances_api.dart';
import 'package:remote_dev/infrastructure/auth/mobile_credentials.dart';
import 'package:remote_dev/infrastructure/auth/pending_add_host_login.dart';
import 'package:remote_dev/infrastructure/deep_link/add_host_login_completer.dart';
import 'package:remote_dev/infrastructure/storage/host_workspace_store_impl.dart';

class _FakeStorage implements SecureStoragePort {
  final Map<String, String?> data = <String, String?>{};

  /// When true, [write] throws — used to simulate an UNEXPECTED failure inside
  /// completion (e.g. a store write error), which surfaces the completer's
  /// onUnexpectedError path (distinct from the modelled AddHostDetectFailed).
  bool throwOnWrite = false;

  String _key(String ns, String key) => 'server.$ns.$key';
  @override
  Future<String?> read(String ns, String key) async => data[_key(ns, key)];
  @override
  Future<void> write(String ns, String key, String value) async {
    if (throwOnWrite) throw StateError('write failed');
    data[_key(ns, key)] = value;
  }

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

/// A `remotedev://auth/callback` URI for a single instance (scope=instance).
Uri _instanceCallback({required String state, String apiKey = 'sk-single'}) {
  return Uri.parse(
    'remotedev://auth/callback?scope=instance&apiKey=$apiKey'
    '&cfToken=identity-jwt&userId=u1&email=a%40b.com&state=$state',
  );
}

Uri _hostCallback({required String state}) {
  return Uri.parse(
    'remotedev://auth/callback?scope=host&cfToken=host-jwt'
    '&userId=u1&email=a%40b.com&state=$state',
  );
}

void main() {
  late _FakeStorage storage;
  late HostWorkspaceStoreImpl store;
  late MobileCredentialsStore creds;
  late PendingAddHostLoginStore pending;
  var idCounter = 0;

  // Navigation capture.
  WorkspaceConfig? navigatedSingle;
  var navigatedSingleCount = 0;
  HostConfig? navigatedSupervisorHost;
  List<InstanceSummary>? navigatedSupervisorInstances;
  HostConfig? detectFailedHost;
  Object? unexpectedError;
  var unexpectedErrorCount = 0;

  AddHostLoginCompleter build(
    HttpClientAdapter adapter, {
    Future<Uri?> Function()? initialLink,
    Stream<Uri>? stream,
  }) {
    idCounter = 0;
    final controller = AddHostFlowController(
      store: store,
      credentials: creds,
      instancesApiFactory: (host) => InstancesApi(
        origin: host.origin,
        hostId: host.id,
        storage: _FakeStorage(),
        dio: Dio()..httpClientAdapter = adapter,
      ),
      idGenerator: () => 'id-${++idCounter}',
      clock: () => DateTime(2026, 6, 1),
    );
    return AddHostLoginCompleter(
      linkStream: stream ?? const Stream<Uri>.empty(),
      pendingStore: pending,
      controller: controller,
      initialLink: initialLink,
      onSingleWorkspaceActivated: (ws) {
        navigatedSingle = ws;
        navigatedSingleCount += 1;
      },
      onSupervisorDetected: (host, instances) {
        navigatedSupervisorHost = host;
        navigatedSupervisorInstances = instances;
      },
      onDetectFailed: (host, _) => detectFailedHost = host,
      onUnexpectedError: (e) {
        unexpectedError = e;
        unexpectedErrorCount += 1;
      },
    );
  }

  Future<void> savePending(String state) => pending.save(
        PendingAddHostLogin(
          origin: 'https://dev.example.com',
          label: 'Work',
          state: state,
          createdAtMs: DateTime(2026, 6, 1).millisecondsSinceEpoch,
        ),
      );

  setUp(() {
    storage = _FakeStorage();
    store = HostWorkspaceStoreImpl(storage);
    creds = MobileCredentialsStore(storage);
    pending = PendingAddHostLoginStore(storage, clock: () => DateTime(2026, 6, 1));
    navigatedSingle = null;
    navigatedSingleCount = 0;
    navigatedSupervisorHost = null;
    navigatedSupervisorInstances = null;
    detectFailedHost = null;
    unexpectedError = null;
    unexpectedErrorCount = 0;
  });

  test(
    'matching-state single-instance callback completes with NO screen alive: '
    'host persisted, workspace activated, navigates single → /home',
    () async {
      await savePending('nonce-A');
      final completer = build(
        _CannedAdapter(
          body: jsonEncode(<String, dynamic>{'error': 'Not found'}),
          statusCode: 404,
        ),
      );

      // Directly drive the callback — there is NO AddHostScreen at all, proving
      // completion does not depend on the screen surviving.
      await completer.handleLink(_instanceCallback(state: 'nonce-A'));

      // Navigated to the single-workspace session.
      expect(navigatedSingle, isNotNull);
      expect(navigatedSupervisorHost, isNull);

      // Host + workspace persisted and active.
      final hosts = await store.loadHosts();
      expect(hosts.single.origin, 'https://dev.example.com');
      expect(hosts.single.kind, HostKind.singleWorkspace);
      final active = await store.loadActiveWorkspace();
      expect(active!.id, navigatedSingle!.id);
      expect(await creds.getWorkspaceApiKey(navigatedSingle!.id), 'sk-single');

      // Pending record consumed.
      expect(await pending.read(), isNull);
    },
  );

  test(
    'state MISMATCH is ignored: no navigation, no host persisted, pending KEPT',
    () async {
      await savePending('nonce-A');
      final completer = build(
        _CannedAdapter(body: '{"error":"x"}', statusCode: 404),
      );

      await completer.handleLink(_instanceCallback(state: 'WRONG'));

      expect(navigatedSingle, isNull);
      expect(await store.loadHosts(), isEmpty);
      // The genuine callback can still arrive → record must remain.
      expect(await pending.read(), isNotNull);
    },
  );

  test(
    'no pending record: callback is ignored (belongs to another flow)',
    () async {
      // No savePending().
      final completer = build(
        _CannedAdapter(body: '{"error":"x"}', statusCode: 404),
      );

      await completer.handleLink(_instanceCallback(state: 'nonce-A'));

      expect(navigatedSingle, isNull);
      expect(navigatedSupervisorHost, isNull);
      expect(await store.loadHosts(), isEmpty);
    },
  );

  test('non-callback URI is ignored', () async {
    await savePending('nonce-A');
    final completer = build(
      _CannedAdapter(body: '{"error":"x"}', statusCode: 404),
    );

    await completer.handleLink(Uri.parse('remotedev://session/abc'));

    expect(navigatedSingle, isNull);
    expect(await pending.read(), isNotNull);
  });

  test(
    'matching-state supervisor callback (200) → multiWorkspace, navigates picker',
    () async {
      await savePending('nonce-B');
      final completer = build(
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

      await completer.handleLink(_hostCallback(state: 'nonce-B'));

      expect(navigatedSupervisorHost, isNotNull);
      expect(navigatedSupervisorHost!.kind, HostKind.multiWorkspace);
      expect(navigatedSupervisorInstances!.single.slug, 'demo');
      expect(navigatedSingle, isNull);
      expect(await pending.read(), isNull);
    },
  );

  test(
    'detect failure → onDetectFailed fired, host kept, pending cleared',
    () async {
      await savePending('nonce-C');
      final completer = build(
        // A 200 with a non-JSON/invalid body would parse-fail; instead simulate
        // a transient error via a throwing adapter.
        _ThrowingAdapter(),
      );

      await completer.handleLink(_instanceCallback(state: 'nonce-C'));

      expect(detectFailedHost, isNotNull);
      expect(navigatedSingle, isNull);
      expect((await store.loadHosts()).single.origin, 'https://dev.example.com');
      expect(await pending.read(), isNull);
    },
  );

  test(
    'cold-start: a matching initialLink callback completes at start()',
    () async {
      await savePending('nonce-D');
      final completer = build(
        _CannedAdapter(body: '{"error":"x"}', statusCode: 404),
        initialLink: () async => _instanceCallback(state: 'nonce-D'),
      );

      completer.start();
      // Let the initial-link future + async completion (pending read → Dio
      // detect → activate) fully drain.
      await Future<void>.delayed(const Duration(milliseconds: 50));

      expect(navigatedSingle, isNotNull);
      expect((await store.loadHosts()).single.origin, 'https://dev.example.com');
      await completer.stop();
    },
  );

  test(
    'same-tick DOUBLE delivery completes EXACTLY once (re-entrancy guard)',
    () async {
      await savePending('nonce-DUP');
      final completer = build(
        _CannedAdapter(
          body: jsonEncode(<String, dynamic>{'error': 'Not found'}),
          statusCode: 404,
        ),
      );

      final uri = _instanceCallback(state: 'nonce-DUP');
      // Mimic the live subscription's `unawaited(handleLink(uri))`: fire BOTH in
      // the same tick without awaiting the first, so the second is not ordered
      // after the first's async work.
      final f1 = completer.handleLink(uri);
      final f2 = completer.handleLink(uri);
      await Future.wait([f1, f2]);

      // Completed once: one navigation, one host, one workspace.
      expect(navigatedSingleCount, 1);
      expect((await store.loadHosts()).length, 1);
      expect((await store.loadWorkspaces()).length, 1);
      // Pending consumed exactly once.
      expect(await pending.read(), isNull);
    },
  );

  test(
    'unexpected completion throw → onUnexpectedError fired (user not stranded), '
    'pending already cleared, guard released',
    () async {
      await savePending('nonce-THROW');
      final completer = build(
        _CannedAdapter(body: '{"error":"x"}', statusCode: 404),
      );
      // Make the host upsert (before the detect try/catch) throw — an UNEXPECTED
      // failure that propagates OUT of completeFromCallback (not the modelled
      // AddHostDetectFailed).
      storage.throwOnWrite = true;

      await completer.handleLink(_instanceCallback(state: 'nonce-THROW'));

      expect(unexpectedErrorCount, 1);
      expect(unexpectedError, isNotNull);
      expect(navigatedSingle, isNull);
      expect(navigatedSupervisorHost, isNull);
      // Pending was cleared before the throwing completion ran.
      expect(await pending.read(), isNull);

      // The guard was RELEASED despite the throw: a second matching callback on
      // the SAME completer re-enters (and, still failing, fires again).
      storage.throwOnWrite = false;
      await savePending('nonce-AFTER');
      storage.throwOnWrite = true;
      await completer.handleLink(_instanceCallback(state: 'nonce-AFTER'));
      expect(unexpectedErrorCount, 2);
    },
  );

  test(
    'warm-start via the live stream subscription completes a matching callback',
    () async {
      await savePending('nonce-E');
      final controllerStream = StreamController<Uri>.broadcast();
      final completer = build(
        _CannedAdapter(body: '{"error":"x"}', statusCode: 404),
        stream: controllerStream.stream,
      );
      completer.start();

      controllerStream.add(_instanceCallback(state: 'nonce-E'));
      await Future<void>.delayed(const Duration(milliseconds: 50));

      expect(navigatedSingle, isNotNull);
      await completer.stop();
      await controllerStream.close();
    },
  );
}

class _ThrowingAdapter implements HttpClientAdapter {
  @override
  void close({bool force = false}) {}
  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<dynamic>? cancelFuture,
  ) async =>
      throw DioException(
        requestOptions: options,
        type: DioExceptionType.connectionTimeout,
      );
}
