import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:remote_dev/application/ports/server_config_store.dart';
import 'package:remote_dev/domain/server_config.dart';
import 'package:remote_dev/infrastructure/storage/flutter_secure_storage_port.dart';
import 'package:remote_dev/presentation/screens/webview_host/reauth_screen.dart';
import 'package:remote_dev/presentation/screens/webview_host/session_route_host.dart'
    show secureStorageProvider, serverConfigStoreProvider;

class _MockStore extends Mock implements ServerConfigStore {}

class _FakeStorage extends Fake implements FlutterSecureStoragePort {
  final Map<String, String> writes = <String, String>{};

  @override
  Future<void> write(String serverId, String key, String value) async {
    writes['$serverId/$key'] = value;
  }
}

ServerConfig _config({String id = 'srv-1', String url = 'https://dev.example.com'}) =>
    ServerConfig(
      id: id,
      label: 'Work',
      url: url,
      lastUsedAt: DateTime.utc(2025, 1, 1),
    );

void main() {
  Future<void> pumpReauth(
    WidgetTester tester, {
    required _MockStore store,
    _FakeStorage? storage,
    VoidCallback? onSuccess,
    VoidCallback? onCancel,
    Widget Function({
      required Uri serverUrl,
      required void Function(String cookieValue) onSuccess,
      required VoidCallback onCancel,
    })? cfLoginLauncherOverride,
  }) {
    return tester.pumpWidget(
      ProviderScope(
        overrides: [
          serverConfigStoreProvider.overrideWithValue(store),
          if (storage != null)
            secureStorageProvider.overrideWithValue(storage),
        ],
        child: MaterialApp(
          home: ReauthScreen(
            onSuccess: onSuccess ?? () {},
            onCancel: onCancel ?? () {},
            cfLoginLauncherOverride: cfLoginLauncherOverride,
          ),
        ),
      ),
    );
  }

  testWidgets(
    'renders no-active-server panel when activeServerProvider has no server',
    (tester) async {
      final store = _MockStore();
      when(store.loadActive).thenAnswer((_) async => null);

      var cancelled = 0;
      await pumpReauth(
        tester,
        store: store,
        onCancel: () => cancelled++,
      );
      await tester.pumpAndSettle();

      expect(find.text('No active server'), findsOneWidget);
      // Tapping the CTA invokes onCancel.
      await tester.tap(find.widgetWithText(ElevatedButton, 'Choose a server'));
      await tester.pump();
      expect(cancelled, 1);
    },
  );

  testWidgets(
    'embeds CF login WebView when an active server is present',
    (tester) async {
      final store = _MockStore();
      when(store.loadActive).thenAnswer((_) async => _config());

      Uri? capturedUrl;
      await pumpReauth(
        tester,
        store: store,
        cfLoginLauncherOverride: ({
          required Uri serverUrl,
          required void Function(String) onSuccess,
          required VoidCallback onCancel,
        }) {
          capturedUrl = serverUrl;
          return const _FakeWebView();
        },
      );
      await tester.pumpAndSettle();

      expect(find.byType(_FakeWebView), findsOneWidget);
      expect(capturedUrl, Uri.parse('https://dev.example.com'));
      // The "no active server" UI should NOT be shown.
      expect(find.text('No active server'), findsNothing);
    },
  );

  testWidgets(
    'on CF login success, persists cookie under cf_authorization and calls onSuccess',
    (tester) async {
      final store = _MockStore();
      final storage = _FakeStorage();
      when(store.loadActive).thenAnswer((_) async => _config(id: 'srv-42'));

      var successCount = 0;
      late void Function(String) capturedOnSuccess;
      await pumpReauth(
        tester,
        store: store,
        storage: storage,
        onSuccess: () => successCount++,
        cfLoginLauncherOverride: ({
          required Uri serverUrl,
          required void Function(String) onSuccess,
          required VoidCallback onCancel,
        }) {
          capturedOnSuccess = onSuccess;
          return const _FakeWebView();
        },
      );
      await tester.pumpAndSettle();

      // Simulate the WebView harvesting a fresh cookie.
      capturedOnSuccess('fresh-jwt');
      // Allow the async write + onSuccess callback to complete.
      await tester.pumpAndSettle();

      expect(storage.writes['srv-42/cf_authorization'], 'fresh-jwt');
      expect(successCount, 1);
    },
  );

  testWidgets(
    'on CF login cancel, propagates to onCancel without writing storage',
    (tester) async {
      final store = _MockStore();
      final storage = _FakeStorage();
      when(store.loadActive).thenAnswer((_) async => _config());

      var cancelled = 0;
      late VoidCallback capturedOnCancel;
      await pumpReauth(
        tester,
        store: store,
        storage: storage,
        onCancel: () => cancelled++,
        cfLoginLauncherOverride: ({
          required Uri serverUrl,
          required void Function(String) onSuccess,
          required VoidCallback onCancel,
        }) {
          capturedOnCancel = onCancel;
          return const _FakeWebView();
        },
      );
      await tester.pumpAndSettle();

      capturedOnCancel();
      await tester.pumpAndSettle();

      expect(cancelled, 1);
      expect(storage.writes, isEmpty);
    },
  );
}

class _FakeWebView extends StatelessWidget {
  const _FakeWebView();

  @override
  Widget build(BuildContext context) {
    return const Scaffold(
      backgroundColor: Color(0xFF1A1B26),
      body: Center(child: Text('fake-webview')),
    );
  }
}
