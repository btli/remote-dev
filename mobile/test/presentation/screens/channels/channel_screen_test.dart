import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_inappwebview/flutter_inappwebview.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:remote_dev/application/state/active_connection.dart';
import 'package:remote_dev/domain/active_node.dart';
import 'package:remote_dev/domain/channel.dart';
import 'package:remote_dev/domain/host_config.dart';
import 'package:remote_dev/domain/workspace_config.dart';
import 'package:remote_dev/infrastructure/api/channels_api.dart';
import 'package:remote_dev/infrastructure/api/preferences_api.dart';
import 'package:remote_dev/infrastructure/auth/mobile_credentials.dart';
import 'package:remote_dev/infrastructure/webview/bridge_controller.dart';
import 'package:remote_dev/infrastructure/webview/navigation_policy.dart';
import 'package:remote_dev/infrastructure/webview/webview_cookie_seeder.dart';
import 'package:remote_dev/infrastructure/webview/webview_factory.dart';
import 'package:remote_dev/presentation/screens/channels/channel_screen.dart';
import 'package:remote_dev/presentation/screens/channels/channels_tab_screen.dart';
import 'package:remote_dev/presentation/screens/webview_host/session_route_host.dart'
    show
        activeWorkspaceProvider,
        mobileCredentialsStoreProvider,
        webViewCookieSeederProvider;

/// `ChannelScreen` is a thin native wrapper around an embedded WebView
/// pointed at `<server>/m/channel/<id>` — the real message list, send
/// box, and thread panel are rendered by the React PWA inside the
/// WebView. The native side only owns the AppBar (back button + title)
/// and the WebView frame.
///
/// We deliberately do NOT call `pumpAndSettle` — InAppWebView's platform
/// channel cannot be exercised in widget tests.
class _FakeChannelsApi extends Fake implements ChannelsApi {
  _FakeChannelsApi(this._channels);
  final List<Channel> _channels;

  @override
  Future<List<Channel>> list({ActiveNode? activeNode}) async => _channels;

  @override
  Future<void> archive(String id) async {}
}

/// Stub preferences API that always reports a fixed active node. The
/// `_ChannelTitle` widget under test watches the channels-list provider
/// keyed by the active node, so tests need *some* node present or the
/// list short-circuits to `const []` and the title can't resolve.
class _StaticPreferencesApi extends Fake implements PreferencesApi {
  @override
  Future<ActiveNode?> getActiveNode() async => const ActiveNode(
        id: 'proj-test',
        type: ActiveNodeType.project,
      );

  @override
  Future<void> setActiveNode({
    required String? nodeId,
    required ActiveNodeType? nodeType,
    bool pinned = false,
  }) async {}
}

/// Returns a future the test controls so we can assert behavior while the
/// channels list is still in its loading state.
class _DelayedChannelsApi extends Fake implements ChannelsApi {
  _DelayedChannelsApi(this.future);
  final Future<List<Channel>> future;

  @override
  Future<List<Channel>> list({ActiveNode? activeNode}) => future;

  @override
  Future<void> archive(String id) async {}
}

class _MockCredentialsStore extends Mock implements MobileCredentialsStore {}

class _MockCookieSeeder extends Mock implements WebViewCookieSeeder {}

_MockCredentialsStore _fastCredentials() {
  final m = _MockCredentialsStore();
  when(() => m.getHostCfToken(any())).thenAnswer((_) async => 'cf-jwt-stub');
  return m;
}

_MockCookieSeeder _fastSeeder() {
  final m = _MockCookieSeeder();
  when(
    () => m.seedCfCookie(
      serverOrigin: any(named: 'serverOrigin'),
      value: any(named: 'value'),
    ),
  ).thenAnswer((_) async => true);
  return m;
}

/// Same shape as `_RecordingWebViewFactory` — captures the
/// `onProgressChanged` callback the screen wires into [WebViewFactory.build]
/// so the test can simulate page-load progress events.
class _ChannelWebViewFactory implements WebViewFactory {
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
    capturedOnProgressChanged = onProgressChanged;
    // SizedBox stand-in — the real InAppWebView's platform plugin isn't
    // available under flutter_test and would replace the host subtree
    // with an ErrorWidget.
    return const SizedBox.shrink();
  }
}

/// A migrated single-workspace connection (empty basePath).
ActiveConnection _conn({
  String hostId = 'h_srv-1',
  String workspaceId = 'w_srv-1',
  String origin = 'https://dev.example.com',
}) {
  final now = DateTime.utc(2025, 1, 1);
  return ActiveConnection(
    host: HostConfig(
      id: hostId,
      label: 'Work',
      origin: origin,
      kind: HostKind.singleWorkspace,
      createdAt: now,
      lastUsedAt: now,
    ),
    workspace: WorkspaceConfig(
      id: workspaceId,
      hostId: hostId,
      slug: '',
      basePath: '',
      displayName: 'Work',
      lastUsedAt: now,
    ),
  );
}

void main() {
  setUpAll(() {
    // mocktail requires a fallback for non-nullable named-args matched
    // via `any(named: ...)`. `seedCfCookie` takes a non-nullable Uri.
    registerFallbackValue(Uri.parse('https://fallback.example.com'));
  });

  testWidgets('ChannelScreen mounts with the channel AppBar', (tester) async {
    await tester.pumpWidget(
      const ProviderScope(
        child: MaterialApp(
          home: ChannelScreen(channelId: 'test-channel'),
        ),
      ),
    );
    await tester.pump();
    // Generic title until/unless the channels list resolves with a match.
    expect(find.text('Channel'), findsAtLeast(1));
    expect(find.byIcon(Icons.arrow_back), findsOneWidget);
  });

  testWidgets(
    'AppBar title resolves to "#<name>" once channelsListProvider has the channel',
    (tester) async {
      final api = _FakeChannelsApi(const [
        Channel(id: 'c1', name: 'general'),
        Channel(id: 'c2', name: 'random'),
      ]);

      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            channelsApiProvider.overrideWithValue(api),
            preferencesApiProvider.overrideWithValue(_StaticPreferencesApi()),
          ],
          child: const MaterialApp(
            home: ChannelScreen(channelId: 'c2'),
          ),
        ),
      );

      // Drain microtasks so the FutureProvider for channels resolves.
      // We avoid pumpAndSettle because InAppWebView never settles.
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 1));
      await tester.pump();

      expect(find.text('#random'), findsOneWidget);
      expect(find.byIcon(Icons.arrow_back), findsOneWidget);
    },
  );

  testWidgets(
    'AppBar falls back to generic title when channelId is unknown',
    (tester) async {
      final api = _FakeChannelsApi(const [
        Channel(id: 'c1', name: 'general'),
      ]);

      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            channelsApiProvider.overrideWithValue(api),
            preferencesApiProvider.overrideWithValue(_StaticPreferencesApi()),
          ],
          child: const MaterialApp(
            home: ChannelScreen(channelId: 'missing-id'),
          ),
        ),
      );

      await tester.pump();
      await tester.pump(const Duration(milliseconds: 1));
      await tester.pump();

      // The id isn't in the list → keep the generic "Channel" title,
      // which is what arrives via deep-link before the cache is populated.
      expect(find.text('Channel'), findsAtLeast(1));
      expect(find.text('#general'), findsNothing);
    },
  );

  group('back gesture bridges to the embedded PWA first', () {
    // Smoke test for `_handleBack`: when the bridge reports it consumed
    // the gesture (e.g. closed a thread panel inside the WebView), the
    // native shell MUST NOT pop its route — otherwise the user gets
    // double-back behavior. When the bridge declines, the native route
    // must pop normally so the user can leave the channel screen.
    //
    // The platform `InAppWebViewController` isn't available under
    // `flutter_test`, so we exercise this via the `bridgeFactoryOverride`
    // test seam: it lets the test substitute a mocked [BridgeController]
    // whose `back()` future the test controls per-case.

    testWidgets(
      'bridge.back() returns true → Navigator.maybePop is NOT called',
      (tester) async {
        final bridge = _MockBridge();
        when(() => bridge.back()).thenAnswer((_) async => true);

        final observer = _PopObserver();
        await tester.pumpWidget(
          ProviderScope(
            child: MaterialApp(
              navigatorObservers: [observer],
              home: const _RootProbe(),
              onGenerateRoute: (settings) {
                if (settings.name == '/channel') {
                  return MaterialPageRoute<void>(
                    settings: settings,
                    builder: (_) => ChannelScreen(
                      channelId: 'c-back',
                      bridgeFactoryOverride: (_) => bridge,
                    ),
                  );
                }
                return null;
              },
            ),
          ),
        );
        await tester.pump();
        // Push ChannelScreen onto the stack so a pop has somewhere to go.
        final probeState =
            tester.state<_RootProbeState>(find.byType(_RootProbe));
        probeState.pushChannel();
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 1));

        expect(find.byType(ChannelScreen), findsOneWidget);
        observer.popped.clear();

        // Tap the AppBar back button.
        await tester.tap(find.byIcon(Icons.arrow_back));
        // Drain the bridge.back() microtask + the subsequent
        // maybePop branch (which would synchronously fire if invoked).
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 1));
        await tester.pump();

        verify(() => bridge.back()).called(1);
        expect(
          observer.popped,
          isEmpty,
          reason:
              'When the embedded PWA consumes the back gesture, the native '
              'route must stay put — otherwise the user gets a double-back.',
        );
        expect(find.byType(ChannelScreen), findsOneWidget);
      },
    );

    testWidgets(
      'bridge.back() returns false → Navigator.maybePop IS called',
      (tester) async {
        final bridge = _MockBridge();
        when(() => bridge.back()).thenAnswer((_) async => false);

        final observer = _PopObserver();
        await tester.pumpWidget(
          ProviderScope(
            child: MaterialApp(
              navigatorObservers: [observer],
              home: const _RootProbe(),
              onGenerateRoute: (settings) {
                if (settings.name == '/channel') {
                  return MaterialPageRoute<void>(
                    settings: settings,
                    builder: (_) => ChannelScreen(
                      channelId: 'c-back',
                      bridgeFactoryOverride: (_) => bridge,
                    ),
                  );
                }
                return null;
              },
            ),
          ),
        );
        await tester.pump();
        final probeState =
            tester.state<_RootProbeState>(find.byType(_RootProbe));
        probeState.pushChannel();
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 1));

        expect(find.byType(ChannelScreen), findsOneWidget);
        observer.popped.clear();

        await tester.tap(find.byIcon(Icons.arrow_back));
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 1));
        await tester.pump(const Duration(milliseconds: 300));

        verify(() => bridge.back()).called(1);
        expect(
          observer.popped,
          isNotEmpty,
          reason:
              'When the embedded PWA declines the back gesture, the native '
              'shell must fall back to Navigator.maybePop().',
        );
      },
    );
  });

  testWidgets(
    'AppBar LinearProgressIndicator shows on partial progress and hides at 100',
    (tester) async {
      // bd remote-dev-72dh: WebViewFactory exposes an onProgressChanged hook
      // that drives a thin progress bar at the AppBar bottom. Partial values
      // render the indicator; 100 hides it.
      final originalOnError = FlutterError.onError;
      FlutterError.onError = (details) {
        if (details.exceptionAsString().contains('InAppWebViewPlatform')) {
          return;
        }
        originalOnError?.call(details);
      };
      addTearDown(() => FlutterError.onError = originalOnError);

      // After the FutureBuilder gate, the WebView only mounts once the
      // seed future resolves. Stub credentials + seeder so it resolves
      // immediately under flutter_test (real platform plugins missing).
      final credentials = _fastCredentials();
      final seeder = _fastSeeder();
      final factory = _ChannelWebViewFactory();

      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            activeWorkspaceProvider.overrideWith((ref) async => _conn()),
            mobileCredentialsStoreProvider.overrideWithValue(credentials),
            webViewCookieSeederProvider.overrideWithValue(seeder),
          ],
          child: MaterialApp(
            home: ChannelScreen(
              channelId: 'c-progress',
              webViewFactory: factory,
            ),
          ),
        ),
      );
      // Flush the active-server FutureProvider microtasks so `build` runs.
      for (var i = 0; i < 5; i++) {
        await tester.pump(const Duration(milliseconds: 16));
      }

      // Initial: progress=100 → no indicator.
      expect(find.byType(LinearProgressIndicator), findsNothing);
      expect(factory.capturedOnProgressChanged, isNotNull);

      // Partial progress event → indicator appears with the Tokyo Night blue.
      factory.capturedOnProgressChanged!(60);
      await tester.pump();
      final indicators = tester.widgetList<LinearProgressIndicator>(
        find.byType(LinearProgressIndicator),
      );
      expect(indicators, hasLength(1));
      expect(indicators.first.value, closeTo(0.6, 1e-9));
      expect(indicators.first.color, equals(const Color(0xFF7AA2F7)));

      // Completion → indicator hides.
      factory.capturedOnProgressChanged!(100);
      await tester.pump();
      expect(find.byType(LinearProgressIndicator), findsNothing);
    },
  );

  testWidgets(
    'shows fallback "Channel" before list resolves, then "#name" after',
    (tester) async {
      // Cold start: deep-link arrives before the channels list has resolved.
      // The AppBar must show the generic fallback while loading, then upgrade
      // to "#<name>" once the list completes — without remounting the WebView.
      final completer = Completer<List<Channel>>();
      final api = _DelayedChannelsApi(completer.future);

      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            channelsApiProvider.overrideWithValue(api),
            preferencesApiProvider.overrideWithValue(_StaticPreferencesApi()),
          ],
          child: const MaterialApp(
            home: ChannelScreen(channelId: 'random'),
          ),
        ),
      );

      // One frame — provider is in loading state, fallback should be visible.
      // We deliberately do NOT pumpAndSettle: InAppWebView never settles.
      await tester.pump();
      expect(find.text('Channel'), findsAtLeast(1));
      expect(find.text('#random'), findsNothing);

      // Resolve the list and let the title rebuild.
      completer.complete(const [Channel(id: 'random', name: 'random')]);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 1));
      await tester.pump();

      expect(find.text('#random'), findsOneWidget);
    },
  );
}

/// Mock [BridgeController] whose `back()` future the test controls per-case.
///
/// We pass `null` for the controller because we never call into the real
/// `InAppWebViewController` from this mock — every BridgeController method
/// we care about (`back`) is stubbed via mocktail's `noSuchMethod`. The
/// `super` constructor needs a non-null value, so we hand it a `Mock`
/// stand-in.
class _MockBridge extends Mock implements BridgeController {}

/// Captures `didPop` events so the test can assert whether the native
/// route actually popped after the user tapped the AppBar back button.
class _PopObserver extends NavigatorObserver {
  final List<Route<dynamic>> popped = [];

  @override
  void didPop(Route<dynamic> route, Route<dynamic>? previousRoute) {
    popped.add(route);
    super.didPop(route, previousRoute);
  }
}

/// Lets the test push a [ChannelScreen] onto the [Navigator] stack so a
/// subsequent `Navigator.maybePop()` has somewhere to go (an empty stack
/// no-ops the pop, which would mask the assertion under test).
class _RootProbe extends StatefulWidget {
  const _RootProbe();
  @override
  State<_RootProbe> createState() => _RootProbeState();
}

class _RootProbeState extends State<_RootProbe> {
  void pushChannel() {
    Navigator.of(context).pushNamed('/channel');
  }

  @override
  Widget build(BuildContext context) {
    return const Scaffold(body: SizedBox.shrink());
  }
}
