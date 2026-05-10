import 'package:flutter/material.dart';
import 'package:flutter_inappwebview/flutter_inappwebview.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:remote_dev/application/ports/server_config_store.dart';
import 'package:remote_dev/domain/server_config.dart';
import 'package:remote_dev/infrastructure/webview/navigation_policy.dart';
import 'package:remote_dev/infrastructure/webview/webview_factory.dart';
import 'package:remote_dev/presentation/screens/recording/recording_screen.dart';
import 'package:remote_dev/presentation/screens/webview_host/session_route_host.dart'
    show serverConfigStoreProvider;

class _MockStore extends Mock implements ServerConfigStore {}

/// Fake WebViewFactory that records what it was asked to build and
/// returns a `SizedBox` so the unit test runner doesn't need to host a
/// real `InAppWebView` (its platform channels aren't available under
/// flutter_test).
class _RecordingWebViewFactory implements WebViewFactory {
  Uri? capturedUrl;
  NavigationPolicy? capturedPolicy;

  @override
  InAppWebView build({
    required Uri initialUrl,
    required NavigationPolicy policy,
    required OnLinkOpen onLinkOpen,
    void Function(InAppWebViewController controller)? onWebViewCreated,
    void Function(InAppWebViewController controller, WebUri? url)? onLoadStop,
  }) {
    capturedUrl = initialUrl;
    capturedPolicy = policy;
    // We can't return a real InAppWebView from a fake without the platform
    // channel, but we _can_ return a stub one — flutter_test never paints
    // its platform view, and the assertions below run before any pump that
    // would force creation. Use SizedBox via a wrapper — but the build
    // method's return type is InAppWebView. Constructing one with a bogus
    // URL won't error in widget tests because the platform plugin is never
    // initialized; the widget tree just won't lay out the native side.
    return InAppWebView(
      initialUrlRequest: URLRequest(url: WebUri(initialUrl.toString())),
    );
  }
}

ServerConfig _config({
  String id = 'srv-1',
  String url = 'https://dev.example.com',
}) =>
    ServerConfig(
      id: id,
      label: 'Work',
      url: url,
      lastUsedAt: DateTime.utc(2025, 1, 1),
    );

void main() {
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

      final store = _MockStore();
      when(store.loadActive).thenAnswer(
        (_) async => _config(url: 'https://dev.example.com'),
      );
      final factory = _RecordingWebViewFactory();

      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            serverConfigStoreProvider.overrideWithValue(store),
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
        factory.capturedPolicy!.decide(Uri.parse('https://accounts.google.com/')),
        equals(NavigationDecision.interceptAndOpenExternally),
        reason:
            'Recording WebView should use the strict NavigationPolicy '
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
}
