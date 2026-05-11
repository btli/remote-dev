import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:remote_dev/application/ports/secure_storage_port.dart';
import 'package:remote_dev/application/ports/server_config_store.dart';
import 'package:remote_dev/domain/server_config.dart';
import 'package:remote_dev/infrastructure/auth/mobile_credentials.dart';
import 'package:remote_dev/presentation/screens/webview_host/reauth_screen.dart';
import 'package:remote_dev/presentation/screens/webview_host/session_route_host.dart'
    show mobileCredentialsStoreProvider, serverConfigStoreProvider;

class _MockStore extends Mock implements ServerConfigStore {}

class _FakeStorage implements SecureStoragePort {
  final Map<String, String?> data = <String, String?>{};

  String _key(String serverId, String key) => 'server.$serverId.$key';

  @override
  Future<String?> read(String serverId, String key) async =>
      data[_key(serverId, key)];

  @override
  Future<void> write(String serverId, String key, String value) async {
    data[_key(serverId, key)] = value;
  }

  @override
  Future<void> delete(String serverId, String key) async {
    data.remove(_key(serverId, key));
  }

  @override
  Future<void> deleteAll(String serverId) async {
    data.removeWhere((k, _) => k.startsWith('server.$serverId.'));
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
  Future<void> pumpReauth(
    WidgetTester tester, {
    required _MockStore store,
    _FakeStorage? storage,
    VoidCallback? onSuccess,
    VoidCallback? onCancel,
    MobileCallbackLauncherForReauth? launcherOverride,
  }) {
    final s = storage ?? _FakeStorage();
    return tester.pumpWidget(
      ProviderScope(
        overrides: [
          serverConfigStoreProvider.overrideWithValue(store),
          mobileCredentialsStoreProvider
              .overrideWithValue(MobileCredentialsStore(s)),
        ],
        child: MaterialApp(
          home: ReauthScreen(
            onSuccess: onSuccess ?? () {},
            onCancel: onCancel ?? () {},
            mobileCallbackLauncherOverride: launcherOverride,
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

  // Helper: pump a fixed number of frames to drive futures forward.
  // The screen renders a `CircularProgressIndicator` while the launcher
  // is in flight, so `pumpAndSettle` would never return — we drive
  // discrete frames instead.
  Future<void> drainFrames(WidgetTester tester) async {
    for (var i = 0; i < 10; i++) {
      await tester.pump(const Duration(milliseconds: 16));
    }
  }

  testWidgets(
    'on callback success, persists credentials and calls onSuccess',
    (tester) async {
      final store = _MockStore();
      final storage = _FakeStorage();
      when(store.loadActive).thenAnswer((_) async => _config(id: 'srv-42'));

      var successCount = 0;
      Uri? capturedUrl;
      await pumpReauth(
        tester,
        store: store,
        storage: storage,
        onSuccess: () => successCount++,
        launcherOverride: (serverUrl) async {
          capturedUrl = serverUrl;
          return const MobileCredentials(
            apiKey: 'sk-fresh',
            cfToken: 'fresh-jwt',
          );
        },
      );
      await drainFrames(tester);

      expect(capturedUrl, Uri.parse('https://dev.example.com'));
      expect(storage.data['server.srv-42.api_key'], 'sk-fresh');
      expect(storage.data['server.srv-42.cf_token'], 'fresh-jwt');
      expect(successCount, 1);
    },
  );

  testWidgets(
    'on callback cancel (null result), propagates to onCancel without writing',
    (tester) async {
      final store = _MockStore();
      final storage = _FakeStorage();
      when(store.loadActive).thenAnswer((_) async => _config());

      var cancelled = 0;
      await pumpReauth(
        tester,
        store: store,
        storage: storage,
        onCancel: () => cancelled++,
        launcherOverride: (_) async => null,
      );
      await drainFrames(tester);

      expect(cancelled, 1);
      expect(storage.data, isEmpty);
    },
  );
}
