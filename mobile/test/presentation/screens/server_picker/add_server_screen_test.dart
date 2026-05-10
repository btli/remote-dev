import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:remote_dev/application/ports/secure_storage_port.dart';
import 'package:remote_dev/application/ports/server_config_store.dart';
import 'package:remote_dev/domain/server_config.dart';
import 'package:remote_dev/infrastructure/storage/flutter_secure_storage_port.dart';
import 'package:remote_dev/presentation/screens/server_picker/add_server_screen.dart';
import 'package:remote_dev/presentation/screens/webview_host/session_route_host.dart'
    show secureStorageProvider, serverConfigStoreProvider;

class _MockStore extends Mock implements ServerConfigStore {}

class _FakeServerConfig extends Fake implements ServerConfig {}

class _FakeStorage extends Fake implements FlutterSecureStoragePort {
  final Map<String, String> writes = <String, String>{};

  @override
  Future<void> write(String serverId, String key, String value) async {
    writes['$serverId/$key'] = value;
  }

  // The other SecureStoragePort methods aren't exercised by these tests;
  // delegate to the abstract Fake error-on-call default by leaving them
  // unimplemented here.
}

void main() {
  setUpAll(() {
    registerFallbackValue(_FakeServerConfig());
  });

  Future<void> pumpAddServer(
    WidgetTester tester, {
    required _MockStore store,
    required Future<bool> Function(String) probe,
    required CfLoginLauncher cfLogin,
    SecureStoragePort? storage,
    void Function(ServerConfig)? onSaved,
  }) {
    return tester.pumpWidget(
      ProviderScope(
        overrides: [
          serverConfigStoreProvider.overrideWithValue(store),
          if (storage != null)
            secureStorageProvider.overrideWithValue(
              storage as FlutterSecureStoragePort,
            ),
        ],
        child: MaterialApp(
          home: AddServerScreen(
            onSaved: onSaved ?? (_) {},
            healthProbeOverride: probe,
            cfLoginLauncher: cfLogin,
          ),
        ),
      ),
    );
  }

  testWidgets(
    'happy path: probe true, CF login returns cookie, server upserted',
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
        cfLogin: (ctx, url) async {
          capturedLoginUrl = url;
          return 'jwt-token';
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
      // Cookie was persisted under the new server's id.
      expect(storage.writes['${saved!.id}/cf_authorization'], 'jwt-token');
    },
  );

  testWidgets(
    'CF login cancelled: server is NOT saved and we surface the cancellation',
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
        cfLogin: (_, __) async => null,
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
      expect(storage.writes, isEmpty);
      expect(find.text('Sign-in cancelled.'), findsOneWidget);
    },
  );

  testWidgets(
    'invalid URL fails form validation before probing or launching login',
    (tester) async {
      final store = _MockStore();
      var probeCalls = 0;
      var loginCalls = 0;

      await pumpAddServer(
        tester,
        store: store,
        probe: (_) async {
          probeCalls += 1;
          return true;
        },
        cfLogin: (_, __) async {
          loginCalls += 1;
          return 'jwt';
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
      expect(loginCalls, 0);
      verifyNever(() => store.upsert(any()));
    },
  );
}
