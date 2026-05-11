import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:remote_dev/application/ports/secure_storage_port.dart';
import 'package:remote_dev/application/ports/server_config_store.dart';
import 'package:remote_dev/domain/server_config.dart';
import 'package:remote_dev/infrastructure/auth/mobile_credentials.dart';
import 'package:remote_dev/presentation/screens/server_picker/add_server_screen.dart';
import 'package:remote_dev/presentation/screens/webview_host/session_route_host.dart'
    show mobileCredentialsStoreProvider, serverConfigStoreProvider;

class _MockStore extends Mock implements ServerConfigStore {}

class _FakeServerConfig extends Fake implements ServerConfig {}

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

void main() {
  setUpAll(() {
    registerFallbackValue(_FakeServerConfig());
  });

  Future<void> pumpAddServer(
    WidgetTester tester, {
    required _MockStore store,
    required Future<bool> Function(String) probe,
    required MobileCallbackLauncher callbackLauncher,
    _FakeStorage? storage,
    void Function(ServerConfig)? onSaved,
  }) {
    final storeForCreds = storage ?? _FakeStorage();
    return tester.pumpWidget(
      ProviderScope(
        overrides: [
          serverConfigStoreProvider.overrideWithValue(store),
          mobileCredentialsStoreProvider
              .overrideWithValue(MobileCredentialsStore(storeForCreds)),
        ],
        child: MaterialApp(
          home: AddServerScreen(
            onSaved: onSaved ?? (_) {},
            healthProbeOverride: probe,
            mobileCallbackLauncher: callbackLauncher,
          ),
        ),
      ),
    );
  }

  testWidgets(
    'happy path: probe true, callback returns creds, server upserted + creds saved',
    (tester) async {
      final store = _MockStore();
      final storage = _FakeStorage();
      when(() => store.upsert(any())).thenAnswer((_) async {});
      when(() => store.setActive(any())).thenAnswer((_) async {});
      when(store.loadAll).thenAnswer((_) async => const []);

      ServerConfig? saved;
      Uri? capturedLoginUrl;
      await pumpAddServer(
        tester,
        store: store,
        storage: storage,
        probe: (_) async => true,
        callbackLauncher: (url) async {
          capturedLoginUrl = url;
          return const MobileCredentials(
            apiKey: 'sk-abc',
            cfToken: 'jwt-token',
            userId: 'u1',
            email: 'a@b.com',
          );
        },
        onSaved: (cfg) => saved = cfg,
      );

      await tester.enterText(
        find.widgetWithText(TextFormField, 'Server URL'),
        'https://dev.example.com',
      );
      await tester.enterText(
        find.widgetWithText(TextFormField, 'Label'),
        'Work',
      );
      await tester.tap(find.widgetWithText(ElevatedButton, 'Save'));
      await tester.pumpAndSettle();

      verify(() => store.upsert(any())).called(1);
      verify(() => store.setActive(any())).called(1);
      expect(saved, isNotNull);
      expect(saved!.label, 'Work');
      expect(saved!.url, 'https://dev.example.com');
      expect(capturedLoginUrl, Uri.parse('https://dev.example.com'));
      // Credentials persisted under the new server's id.
      expect(storage.data['server.${saved!.id}.api_key'], 'sk-abc');
      expect(storage.data['server.${saved!.id}.cf_token'], 'jwt-token');
      // Legacy key mirrored for back-compat.
      expect(
        storage.data['server.${saved!.id}.cf_authorization'],
        'jwt-token',
      );
      expect(storage.data['server.${saved!.id}.user_id'], 'u1');
      expect(storage.data['server.${saved!.id}.user_email'], 'a@b.com');
    },
  );

  testWidgets(
    'callback cancelled: server is NOT saved and we surface the cancellation',
    (tester) async {
      final store = _MockStore();
      final storage = _FakeStorage();
      when(() => store.upsert(any())).thenAnswer((_) async {});
      when(() => store.setActive(any())).thenAnswer((_) async {});

      ServerConfig? saved;
      await pumpAddServer(
        tester,
        store: store,
        storage: storage,
        probe: (_) async => true,
        callbackLauncher: (_) async => null,
        onSaved: (cfg) => saved = cfg,
      );

      await tester.enterText(
        find.widgetWithText(TextFormField, 'Server URL'),
        'https://dev.example.com',
      );
      await tester.enterText(
        find.widgetWithText(TextFormField, 'Label'),
        'Work',
      );
      await tester.tap(find.widgetWithText(ElevatedButton, 'Save'));
      await tester.pumpAndSettle();

      verifyNever(() => store.upsert(any()));
      verifyNever(() => store.setActive(any()));
      expect(saved, isNull);
      expect(storage.data, isEmpty);
      expect(find.text('Sign-in cancelled.'), findsOneWidget);
    },
  );

  testWidgets(
    'invalid URL fails form validation before probing or launching callback',
    (tester) async {
      final store = _MockStore();
      var probeCalls = 0;
      var callbackCalls = 0;

      await pumpAddServer(
        tester,
        store: store,
        probe: (_) async {
          probeCalls += 1;
          return true;
        },
        callbackLauncher: (_) async {
          callbackCalls += 1;
          return const MobileCredentials(apiKey: 'k');
        },
      );

      await tester.enterText(
        find.widgetWithText(TextFormField, 'Server URL'),
        'not-a-url',
      );
      await tester.enterText(
        find.widgetWithText(TextFormField, 'Label'),
        'Work',
      );
      await tester.tap(find.widgetWithText(ElevatedButton, 'Save'));
      await tester.pumpAndSettle();

      expect(
        find.text('Enter a valid URL with scheme and host'),
        findsOneWidget,
      );
      expect(probeCalls, 0);
      expect(callbackCalls, 0);
      verifyNever(() => store.upsert(any()));
    },
  );
}
