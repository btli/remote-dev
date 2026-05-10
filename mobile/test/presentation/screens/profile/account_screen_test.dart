import 'dart:async';

import 'package:flutter/cupertino.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_inappwebview/flutter_inappwebview.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mocktail/mocktail.dart';
import 'package:remote_dev/domain/account.dart';
import 'package:remote_dev/domain/server_config.dart';
import 'package:remote_dev/infrastructure/api/account_api.dart';
import 'package:remote_dev/infrastructure/storage/flutter_secure_storage_port.dart';
import 'package:remote_dev/presentation/screens/profile/account_screen.dart';
import 'package:remote_dev/presentation/screens/webview_host/session_route_host.dart'
    show activeServerProvider, secureStorageProvider;

class _MockAccountApi extends Mock implements AccountApi {}

class _MockSecureStorage extends Mock implements FlutterSecureStoragePort {}

class _MockCookieManager extends Mock implements CookieManager {}

ServerConfig _server() => ServerConfig(
      id: 'srv-1',
      label: 'My Server',
      url: 'https://rdv.example',
      lastUsedAt: DateTime.utc(2026, 1, 1),
    );

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
      secureStorageProvider.overrideWithValue(storage),
      cookieManagerProvider.overrideWithValue(cookieManager),
    ],
    child: MaterialApp.router(routerConfig: router),
  );
  return (widget: widget, router: router);
}

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
      'sign-out: deletes per-server cf_authorization, scopes cookie '
      'deletion to active server, invalidates active server, navigates '
      'to /servers', (tester) async {
    when(() => api.me()).thenAnswer(
      (_) async => const Account(email: 'jane@example.com'),
    );
    final storage = _MockSecureStorage();
    when(() => storage.delete(any(), any())).thenAnswer((_) async {});
    final cookies = _MockCookieManager();
    when(
      () => cookies.deleteCookies(
        url: any(named: 'url'),
        path: any(named: 'path'),
        domain: any(named: 'domain'),
        webViewController: any(named: 'webViewController'),
      ),
    ).thenAnswer((_) async => true);

    final scope = _wrapWithRouter(
      api: api,
      storage: storage,
      cookieManager: cookies,
      server: _server(),
    );
    await tester.pumpWidget(scope.widget);
    await tester.pumpAndSettle();

    // Tap the sign-out CTA, then confirm in the dialog.
    await tester.tap(find.text('Sign out of this server'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(TextButton, 'Sign out'));
    await tester.pumpAndSettle();

    // Secure storage entry for THIS server's CF cookie was deleted with
    // the conventional ('cf_authorization') key namespaced under serverId.
    verify(() => storage.delete('srv-1', 'cf_authorization')).called(1);

    // Cookie deletion was scoped to the active server's URL — NOT a
    // global wipe. Capture the WebUri argument and assert its origin
    // matches the server we configured.
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
}
