import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:remote_dev/application/ports/api_client_port.dart';
import 'package:remote_dev/application/ports/connectivity_port.dart';
import 'package:remote_dev/application/ports/host_workspace_store.dart';
import 'package:remote_dev/application/ports/push_port.dart';
import 'package:remote_dev/domain/auth_cookie.dart';
import 'package:remote_dev/domain/host_config.dart';
import 'package:remote_dev/domain/workspace_config.dart';
import 'package:remote_dev/infrastructure/auth/mobile_credentials.dart';
import 'package:remote_dev/infrastructure/push/push_token_registrar.dart';

class _MockPush extends Mock implements PushPort {}

class _MockStore extends Mock implements HostWorkspaceStore {}

class _MockCredentials extends Mock implements MobileCredentialsStore {}

class _MockClient extends Mock implements ApiClientPort {}

class _FakeConnectivity implements ConnectivityPort {
  final controller = StreamController<bool>.broadcast();

  @override
  Stream<bool> get onConnectivityChanged => controller.stream;

  @override
  Future<bool> isOnline() async => true;
}

/// The endpoint every registration / unregistration POSTs/DELETEs against.
const _pushTokenPath = '/api/notifications/push-token';

void main() {
  setUpAll(() {
    registerFallbackValue(<String, dynamic>{});
  });

  late _MockPush push;
  late _MockStore store;
  late _MockCredentials credentials;
  late StreamController<String> refresh;

  setUp(() {
    push = _MockPush();
    store = _MockStore();
    credentials = _MockCredentials();
    refresh = StreamController<String>.broadcast();
    when(() => push.onTokenRefresh).thenAnswer((_) => refresh.stream);
    // Default: no session cookies for any workspace. Cookie-only (OIDC) tests
    // override this per-workspace. API-key tests rely on this default so the
    // registrar's "API key OR cookies" gate sees only the API key.
    when(() => credentials.getWorkspaceAuthCookies(any()))
        .thenAnswer((_) async => const <AuthCookie>[]);
  });

  tearDown(() async {
    await refresh.close();
  });

  final now = DateTime(2026, 5, 8);

  HostConfig host(String id, {String origin = 'https://h'}) => HostConfig(
        id: id,
        label: id,
        origin: origin,
        kind: HostKind.multiWorkspace,
        createdAt: now,
        lastUsedAt: now,
      );

  WorkspaceConfig ws(
    String id, {
    required String hostId,
    String slug = '',
    String basePath = '',
  }) =>
      WorkspaceConfig(
        id: id,
        hostId: hostId,
        slug: slug,
        basePath: basePath,
        displayName: id,
        lastUsedAt: now,
      );

  /// Verify [client] POSTed the push token exactly [count] times.
  void verifyPosted(_MockClient client, {int count = 1}) {
    verify(() => client.post(_pushTokenPath, body: any(named: 'body')))
        .called(count);
  }

  test('registerWithAll POSTs to every workspace with a stored API key',
      () async {
    final clientA = _MockClient();
    final clientB = _MockClient();
    when(() => clientA.post(any(), body: any(named: 'body')))
        .thenAnswer((_) async => null);
    when(() => clientB.post(any(), body: any(named: 'body')))
        .thenAnswer((_) async => null);

    final h = host('h1');
    final wsA = ws('a', hostId: 'h1');
    final wsB = ws('b', hostId: 'h1', slug: 'demo', basePath: '/demo');
    when(store.loadWorkspaces).thenAnswer((_) async => [wsA, wsB]);
    when(() => store.loadHost('h1')).thenAnswer((_) async => h);
    when(() => credentials.getWorkspaceApiKey('a'))
        .thenAnswer((_) async => 'key-a');
    when(() => credentials.getWorkspaceApiKey('b'))
        .thenAnswer((_) async => 'key-b');

    final clients = {'a': clientA, 'b': clientB};
    final registrar = PushTokenRegistrar(
      push: push,
      store: store,
      credentials: credentials,
      clientFactory: (_, w) => clients[w.id]!,
      deviceId: 'dev-1',
    );

    await registrar.registerWithAll('tok-1');

    final capturedA = verify(
      () => clientA.post(_pushTokenPath, body: captureAny(named: 'body')),
    ).captured.single as Map<String, dynamic>;
    expect(capturedA['token'], 'tok-1');
    expect(capturedA['deviceId'], 'dev-1');
    expect(capturedA['platform'], anyOf('ios', 'android'));

    verifyPosted(clientB);
  });

  test('registerWithAll skips workspaces with no stored API key', () async {
    final clientB = _MockClient();
    when(() => clientB.post(any(), body: any(named: 'body')))
        .thenAnswer((_) async => null);

    final h = host('h1');
    final wsA = ws('a', hostId: 'h1'); // no API key → never signed in
    final wsB = ws('b', hostId: 'h1');
    when(store.loadWorkspaces).thenAnswer((_) async => [wsA, wsB]);
    when(() => store.loadHost('h1')).thenAnswer((_) async => h);
    when(() => credentials.getWorkspaceApiKey('a'))
        .thenAnswer((_) async => null);
    when(() => credentials.getWorkspaceApiKey('b'))
        .thenAnswer((_) async => 'key-b');

    final registrar = PushTokenRegistrar(
      push: push,
      store: store,
      credentials: credentials,
      clientFactory: (_, __) => clientB,
      deviceId: 'dev-1',
    );

    await registrar.registerWithAll('tok-1');

    // Only the signed-in workspace (b) is registered; a is skipped.
    verifyPosted(clientB);
  });

  test(
      'registerWithAll POSTs to a cookie-only (OIDC) workspace with no API key',
      () async {
    final clientA = _MockClient();
    when(() => clientA.post(any(), body: any(named: 'body')))
        .thenAnswer((_) async => null);

    final h = host('h1');
    // OIDC workspace: no API key, but a stored session cookie.
    final wsA = ws('a', hostId: 'h1', slug: 'dev', basePath: '/dev');
    when(store.loadWorkspaces).thenAnswer((_) async => [wsA]);
    when(() => store.loadHost('h1')).thenAnswer((_) async => h);
    when(() => credentials.getWorkspaceApiKey('a'))
        .thenAnswer((_) async => null);
    when(() => credentials.getWorkspaceAuthCookies('a')).thenAnswer(
      (_) async => const [
        AuthCookie(name: '__session', value: 'sess-jwt', path: '/'),
      ],
    );

    final registrar = PushTokenRegistrar(
      push: push,
      store: store,
      credentials: credentials,
      clientFactory: (_, __) => clientA,
      deviceId: 'dev-1',
    );

    await registrar.registerWithAll('tok-1');

    // The cookie-only workspace IS registered: the clientFactory cookie-auths
    // the POST even though no API key exists.
    final captured = verify(
      () => clientA.post(_pushTokenPath, body: captureAny(named: 'body')),
    ).captured.single as Map<String, dynamic>;
    expect(captured['token'], 'tok-1');
    expect(captured['deviceId'], 'dev-1');
  });

  test(
      'registerWithAll skips a workspace with neither API key nor cookies',
      () async {
    final clientA = _MockClient();
    when(() => clientA.post(any(), body: any(named: 'body')))
        .thenAnswer((_) async => null);

    final h = host('h1');
    final wsA = ws('a', hostId: 'h1');
    when(store.loadWorkspaces).thenAnswer((_) async => [wsA]);
    when(() => store.loadHost('h1')).thenAnswer((_) async => h);
    when(() => credentials.getWorkspaceApiKey('a'))
        .thenAnswer((_) async => null);
    when(() => credentials.getWorkspaceAuthCookies('a'))
        .thenAnswer((_) async => const <AuthCookie>[]);

    final registrar = PushTokenRegistrar(
      push: push,
      store: store,
      credentials: credentials,
      clientFactory: (_, __) => clientA,
      deviceId: 'dev-1',
    );

    await registrar.registerWithAll('tok-1');

    // Never signed in (no API key AND no cookies) → no POST.
    verifyNever(() => clientA.post(any(), body: any(named: 'body')));
  });

  test('per-workspace failure does not block subsequent workspaces', () async {
    final clientA = _MockClient();
    final clientB = _MockClient();
    when(() => clientA.post(any(), body: any(named: 'body')))
        .thenThrow(Exception('boom'));
    when(() => clientB.post(any(), body: any(named: 'body')))
        .thenAnswer((_) async => null);

    final h = host('h1');
    final pair = [ws('a', hostId: 'h1'), ws('b', hostId: 'h1')];
    when(store.loadWorkspaces).thenAnswer((_) async => pair);
    when(() => store.loadHost('h1')).thenAnswer((_) async => h);
    when(() => credentials.getWorkspaceApiKey(any()))
        .thenAnswer((_) async => 'key');

    final registrar = PushTokenRegistrar(
      push: push,
      store: store,
      credentials: credentials,
      clientFactory: (_, w) => w.id == 'a' ? clientA : clientB,
      deviceId: 'dev-1',
    );

    await registrar.registerWithAll('tok-1');

    verifyPosted(clientB);
  });

  test('start() subscribes to onTokenRefresh and re-registers', () async {
    final clientA = _MockClient();
    when(() => clientA.post(any(), body: any(named: 'body')))
        .thenAnswer((_) async => null);
    when(() => push.initialize()).thenAnswer((_) async => true);
    when(() => push.getToken()).thenAnswer((_) async => 'initial-tok');

    final h = host('h1');
    when(store.loadWorkspaces).thenAnswer((_) async => [ws('a', hostId: 'h1')]);
    when(() => store.loadHost('h1')).thenAnswer((_) async => h);
    when(() => credentials.getWorkspaceApiKey('a'))
        .thenAnswer((_) async => 'key-a');

    final registrar = PushTokenRegistrar(
      push: push,
      store: store,
      credentials: credentials,
      clientFactory: (_, __) => clientA,
      deviceId: 'dev-1',
    );

    await registrar.start();

    verifyPosted(clientA);

    refresh.add('refreshed-tok');
    await Future<void>.delayed(Duration.zero);

    verifyPosted(clientA);

    await registrar.stop();
  });

  test('unregisterWorkspace DELETEs from the specified workspace only',
      () async {
    final clientA = _MockClient();
    final clientB = _MockClient();
    when(() => clientA.delete(any(), body: any(named: 'body')))
        .thenAnswer((_) async {});
    when(() => clientB.delete(any(), body: any(named: 'body')))
        .thenAnswer((_) async {});
    when(() => push.getToken()).thenAnswer((_) async => 'tok-1');

    final h = host('h1');
    final pair = [ws('a', hostId: 'h1'), ws('b', hostId: 'h1')];
    when(store.loadWorkspaces).thenAnswer((_) async => pair);
    when(() => store.loadHost('h1')).thenAnswer((_) async => h);
    when(() => credentials.getWorkspaceApiKey(any()))
        .thenAnswer((_) async => 'key');

    final registrar = PushTokenRegistrar(
      push: push,
      store: store,
      credentials: credentials,
      clientFactory: (_, w) => w.id == 'a' ? clientA : clientB,
      deviceId: 'dev-1',
    );

    await registrar.unregisterWorkspace('a');

    final captured = verify(
      () => clientA.delete(_pushTokenPath, body: captureAny(named: 'body')),
    ).captured.single as Map<String, dynamic>;
    expect(captured['token'], 'tok-1');
    verifyNever(() => clientB.delete(any(), body: any(named: 'body')));
  });

  test('unregisterWorkspace is a no-op when getToken returns null', () async {
    final clientA = _MockClient();
    when(() => push.getToken()).thenAnswer((_) async => null);

    final registrar = PushTokenRegistrar(
      push: push,
      store: store,
      credentials: credentials,
      clientFactory: (_, __) => clientA,
      deviceId: 'dev-1',
    );

    await registrar.unregisterWorkspace('a');

    verifyNever(() => clientA.delete(any(), body: any(named: 'body')));
    // Token was null, so we never even touched the store.
    verifyNever(store.loadWorkspaces);
  });

  test('unregisterWorkspace is a no-op when the workspace has no API key',
      () async {
    final clientA = _MockClient();
    when(() => push.getToken()).thenAnswer((_) async => 'tok-1');
    when(store.loadWorkspaces).thenAnswer((_) async => [ws('a', hostId: 'h1')]);
    when(() => credentials.getWorkspaceApiKey('a'))
        .thenAnswer((_) async => null);

    final registrar = PushTokenRegistrar(
      push: push,
      store: store,
      credentials: credentials,
      clientFactory: (_, __) => clientA,
      deviceId: 'dev-1',
    );

    await registrar.unregisterWorkspace('a');

    verifyNever(() => clientA.delete(any(), body: any(named: 'body')));
  });

  test('unregisterWorkspace DELETEs from a cookie-only (OIDC) workspace',
      () async {
    final clientA = _MockClient();
    when(() => clientA.delete(any(), body: any(named: 'body')))
        .thenAnswer((_) async {});
    when(() => push.getToken()).thenAnswer((_) async => 'tok-1');

    final h = host('h1');
    when(store.loadWorkspaces).thenAnswer((_) async => [ws('a', hostId: 'h1')]);
    when(() => store.loadHost('h1')).thenAnswer((_) async => h);
    // OIDC workspace: no API key, but a stored session cookie.
    when(() => credentials.getWorkspaceApiKey('a'))
        .thenAnswer((_) async => null);
    when(() => credentials.getWorkspaceAuthCookies('a')).thenAnswer(
      (_) async => const [
        AuthCookie(name: '__session', value: 'sess-jwt', path: '/'),
      ],
    );

    final registrar = PushTokenRegistrar(
      push: push,
      store: store,
      credentials: credentials,
      clientFactory: (_, __) => clientA,
      deviceId: 'dev-1',
    );

    await registrar.unregisterWorkspace('a');

    final captured = verify(
      () => clientA.delete(_pushTokenPath, body: captureAny(named: 'body')),
    ).captured.single as Map<String, dynamic>;
    expect(captured['token'], 'tok-1');
  });

  test('start returns false when push.initialize fails', () async {
    when(() => push.initialize()).thenAnswer((_) async => false);
    final registrar = PushTokenRegistrar(
      push: push,
      store: store,
      credentials: credentials,
      clientFactory: (_, __) => throw UnimplementedError(),
      deviceId: 'dev-1',
    );
    expect(await registrar.start(), isFalse);
  });

  test('failed registration is remembered and retried by retryPending',
      () async {
    final clientA = _MockClient();
    var calls = 0;
    when(() => clientA.post(any(), body: any(named: 'body')))
        .thenAnswer((_) async {
      calls++;
      if (calls == 1) throw Exception('offline');
      return null;
    });

    final h = host('h1');
    when(store.loadWorkspaces).thenAnswer((_) async => [ws('a', hostId: 'h1')]);
    when(() => store.loadHost('h1')).thenAnswer((_) async => h);
    when(() => credentials.getWorkspaceApiKey('a'))
        .thenAnswer((_) async => 'key-a');

    final registrar = PushTokenRegistrar(
      push: push,
      store: store,
      credentials: credentials,
      clientFactory: (_, __) => clientA,
      deviceId: 'dev-1',
    );

    await registrar.registerWithAll('tok-1'); // attempt 1 fails → pending {a}
    expect(calls, 1);

    await registrar.retryPending(); // attempt 2 succeeds → pending empty
    expect(calls, 2);

    await registrar.retryPending(); // nothing pending → no further POST
    expect(calls, 2);
  });

  test('connectivity-restored retries pending registrations', () async {
    final clientA = _MockClient();
    var calls = 0;
    when(() => clientA.post(any(), body: any(named: 'body')))
        .thenAnswer((_) async {
      calls++;
      if (calls == 1) throw Exception('offline');
      return null;
    });
    when(() => push.initialize()).thenAnswer((_) async => true);
    when(() => push.getToken()).thenAnswer((_) async => 'tok-1');

    final h = host('h1');
    when(store.loadWorkspaces).thenAnswer((_) async => [ws('a', hostId: 'h1')]);
    when(() => store.loadHost('h1')).thenAnswer((_) async => h);
    when(() => credentials.getWorkspaceApiKey('a'))
        .thenAnswer((_) async => 'key-a');

    final conn = _FakeConnectivity();
    final registrar = PushTokenRegistrar(
      push: push,
      store: store,
      credentials: credentials,
      clientFactory: (_, __) => clientA,
      deviceId: 'dev-1',
      connectivity: conn,
    );

    await registrar.start(); // initial attempt fails → pending {a}
    expect(calls, 1);

    conn.controller.add(false); // offline event must NOT trigger a retry
    await pumpEventQueue();
    expect(calls, 1);

    conn.controller.add(true); // connectivity regained → retry succeeds
    await pumpEventQueue();
    expect(calls, 2);

    conn.controller.add(true); // nothing pending now → no extra POST
    await pumpEventQueue();
    expect(calls, 2);

    await registrar.stop();
    await conn.controller.close();
  });

  test('retryPending is a no-op before any registration', () async {
    final clientA = _MockClient();

    final registrar = PushTokenRegistrar(
      push: push,
      store: store,
      credentials: credentials,
      clientFactory: (_, __) => clientA,
      deviceId: 'dev-1',
    );

    await registrar.retryPending();

    verifyNever(() => clientA.post(any(), body: any(named: 'body')));
    verifyNever(store.loadWorkspaces);
  });

  test('backoff timer retries pending registrations without external triggers',
      () async {
    final clientA = _MockClient();
    var calls = 0;
    when(() => clientA.post(any(), body: any(named: 'body')))
        .thenAnswer((_) async {
      calls++;
      if (calls == 1) throw Exception('offline');
      return null;
    });

    final h = host('h1');
    when(store.loadWorkspaces).thenAnswer((_) async => [ws('a', hostId: 'h1')]);
    when(() => store.loadHost('h1')).thenAnswer((_) async => h);
    when(() => credentials.getWorkspaceApiKey('a'))
        .thenAnswer((_) async => 'key-a');

    final registrar = PushTokenRegistrar(
      push: push,
      store: store,
      credentials: credentials,
      clientFactory: (_, __) => clientA,
      deviceId: 'dev-1',
      backoffBase: const Duration(milliseconds: 20),
    );

    await registrar.registerWithAll('tok-1'); // fails → pending, timer armed
    expect(calls, 1);

    await Future<void>.delayed(const Duration(milliseconds: 90));
    expect(calls, 2); // timer fired → retry succeeded

    await Future<void>.delayed(const Duration(milliseconds: 90));
    expect(calls, 2); // pending empty → timer cancelled

    await registrar.stop();
  });
}
