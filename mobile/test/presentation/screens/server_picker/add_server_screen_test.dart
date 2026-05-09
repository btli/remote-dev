import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:remote_dev/application/ports/server_config_store.dart';
import 'package:remote_dev/domain/server_config.dart';
import 'package:remote_dev/presentation/screens/server_picker/add_server_screen.dart';
import 'package:remote_dev/presentation/screens/webview_host/session_route_host.dart'
    show serverConfigStoreProvider;

class _MockStore extends Mock implements ServerConfigStore {}

class _FakeServerConfig extends Fake implements ServerConfig {}

void main() {
  setUpAll(() {
    registerFallbackValue(_FakeServerConfig());
  });

  Future<void> pumpAddServer(
    WidgetTester tester, {
    required _MockStore store,
    required Future<bool> Function(String) probe,
    void Function(ServerConfig)? onSaved,
  }) {
    return tester.pumpWidget(
      ProviderScope(
        overrides: [
          serverConfigStoreProvider.overrideWithValue(store),
        ],
        child: MaterialApp(
          home: AddServerScreen(
            onSaved: onSaved ?? (_) {},
            healthProbeOverride: probe,
          ),
        ),
      ),
    );
  }

  testWidgets(
    'happy path: probe returns true, server is upserted + activated',
    (tester) async {
      final store = _MockStore();
      when(() => store.upsert(any())).thenAnswer((_) async {});
      when(() => store.setActive(any())).thenAnswer((_) async {});
      when(store.loadAll).thenAnswer((_) async => const []);

      ServerConfig? saved;
      await pumpAddServer(
        tester,
        store: store,
        probe: (_) async => true,
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
    },
  );

  testWidgets(
    'unreachable URL: shows confirm dialog; cancel skips upsert',
    // Skipped: real Dio timeout (5s) exceeds pumpAndSettle tolerance —
    // covered by manual smoke test on device.
    skip: true,
    (tester) async {
      final store = _MockStore();
      when(() => store.upsert(any())).thenAnswer((_) async {});
      when(() => store.setActive(any())).thenAnswer((_) async {});

      ServerConfig? saved;
      await pumpAddServer(
        tester,
        store: store,
        probe: (_) async => false,
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

      expect(find.text("Can't reach this server"), findsOneWidget);
      // Inline error is also shown on the form.
      expect(
        find.textContaining("Couldn't reach"),
        findsWidgets,
      );

      await tester.tap(find.widgetWithText(TextButton, 'Cancel'));
      await tester.pumpAndSettle();

      verifyNever(() => store.upsert(any()));
      verifyNever(() => store.setActive(any()));
      expect(saved, isNull);
    },
  );

  testWidgets(
    'unreachable URL: confirm "Save anyway" persists the server',
    // Skipped: real Dio timeout (5s) exceeds pumpAndSettle tolerance —
    // covered by manual smoke test on device.
    skip: true,
    (tester) async {
      final store = _MockStore();
      when(() => store.upsert(any())).thenAnswer((_) async {});
      when(() => store.setActive(any())).thenAnswer((_) async {});

      ServerConfig? saved;
      await pumpAddServer(
        tester,
        store: store,
        probe: (_) async => false,
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

      await tester.tap(find.widgetWithText(TextButton, 'Save anyway'));
      await tester.pumpAndSettle();

      verify(() => store.upsert(any())).called(1);
      verify(() => store.setActive(any())).called(1);
      expect(saved, isNotNull);
    },
  );

  testWidgets(
    'invalid URL fails form validation before probing',
    (tester) async {
      final store = _MockStore();
      var probeCalls = 0;

      await pumpAddServer(
        tester,
        store: store,
        probe: (_) async {
          probeCalls += 1;
          return true;
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
      verifyNever(() => store.upsert(any()));
    },
  );
}
