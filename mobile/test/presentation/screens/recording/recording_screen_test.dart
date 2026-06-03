import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_inappwebview/flutter_inappwebview.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:remote_dev/application/state/active_connection.dart';
import 'package:remote_dev/domain/auth_cookie.dart';
import 'package:remote_dev/domain/host_config.dart';
import 'package:remote_dev/domain/workspace_config.dart';
import 'package:remote_dev/infrastructure/auth/mobile_credentials.dart';
import 'package:remote_dev/infrastructure/webview/navigation_policy.dart';
import 'package:remote_dev/infrastructure/webview/webview_cookie_seeder.dart';
import 'package:remote_dev/infrastructure/webview/webview_factory.dart';
import 'package:remote_dev/presentation/screens/recording/recording_screen.dart';
import 'package:remote_dev/presentation/screens/webview_host/session_route_host.dart'
    show
        activeWorkspaceProvider,
        mobileCredentialsStoreProvider,
        webViewCookieSeederProvider;

class _MockCredentialsStore extends Mock implements MobileCredentialsStore {}

class _MockCookieSeeder extends Mock implements WebViewCookieSeeder {}

/// Fake WebViewFactory that records what it was asked to build and
/// returns a `SizedBox` so the unit test runner doesn't need to host a
/// real `InAppWebView` (its platform channels aren't available under
/// flutter_test).
class _RecordingWebViewFactory implements WebViewFactory {
  Uri? capturedUrl;
  NavigationPolicy? capturedPolicy;
  ValueChanged<int>? capturedOnProgressChanged;

  @override
  Widget build({
    required Uri initialUrl,
    required NavigationPolicy policy,
    required OnLinkOpen onLinkOpen,
    void Function(InAppWebViewController controller)? onWebViewCreated,
    void Function(InAppWebViewController controller, WebUri? url)? onLoadStop,
    ValueChanged<int>? onProgressChanged,
    void Function(ConsoleMessage message)? onConsoleMessage,
  }) {
    capturedUrl = initialUrl;
    capturedPolicy = policy;
    capturedOnProgressChanged = onProgressChanged;
    // Avoid constructing a real `InAppWebView` here — its platform plugin
    // isn't available under flutter_test and the resulting throw replaces
    // the host subtree with an ErrorWidget, hiding the AppBar we're
    // asserting on. A `SizedBox` is enough for the tests below.
    return const SizedBox.shrink();
  }
}

/// A connection: host owns the origin, workspace owns the basePath. For a
/// migrated single-workspace install [basePath] is '' (so the navigated URL
/// is `<origin>/m/recording/<id>`); for a path-prefixed workspace it is
/// `/<slug>`.
ActiveConnection _conn({
  String hostId = 'h_srv-1',
  String workspaceId = 'w_srv-1',
  String origin = 'https://dev.example.com',
  String basePath = '',
}) {
  final now = DateTime.utc(2025, 1, 1);
  return ActiveConnection(
    host: HostConfig(
      id: hostId,
      label: 'Work',
      origin: origin,
      kind:
          basePath.isEmpty ? HostKind.singleWorkspace : HostKind.multiWorkspace,
      createdAt: now,
      lastUsedAt: now,
    ),
    workspace: WorkspaceConfig(
      id: workspaceId,
      hostId: hostId,
      slug: basePath.isEmpty ? '' : basePath.substring(1),
      basePath: basePath,
      displayName: 'Work',
      lastUsedAt: now,
    ),
  );
}

/// Stubs a [MobileCredentialsStore] whose `getInstanceCookies` resolves to a
/// fixed dummy cookie. Used to keep tests that don't care about the seed
/// path from blocking on the real platform secure-storage channel.
_MockCredentialsStore _fastCredentials() {
  final m = _MockCredentialsStore();
  when(() => m.getInstanceCookies(any(), any())).thenAnswer(
    (_) async => const [
      AuthCookie(name: 'CF_Authorization', value: 'cf-jwt-stub', path: '/'),
    ],
  );
  return m;
}

/// Stubs a [WebViewCookieSeeder] whose `seedAuthCookies` resolves to `true`
/// synchronously (next microtask). Used so the FutureBuilder gate
/// transitions to `ConnectionState.done` immediately and the WebView
/// mounts in unit tests where the real `CookieManager` method channel
/// isn't available.
_MockCookieSeeder _fastSeeder() {
  final m = _MockCookieSeeder();
  when(
    () => m.seedAuthCookies(
      serverOrigin: any(named: 'serverOrigin'),
      cookies: any(named: 'cookies'),
    ),
  ).thenAnswer((_) async {});
  return m;
}

void main() {
  setUpAll(() {
    // mocktail requires a fallback value for any non-nullable positional /
    // named argument matched via `any(named: ...)`. `seedAuthCookies` takes a
    // non-nullable `Uri serverOrigin`.
    registerFallbackValue(Uri.parse('https://fallback.example.com'));
    registerFallbackValue(<AuthCookie>[]);
  });

  // InAppWebView's platform plugin isn't available under flutter_test.
  // Suppress its initialization assertion the same way other screen tests
  // in this codebase do (see session_view_screen_test.dart).
  void suppressInAppWebViewErrors(WidgetTester tester) {
    final originalOnError = FlutterError.onError;
    FlutterError.onError = (details) {
      if (details.exceptionAsString().contains('InAppWebViewPlatform')) {
        return;
      }
      originalOnError?.call(details);
    };
    addTearDown(() => FlutterError.onError = originalOnError);
  }

  testWidgets('RecordingScreen mounts with the recording AppBar',
      (tester) async {
    suppressInAppWebViewErrors(tester);

    await tester.pumpWidget(
      const ProviderScope(
        child: MaterialApp(
          home: RecordingScreen(recordingId: 'test-rec'),
        ),
      ),
    );
    await tester.pump();
    expect(find.text('Recording'), findsAtLeast(1));
    expect(find.byIcon(Icons.arrow_back), findsOneWidget);
  });

  testWidgets(
    'RecordingScreen builds its WebView pointed at /m/recording/<id> '
    'on the active server origin with the locked-down navigation policy',
    (tester) async {
      suppressInAppWebViewErrors(tester);

      // After the FutureBuilder gate, the WebView only mounts once the
      // seed future resolves. Stub the credentials + seeder so it
      // resolves immediately under flutter_test (the real secure-storage
      // and CookieManager method channels aren't available).
      final credentials = _fastCredentials();
      final seeder = _fastSeeder();
      final factory = _RecordingWebViewFactory();

      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            activeWorkspaceProvider.overrideWith((ref) async => _conn()),
            mobileCredentialsStoreProvider.overrideWithValue(credentials),
            webViewCookieSeederProvider.overrideWithValue(seeder),
          ],
          child: MaterialApp(
            home: RecordingScreen(
              recordingId: 'rec-abc-123',
              webViewFactory: factory,
            ),
          ),
        ),
      );
      // Don't pumpAndSettle — InAppWebView creates platform channels we
      // can't fulfill. A bounded number of pumps flushes the FutureProvider
      // microtasks for the active-server lookup.
      for (var i = 0; i < 5; i++) {
        await tester.pump(const Duration(milliseconds: 16));
      }

      // The factory recorded the URL it was asked to build. That URL must
      // be `<active server origin>/m/recording/<recordingId>` exactly —
      // this is the only thing the `/m/recording/<id>` PWA route the
      // server exposes will respond to.
      expect(
        factory.capturedUrl,
        isNotNull,
        reason:
            'WebViewFactory.build should be invoked once activeServerProvider '
            'resolves. Got null — did the server config provider override fail?',
      );
      expect(factory.capturedUrl!.origin, equals('https://dev.example.com'));
      expect(factory.capturedUrl!.path, equals('/m/recording/rec-abc-123'));

      // And the navigation policy must be the locked-down session-view
      // variant (NOT the login variant), so unrelated outbound links are
      // intercepted. We can't see the private `_allowSsoProviders` flag
      // directly, but we can probe its observable behaviour.
      expect(factory.capturedPolicy, isNotNull);
      expect(
        factory.capturedPolicy!
            .decide(Uri.parse('https://accounts.google.com/')),
        equals(NavigationDecision.interceptAndOpenExternally),
        reason: 'Recording WebView should use the strict NavigationPolicy '
            '(not .forLogin) so terminal output containing third-party links '
            'is intercepted, not loaded in-place.',
      );
      expect(
        factory.capturedPolicy!.decide(
          Uri.parse('https://dev.example.com/m/recording/rec-abc-123'),
        ),
        equals(NavigationDecision.allow),
      );
    },
  );

  testWidgets(
    'a /demo workspace base-paths the WebView URL AND the nav allow list',
    (tester) async {
      // Task B: when the active workspace carries a basePath, the WebView
      // target becomes `<origin>/demo/m/recording/<id>`, the policy origin
      // gate stays the bare host origin (cookies are host-scoped), and the
      // allow list / `/m/` gate are base-path-aware.
      suppressInAppWebViewErrors(tester);

      final credentials = _fastCredentials();
      final seeder = _fastSeeder();
      final factory = _RecordingWebViewFactory();

      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            activeWorkspaceProvider.overrideWith(
              (ref) async => _conn(origin: 'https://h', basePath: '/demo'),
            ),
            mobileCredentialsStoreProvider.overrideWithValue(credentials),
            webViewCookieSeederProvider.overrideWithValue(seeder),
          ],
          child: MaterialApp(
            home: RecordingScreen(
              recordingId: 'rec-demo-1',
              webViewFactory: factory,
            ),
          ),
        ),
      );
      for (var i = 0; i < 5; i++) {
        await tester.pump(const Duration(milliseconds: 16));
      }

      // The navigated URL carries the basePath.
      expect(factory.capturedUrl, isNotNull);
      expect(
        factory.capturedUrl!.toString(),
        equals('https://h/demo/m/recording/rec-demo-1'),
      );

      final policy = factory.capturedPolicy!;
      // The base-path-prefixed in-surface route is allowed…
      expect(
        policy.decide(Uri.parse('https://h/demo/m/recording/rec-demo-1')),
        equals(NavigationDecision.allow),
      );
      // …a bare /m/* path (missing the basePath) is intercepted…
      expect(
        policy.decide(Uri.parse('https://h/m/recording/rec-demo-1')),
        equals(NavigationDecision.intercept),
      );
      // …and a sister surface under the same basePath is intercepted.
      expect(
        policy.decide(Uri.parse('https://h/demo/m/channel/x')),
        equals(NavigationDecision.intercept),
      );
      // Cookie seeding still targets the bare HOST origin (host-scoped).
      verify(
        () => seeder.seedAuthCookies(
          serverOrigin: Uri.parse('https://h'),
          cookies: any(named: 'cookies'),
        ),
      ).called(1);
    },
  );

  testWidgets(
    'AppBar LinearProgressIndicator shows on partial progress and hides at 100',
    (tester) async {
      // Verifies the bd remote-dev-72dh wiring: WebViewFactory.build receives an
      // onProgressChanged callback; partial values render the thin indicator on
      // the AppBar bottom; 100 hides it.
      suppressInAppWebViewErrors(tester);

      // Same seed-gate workaround as the previous test — see comment there.
      final credentials = _fastCredentials();
      final seeder = _fastSeeder();
      final factory = _RecordingWebViewFactory();

      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            activeWorkspaceProvider.overrideWith((ref) async => _conn()),
            mobileCredentialsStoreProvider.overrideWithValue(credentials),
            webViewCookieSeederProvider.overrideWithValue(seeder),
          ],
          child: MaterialApp(
            home: RecordingScreen(
              recordingId: 'rec-progress',
              webViewFactory: factory,
            ),
          ),
        ),
      );
      // Flush the FutureProvider microtasks so the data branch builds.
      for (var i = 0; i < 5; i++) {
        await tester.pump(const Duration(milliseconds: 16));
      }

      // Initial state: progress=100 → no indicator on AppBar bottom.
      expect(find.byType(LinearProgressIndicator), findsNothing);
      expect(factory.capturedOnProgressChanged, isNotNull);

      // Simulate a partial page-load progress event from the WebView.
      factory.capturedOnProgressChanged!(60);
      await tester.pump();
      final indicators = tester.widgetList<LinearProgressIndicator>(
        find.byType(LinearProgressIndicator),
      );
      expect(indicators, hasLength(1));
      expect(indicators.first.value, closeTo(0.6, 1e-9));
      expect(indicators.first.color, equals(const Color(0xFF7AA2F7)));

      // Complete: 100 hides the indicator.
      factory.capturedOnProgressChanged!(100);
      await tester.pump();
      expect(find.byType(LinearProgressIndicator), findsNothing);
    },
  );

  testWidgets(
    'WebView is NOT mounted until the CookieManager seed completes',
    (tester) async {
      // Regression guard for the codex review on remote-dev-jch1:
      //
      // Before the FutureBuilder gate, the WebView mounted in the same
      // build pass as the seed kicked off in `initState`. Because the
      // platform `CookieManager.setCookie` call is async, the
      // InAppWebView's initial GET to `/m/recording/<id>` could race the
      // setCookie flush — when it lost, CF Access rejected the request
      // and the user was bounced into /reauth.
      //
      // We verify the gate by hanging `seedAuthCookies` on a Completer the
      // test controls, then asserting that `WebViewFactory.build` is NOT
      // called while the seed is pending. Completing the seed must allow
      // the factory to fire.
      suppressInAppWebViewErrors(tester);

      final credentials = _MockCredentialsStore();
      when(() => credentials.getInstanceCookies(any(), any())).thenAnswer(
        (_) async => const [
          AuthCookie(
            name: 'CF_Authorization',
            value: 'cf-jwt-token',
            path: '/',
          ),
        ],
      );

      final seeder = _MockCookieSeeder();
      final seedCompleter = Completer<void>();
      when(
        () => seeder.seedAuthCookies(
          serverOrigin: any(named: 'serverOrigin'),
          cookies: any(named: 'cookies'),
        ),
      ).thenAnswer((_) => seedCompleter.future);

      final factory = _RecordingWebViewFactory();

      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            activeWorkspaceProvider.overrideWith((ref) async => _conn()),
            mobileCredentialsStoreProvider.overrideWithValue(credentials),
            webViewCookieSeederProvider.overrideWithValue(seeder),
          ],
          child: MaterialApp(
            home: RecordingScreen(
              recordingId: 'rec-race',
              webViewFactory: factory,
            ),
          ),
        ),
      );
      // Flush the activeServerProvider microtask + the initState seed
      // chain up to (but not past) the pending seedAuthCookies future.
      for (var i = 0; i < 5; i++) {
        await tester.pump(const Duration(milliseconds: 16));
      }

      // Seed is still pending — the FutureBuilder must be in the waiting
      // branch and MUST NOT have invoked the factory's `build`.
      expect(
        factory.capturedUrl,
        isNull,
        reason: 'WebViewFactory.build should NOT be invoked while the seed '
            'future is unresolved — otherwise the WebView races the '
            'CookieManager.setCookie flush.',
      );
      // The placeholder spinner should be visible (the AppBar progress
      // bar is hidden at progress=100, so any indicator here is the
      // gate's placeholder, not the progress UI).
      expect(find.byType(CircularProgressIndicator), findsOneWidget);

      // Complete the seed → next pump should mount the WebView.
      seedCompleter.complete();
      for (var i = 0; i < 5; i++) {
        await tester.pump(const Duration(milliseconds: 16));
      }

      expect(
        factory.capturedUrl,
        isNotNull,
        reason: 'Once the seed future completes, the FutureBuilder must mount '
            'the real WebView via WebViewFactory.build.',
      );
      expect(factory.capturedUrl!.path, equals('/m/recording/rec-race'));
      verify(
        () => seeder.seedAuthCookies(
          serverOrigin: any(named: 'serverOrigin'),
          cookies: any(named: 'cookies'),
        ),
      ).called(1);
    },
  );
}
