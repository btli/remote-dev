import 'dart:async';
import 'dart:convert';
import 'dart:io' show HttpHeaders;
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:remote_dev/application/ports/secure_storage_port.dart';
import 'package:remote_dev/domain/host_config.dart';
import 'package:remote_dev/domain/instance_summary.dart';
import 'package:remote_dev/domain/workspace_config.dart';
import 'package:remote_dev/infrastructure/api/instances_api.dart';
import 'package:remote_dev/infrastructure/auth/mobile_callback_login_launcher.dart';
import 'package:remote_dev/infrastructure/auth/mobile_credentials.dart';
import 'package:remote_dev/infrastructure/storage/host_workspace_store_impl.dart';
import 'package:remote_dev/presentation/screens/host_picker/add_host_screen.dart';
import 'package:remote_dev/presentation/screens/webview_host/session_route_host.dart'
    show
        hostWorkspaceStoreProvider,
        mobileCredentialsStoreProvider,
        secureStorageProvider;

/// Map-backed [SecureStoragePort] mirroring the production key layout
/// (`server.<namespace>.<key>`) so the `__meta__` / `host.<id>` /
/// `workspace.<id>` namespaces resolve exactly as in production.
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

/// Canned-response adapter so the [InstancesApi] returned by the factory seam
/// produces a deterministic `list()` result without real network.
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
  ) async {
    return ResponseBody.fromString(
      body,
      statusCode,
      headers: {
        HttpHeaders.contentTypeHeader: ['application/json'],
      },
    );
  }
}

/// Adapter that throws a transport-style [DioException] (no `response`), the
/// retryable network error class — distinct from a 404 (NotASupervisor).
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
  ) async {
    throw DioException(requestOptions: options, type: type);
  }
}

InstancesApi _apiWithAdapter(HostConfig host, HttpClientAdapter adapter) {
  final dio = Dio()..httpClientAdapter = adapter;
  // The storage here is unused for canned/throwing adapters (the interceptor's
  // cookie read just resolves to null) but the ctor requires one.
  return InstancesApi(
    origin: host.origin,
    hostId: host.id,
    storage: _FakeStorage(),
    dio: dio,
  );
}

void main() {
  Future<({_FakeStorage storage, HostWorkspaceStoreImpl store})> pumpAddHost(
    WidgetTester tester, {
    required HostLoginLauncher hostLogin,
    InstanceLoginLauncher? instanceLogin,
    required InstancesApiFactory apiFactory,
    void Function(WorkspaceConfig)? onSingleActivated,
    void Function(HostConfig, List<InstanceSummary>)? onSupervisor,
  }) async {
    final storage = _FakeStorage();
    final store = HostWorkspaceStoreImpl(storage);
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          secureStorageProvider.overrideWith((_) => throw UnimplementedError()),
          hostWorkspaceStoreProvider.overrideWithValue(store),
          mobileCredentialsStoreProvider
              .overrideWithValue(MobileCredentialsStore(storage)),
        ],
        child: MaterialApp(
          home: AddHostScreen(
            onSingleWorkspaceActivated: onSingleActivated ?? (_) {},
            onSupervisorDetected: onSupervisor ?? (_, __) {},
            hostLoginLauncher: hostLogin,
            instanceLoginLauncher: instanceLogin,
            instancesApiFactory: apiFactory,
          ),
        ),
      ),
    );
    return (storage: storage, store: store);
  }

  Future<void> fillAndSubmit(
    WidgetTester tester, {
    String origin = 'https://dev.example.com',
    String label = 'Work',
  }) async {
    await tester.enterText(
      find.widgetWithText(TextFormField, 'Host URL'),
      origin,
    );
    await tester.enterText(
      find.widgetWithText(TextFormField, 'Label'),
      label,
    );
    await tester.tap(find.widgetWithText(ElevatedButton, 'Add'));
    await tester.pumpAndSettle();
  }

  testWidgets(
    'multi path: loginHost ok + instances returned → host persisted as '
    'multiWorkspace and onSupervisorDetected fires',
    (tester) async {
      HostConfig? detectedHost;
      List<InstanceSummary>? detectedInstances;

      final ctx = await pumpAddHost(
        tester,
        hostLogin: (origin) async => HostCallback(
          cfToken: 'host-jwt',
          email: 'a@b.com',
          userId: 'u1',
        ),
        apiFactory: (host) => _apiWithAdapter(
          host,
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
        ),
        onSupervisor: (host, instances) {
          detectedHost = host;
          detectedInstances = instances;
        },
      );

      await fillAndSubmit(tester);

      // onSupervisorDetected fired with the upgraded host + instances.
      expect(detectedHost, isNotNull);
      expect(detectedHost!.kind, HostKind.multiWorkspace);
      expect(detectedHost!.origin, 'https://dev.example.com');
      expect(detectedInstances, isNotNull);
      expect(detectedInstances!.single.slug, 'demo');

      // Host persisted as multiWorkspace; CF token stored host-wide.
      final hosts = await ctx.store.loadHosts();
      expect(hosts.single.kind, HostKind.multiWorkspace);
      expect(
        await MobileCredentialsStore(ctx.storage)
            .getHostCfToken(hosts.single.id),
        'host-jwt',
      );

      // No workspace persisted and nothing activated on the multi path.
      expect(await ctx.store.loadWorkspaces(), isEmpty);
      expect(await ctx.store.loadActiveWorkspace(), isNull);
    },
  );

  testWidgets(
    'single path: 404 (NotASupervisor) + login mints creds → workspace '
    'persisted (basePath empty), activated, onSingleWorkspaceActivated fires',
    (tester) async {
      WorkspaceConfig? activated;

      final ctx = await pumpAddHost(
        tester,
        hostLogin: (origin) async => HostCallback(
          cfToken: 'host-jwt',
          email: 'a@b.com',
          userId: 'u1',
        ),
        instanceLogin: (serverUrl) async => const MobileCredentials(
          apiKey: 'sk-single',
          cfToken: 'fresh-host-jwt',
          userId: 'u1',
          email: 'a@b.com',
        ),
        apiFactory: (host) => _apiWithAdapter(
          host,
          // ANY 404 → InstancesApi maps it to NotASupervisorException,
          // independent of the body. The body here is incidental: a 404 is a
          // definitive "no discovery here" regardless of whether it carries a
          // JSON `{error}`, an HTML page, or nothing. (dio only attempts JSON
          // decoding when the response Content-Type is JSON, so a non-JSON 404
          // does NOT surface as a parse error — it still maps to
          // NotASupervisorException.)
          _CannedAdapter(
            body: jsonEncode(<String, dynamic>{'error': 'Not found'}),
            statusCode: 404,
          ),
        ),
        onSingleActivated: (ws) => activated = ws,
      );

      await fillAndSubmit(tester);

      expect(activated, isNotNull);
      expect(activated!.slug, '');
      expect(activated!.basePath, '');
      expect(activated!.displayName, 'Work');

      // Host persisted as singleWorkspace.
      final hosts = await ctx.store.loadHosts();
      expect(hosts.single.kind, HostKind.singleWorkspace);

      // Workspace persisted + active.
      final workspaces = await ctx.store.loadWorkspaces();
      expect(workspaces.single.basePath, '');
      final active = await ctx.store.loadActiveWorkspace();
      expect(active, isNotNull);
      expect(active!.id, activated!.id);

      // Credentials: per-workspace API key + refreshed host CF token.
      final creds = MobileCredentialsStore(ctx.storage);
      expect(await creds.getWorkspaceApiKey(activated!.id), 'sk-single');
      expect(await creds.getHostCfToken(hosts.single.id), 'fresh-host-jwt');
    },
  );

  testWidgets(
    'error path: list() throws a network error → inline error + Retry, '
    'nothing activated, host row kept',
    (tester) async {
      var supervisorCalls = 0;
      var singleCalls = 0;

      final ctx = await pumpAddHost(
        tester,
        hostLogin: (origin) async => HostCallback(
          cfToken: 'host-jwt',
          email: '',
          userId: '',
        ),
        apiFactory: (host) => _apiWithAdapter(
          host,
          _ThrowingAdapter(DioExceptionType.connectionTimeout),
        ),
        instanceLogin: (_) async {
          singleCalls += 1;
          return const MobileCredentials(apiKey: 'x');
        },
        onSupervisor: (_, __) => supervisorCalls += 1,
      );

      await fillAndSubmit(tester);

      // Inline error + a Retry affordance.
      expect(
        find.textContaining("Couldn't reach this host's workspaces"),
        findsOneWidget,
      );
      expect(find.widgetWithText(OutlinedButton, 'Retry'), findsOneWidget);

      // Neither branch fired.
      expect(supervisorCalls, 0);
      expect(singleCalls, 0);

      // Host row persisted (harmless) with its CF token, but NOTHING activated.
      final hosts = await ctx.store.loadHosts();
      expect(hosts, hasLength(1));
      expect(
        await MobileCredentialsStore(ctx.storage)
            .getHostCfToken(hosts.single.id),
        'host-jwt',
      );
      expect(await ctx.store.loadWorkspaces(), isEmpty);
      expect(await ctx.store.loadActiveWorkspace(), isNull);
    },
  );

  testWidgets(
    'invalid URL fails form validation before launching host login',
    (tester) async {
      var hostLoginCalls = 0;

      await pumpAddHost(
        tester,
        hostLogin: (origin) async {
          hostLoginCalls += 1;
          return HostCallback(cfToken: 't', email: '', userId: '');
        },
        apiFactory: (host) => _apiWithAdapter(
          host,
          _CannedAdapter(
            body: jsonEncode(<String, dynamic>{
              'instances': <Map<String, dynamic>>[],
            }),
          ),
        ),
      );

      await tester.enterText(
        find.widgetWithText(TextFormField, 'Host URL'),
        'not-a-url',
      );
      await tester.enterText(
        find.widgetWithText(TextFormField, 'Label'),
        'Work',
      );
      await tester.tap(find.widgetWithText(ElevatedButton, 'Add'));
      await tester.pumpAndSettle();

      expect(
        find.text('Enter a valid URL with scheme and host'),
        findsOneWidget,
      );
      expect(hostLoginCalls, 0);
    },
  );

  testWidgets(
    'host login TimeoutException → friendly "timed out" message (not a raw '
    "Instance of 'TimeoutException'), nothing persisted",
    (tester) async {
      var detectCalls = 0;

      final ctx = await pumpAddHost(
        tester,
        // The real launcher raises TimeoutException when no callback arrives.
        hostLogin: (origin) async =>
            throw TimeoutException('no callback', const Duration(minutes: 2)),
        apiFactory: (host) {
          detectCalls += 1;
          return _apiWithAdapter(
            host,
            _CannedAdapter(
              body: jsonEncode(<String, dynamic>{'instances': <dynamic>[]}),
            ),
          );
        },
      );

      await fillAndSubmit(tester);

      // Friendly, non-raw copy.
      expect(find.text('Sign-in timed out. Please try again.'), findsOneWidget);
      expect(find.textContaining('TimeoutException'), findsNothing);

      // Bootstrap failed before detect ran → nothing persisted/activated.
      expect(detectCalls, 0);
      expect(await ctx.store.loadHosts(), isEmpty);
      expect(await ctx.store.loadWorkspaces(), isEmpty);
      expect(await ctx.store.loadActiveWorkspace(), isNull);
    },
  );

  testWidgets(
    'host login MobileCallbackLaunchException → its message surfaces inline',
    (tester) async {
      final ctx = await pumpAddHost(
        tester,
        hostLogin: (origin) async => throw const MobileCallbackLaunchException(
          'The browser could not be opened to sign in.',
        ),
        apiFactory: (host) => _apiWithAdapter(
          host,
          _CannedAdapter(
            body: jsonEncode(<String, dynamic>{'instances': <dynamic>[]}),
          ),
        ),
      );

      await fillAndSubmit(tester);

      expect(
        find.text('The browser could not be opened to sign in.'),
        findsOneWidget,
      );
      expect(await ctx.store.loadHosts(), isEmpty);
    },
  );
}
