import 'dart:async';

import 'package:flutter/cupertino.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_inappwebview/flutter_inappwebview.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mocktail/mocktail.dart';
import 'package:remote_dev/application/ports/host_workspace_store.dart';
import 'package:remote_dev/application/state/active_connection.dart';
import 'package:remote_dev/domain/account.dart';
import 'package:remote_dev/domain/host_config.dart';
import 'package:remote_dev/domain/server_config.dart';
import 'package:remote_dev/domain/workspace_config.dart';
import 'package:remote_dev/infrastructure/api/account_api.dart';
import 'package:remote_dev/infrastructure/push/push_token_registrar.dart';
import 'package:remote_dev/infrastructure/storage/flutter_secure_storage_port.dart';
import 'package:remote_dev/presentation/router/app_router.dart'
    show pushTokenRegistrarProvider;
import 'package:remote_dev/presentation/screens/profile/account_screen.dart';
import 'package:remote_dev/presentation/screens/webview_host/session_route_host.dart'
    show
        activeServerProvider,
        activeWorkspaceProvider,
        hostWorkspaceStoreProvider,
        secureStorageProvider;

class _MockAccountApi extends Mock implements AccountApi {}

class _MockSecureStorage extends Mock implements FlutterSecureStoragePort {}

class _MockCookieManager extends Mock implements CookieManager {}

class _MockHostWorkspaceStore extends Mock implements HostWorkspaceStore {}

class _MockPushRegistrar extends Mock implements PushTokenRegistrar {}

ServerConfig _server() => ServerConfig(
      id: 'srv-1',
      label: 'My Server',
      url: 'https://rdv.example',
      lastUsedAt: DateTime.utc(2026, 1, 1),
    );

/// Migrated single-workspace connection matching `_server()`: the host owns
/// the origin and the workspace has an empty basePath (so the shim's
/// `effectiveUrl == host.origin`).
ActiveConnection _conn() {
  final now = DateTime.utc(2026, 1, 1);
  return ActiveConnection(
    host: HostConfig(
      id: 'h_srv-1',
      label: 'My Server',
      origin: 'https://rdv.example',
      kind: HostKind.singleWorkspace,
      createdAt: now,
      lastUsedAt: now,
    ),
    workspace: WorkspaceConfig(
      id: 'w_srv-1',
      hostId: 'h_srv-1',
      slug: '',
      basePath: '',
      displayName: 'My Server',
      lastUsedAt: now,
    ),
  );
}

Widget _wrap({
  required AccountApi api,
  ServerConfig? server,
  FlutterSecureStoragePort? storage,
  CookieManager? cookieManager,
}) {
  return ProviderScope(
    overrides: [
      accountApiProvider.overrideWithValue(api),
      // Override the activeServer FutureProvider with a value that is already
      // resolved. Returning a SynchronousFuture means asyncServer.asData is
      // populated on the very first build, so tests don't have to pump twice
      // just to get past the implicit loading state.
      activeServerProvider.overrideWith(
        (ref) => SynchronousFuture<ServerConfig?>(server),
      ),
      if (storage != null) secureStorageProvider.overrideWithValue(storage),
      if (cookieManager != null)
        cookieManagerProvider.overrideWithValue(cookieManager),
    ],
    child: const MaterialApp(home: AccountScreen()),
  );
}

/// Sign-out test wrap: mounts AccountScreen inside a real GoRouter so we
/// can verify the screen ends up at `/servers` after the sign-out flow
/// completes. The router is returned alongside the widget so the test
/// can assert on `router.routerDelegate.currentConfiguration`.
({Widget widget, GoRouter router}) _wrapWithRouter({
  required AccountApi api,
  required FlutterSecureStoragePort storage,
  required CookieManager cookieManager,
  required HostWorkspaceStore store,
  required PushTokenRegistrar registrar,
  ServerConfig? server,
}) {
  final router = GoRouter(
    initialLocation: '/account',
    routes: [
      GoRoute(path: '/account', builder: (_, __) => const AccountScreen()),
      GoRoute(
        path: '/servers',
        builder: (_, __) => const Scaffold(body: Text('servers-screen')),
      ),
    ],
  );
  final widget = ProviderScope(
    overrides: [
      accountApiProvider.overrideWithValue(api),
      activeServerProvider.overrideWith(
        (ref) => SynchronousFuture<ServerConfig?>(server),
      ),
      // Sign-out reads the active connection to clear the right host +
      // workspace credential namespaces.
      activeWorkspaceProvider.overrideWith(
        (ref) => SynchronousFuture<ActiveConnection?>(
          server == null ? null : _conn(),
        ),
      ),
      secureStorageProvider.overrideWithValue(storage),
      cookieManagerProvider.overrideWithValue(cookieManager),
      // Sign-out checks the host's remaining workspaces (to gate the
      // host-wide CF-token/cookie teardown) and unregisters the workspace's
      // push token. Both are stubbed so the flow is deterministic.
      hostWorkspaceStoreProvider.overrideWithValue(store),
      pushTokenRegistrarProvider.overrideWithValue(registrar),
    ],
    child: MaterialApp.router(routerConfig: router),
  );
  return (widget: widget, router: router);
}

/// A [HostWorkspaceStore] stub whose `loadWorkspaces(hostId:)` returns a fixed
/// list — the sign-out flow reads it to decide whether the host-wide token +
/// cookies should be wiped (only when no sibling workspace remains).
_MockHostWorkspaceStore _storeWithWorkspaces(List<WorkspaceConfig> onHost) {
  final store = _MockHostWorkspaceStore();
  when(() => store.loadWorkspaces(hostId: any(named: 'hostId')))
      .thenAnswer((_) async => onHost);
  return store;
}

/// A push registrar stub whose `unregisterWorkspace` records the ids it was
/// asked to unregister and resolves successfully.
_MockPushRegistrar _registrarRecording(List<String> unregistered) {
  final registrar = _MockPushRegistrar();
  when(() => registrar.unregisterWorkspace(any())).thenAnswer((inv) async {
    unregistered.add(inv.positionalArguments.first as String);
  });
  return registrar;
}

/// The active workspace under test (`_conn()` → workspace `w_srv-1`).
WorkspaceConfig _activeWs() => _conn().workspace;

void main() {
  late _MockAccountApi api;

  setUpAll(() {
    registerFallbackValue(WebUri('https://example.com'));
  });

  setUp(() {
    api = _MockAccountApi();
  });

  testWidgets('shows loading indicator while account is in flight',
      (tester) async {
    // Use a Completer so the future never completes during the test, locking
    // the screen in the loading state.
    final completer = Completer<Account>();
    when(() => api.me()).thenAnswer((_) => completer.future);

    await tester.pumpWidget(_wrap(api: api, server: _server()));
    // Let the activeServerProvider future resolve via microtasks. The account
    // FutureProvider stays pending, so the screen renders its loader.
    await tester.runAsync(() => Future<void>.delayed(Duration.zero));
    await tester.pump();

    expect(find.byType(CupertinoActivityIndicator), findsOneWidget);
  });

  testWidgets('renders email on success', (tester) async {
    when(() => api.me()).thenAnswer(
      (_) async => const Account(
        email: 'jane@example.com',
        name: 'Jane Doe',
      ),
    );

    await tester.pumpWidget(_wrap(api: api, server: _server()));
    await tester.pumpAndSettle();

    expect(find.text('jane@example.com'), findsOneWidget);
    expect(find.text('Jane Doe'), findsOneWidget);
    expect(find.text('Sign out of this server'), findsOneWidget);
    expect(find.text('My Server'), findsOneWidget);
  });

  testWidgets('renders error message on failure', (tester) async {
    when(() => api.me()).thenThrow(StateError('No active session.'));

    await tester.pumpWidget(_wrap(api: api, server: _server()));
    await tester.pumpAndSettle();

    expect(find.text('Failed to load account'), findsOneWidget);
    expect(find.textContaining('No active session.'), findsOneWidget);
    expect(find.text('Retry'), findsOneWidget);
  });

  testWidgets('shows no-active-server view when server is null',
      (tester) async {
    when(() => api.me()).thenAnswer(
      (_) async => const Account(email: 'unused@example.com'),
    );

    await tester.pumpWidget(_wrap(api: api, server: null));
    await tester.pumpAndSettle();

    expect(find.text('No active server'), findsOneWidget);
    expect(find.text('Choose a server'), findsOneWidget);
    // The success body should not render in this branch.
    expect(find.text('unused@example.com'), findsNothing);
  });

  testWidgets(
      'shows loading indicator while activeServerProvider is in flight '
      '(does NOT fall through to "no active server")', (tester) async {
    // Build a ProviderScope where the activeServer future never completes,
    // so we exercise the loading branch of the outer asyncServer.when().
    // If the screen incorrectly conflated loading with `server == null`
    // it would render the empty-state CTA — assert it does not.
    final widget = ProviderScope(
      overrides: [
        accountApiProvider.overrideWithValue(api),
        activeServerProvider.overrideWith(
          (ref) => Completer<ServerConfig?>().future,
        ),
      ],
      child: const MaterialApp(home: AccountScreen()),
    );
    await tester.pumpWidget(widget);
    await tester.pump();

    expect(find.byType(CupertinoActivityIndicator), findsOneWidget);
    expect(find.text('No active server'), findsNothing);
    expect(find.text('Choose a server'), findsNothing);
  });

  testWidgets(
      'sign-out (last workspace on host): clears host + workspace credential '
      'namespaces, unregisters the push token, scopes cookie deletion to the '
      'host origin, invalidates the active connection, navigates to /servers',
      (tester) async {
    when(() => api.me()).thenAnswer(
      (_) async => const Account(email: 'jane@example.com'),
    );
    final storage = _MockSecureStorage();
    when(() => storage.delete(any(), any())).thenAnswer((_) async {});
    // clearWorkspace / clearHost call deleteAll(namespace).
    when(() => storage.deleteAll(any())).thenAnswer((_) async {});
    final cookies = _MockCookieManager();
    when(
      () => cookies.deleteCookies(
        url: any(named: 'url'),
        path: any(named: 'path'),
        domain: any(named: 'domain'),
        webViewController: any(named: 'webViewController'),
      ),
    ).thenAnswer((_) async => true);

    // Only the active workspace remains on the host → last-workspace path:
    // the host-wide CF token + cookies SHOULD be wiped.
    final store = _storeWithWorkspaces([_activeWs()]);
    final unregistered = <String>[];
    final registrar = _registrarRecording(unregistered);

    final scope = _wrapWithRouter(
      api: api,
      storage: storage,
      cookieManager: cookies,
      store: store,
      registrar: registrar,
      server: _server(),
    );
    await tester.pumpWidget(scope.widget);
    await tester.pumpAndSettle();

    // Tap the sign-out CTA, then confirm in the dialog.
    await tester.tap(find.text('Sign out of this server'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(TextButton, 'Sign out'));
    await tester.pumpAndSettle();

    // The workspace's push token was unregistered before its creds were
    // cleared.
    expect(unregistered, ['w_srv-1']);

    // Both credential namespaces were cleared: the per-workspace API key
    // and the host-wide CF token. MobileCredentialsStore namespaces these
    // as `workspace.<id>` / `host.<id>`.
    verify(() => storage.deleteAll('workspace.w_srv-1')).called(1);
    verify(() => storage.deleteAll('host.h_srv-1')).called(1);

    // Cookie deletion was scoped to the host origin — NOT a global wipe.
    // Capture the WebUri argument and assert its origin matches the host.
    final captured = verify(
      () => cookies.deleteCookies(
        url: captureAny(named: 'url'),
        path: any(named: 'path'),
        domain: any(named: 'domain'),
        webViewController: any(named: 'webViewController'),
      ),
    ).captured;
    expect(captured, isNotEmpty);
    expect((captured.single as WebUri).toString(), 'https://rdv.example');

    // Router landed on /servers.
    expect(
      scope.router.routerDelegate.currentConfiguration.uri.toString(),
      '/servers',
    );
    expect(find.text('servers-screen'), findsOneWidget);
  });

  testWidgets(
      'sign-out (sibling workspace remains on host): clears ONLY the '
      'workspace key, leaves the host-wide CF token + cookies intact so the '
      'sibling stays authenticated', (tester) async {
    when(() => api.me()).thenAnswer(
      (_) async => const Account(email: 'jane@example.com'),
    );
    final storage = _MockSecureStorage();
    when(() => storage.delete(any(), any())).thenAnswer((_) async {});
    when(() => storage.deleteAll(any())).thenAnswer((_) async {});
    final cookies = _MockCookieManager();
    when(
      () => cookies.deleteCookies(
        url: any(named: 'url'),
        path: any(named: 'path'),
        domain: any(named: 'domain'),
        webViewController: any(named: 'webViewController'),
      ),
    ).thenAnswer((_) async => true);

    // A sibling workspace under the same host survives the sign-out → the
    // host-wide CF token + cookies must NOT be wiped (doing so would de-auth
    // the sibling).
    final sibling = WorkspaceConfig(
      id: 'w_srv-2',
      hostId: 'h_srv-1',
      slug: 'demo',
      basePath: '/demo',
      displayName: 'Demo',
      lastUsedAt: DateTime.utc(2026, 1, 1),
    );
    final store = _storeWithWorkspaces([_activeWs(), sibling]);
    final unregistered = <String>[];
    final registrar = _registrarRecording(unregistered);

    final scope = _wrapWithRouter(
      api: api,
      storage: storage,
      cookieManager: cookies,
      store: store,
      registrar: registrar,
      server: _server(),
    );
    await tester.pumpWidget(scope.widget);
    await tester.pumpAndSettle();

    await tester.tap(find.text('Sign out of this server'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(TextButton, 'Sign out'));
    await tester.pumpAndSettle();

    // The signed-out workspace's push token is still unregistered.
    expect(unregistered, ['w_srv-1']);

    // ONLY the per-workspace key is cleared…
    verify(() => storage.deleteAll('workspace.w_srv-1')).called(1);
    // …the host-wide CF token is preserved (sibling still needs it)…
    verifyNever(() => storage.deleteAll('host.h_srv-1'));
    // …and the host-origin cookies are NOT wiped.
    verifyNever(
      () => cookies.deleteCookies(
        url: any(named: 'url'),
        path: any(named: 'path'),
        domain: any(named: 'domain'),
        webViewController: any(named: 'webViewController'),
      ),
    );

    // Sign-out still completes + navigates to the picker.
    expect(
      scope.router.routerDelegate.currentConfiguration.uri.toString(),
      '/servers',
    );
    expect(find.text('servers-screen'), findsOneWidget);
  });
}
