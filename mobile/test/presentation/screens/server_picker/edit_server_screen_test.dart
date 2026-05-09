import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:remote_dev/application/ports/server_config_store.dart';
import 'package:remote_dev/domain/server_config.dart';
import 'package:remote_dev/presentation/screens/server_picker/edit_server_screen.dart';
import 'package:remote_dev/presentation/screens/webview_host/session_route_host.dart'
    show serverConfigStoreProvider;

class _MockStore extends Mock implements ServerConfigStore {}

class _FakeServerConfig extends Fake implements ServerConfig {}

void main() {
  setUpAll(() {
    registerFallbackValue(_FakeServerConfig());
  });

  final initial = ServerConfig(
    id: 'srv-1',
    label: 'Work',
    url: 'https://dev.example.com',
    lastUsedAt: DateTime(2026, 5, 1),
  );

  testWidgets('pre-fills the form from the initial config', (tester) async {
    final store = _MockStore();

    await tester.pumpWidget(
      ProviderScope(
        overrides: [serverConfigStoreProvider.overrideWithValue(store)],
        child: MaterialApp(
          home: EditServerScreen(
            initial: initial,
            onSaved: (_) {},
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Work'), findsOneWidget);
    // URL appears twice: in the form field AND in the AppBar title (or
    // similar — depending on EditServerScreen's layout). findsAtLeast
    // is enough to confirm it's pre-filled.
    expect(find.text('https://dev.example.com'), findsAtLeast(1));
  });

  testWidgets(
    'save calls upsert with edited values, preserves id, bumps lastUsedAt',
    (tester) async {
      final store = _MockStore();
      when(() => store.upsert(any())).thenAnswer((_) async {});

      ServerConfig? saved;
      await tester.pumpWidget(
        ProviderScope(
          overrides: [serverConfigStoreProvider.overrideWithValue(store)],
          child: MaterialApp(
            home: EditServerScreen(
              initial: initial,
              onSaved: (cfg) => saved = cfg,
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();

      // Find the label field (which currently has 'Work'), clear and re-enter.
      final labelField = find.widgetWithText(TextFormField, 'Label');
      await tester.enterText(labelField, 'Work (renamed)');
      await tester.tap(find.widgetWithText(ElevatedButton, 'Save'));
      await tester.pumpAndSettle();

      final captured = verify(() => store.upsert(captureAny())).captured;
      expect(captured, hasLength(1));
      final updated = captured.single as ServerConfig;
      expect(updated.id, 'srv-1');
      expect(updated.label, 'Work (renamed)');
      expect(updated.url, 'https://dev.example.com');
      expect(updated.lastUsedAt.isAfter(initial.lastUsedAt), isTrue);

      expect(saved, isNotNull);
      expect(saved!.label, 'Work (renamed)');
    },
  );

  testWidgets(
    'invalid URL keeps form open and does not call upsert',
    (tester) async {
      final store = _MockStore();

      await tester.pumpWidget(
        ProviderScope(
          overrides: [serverConfigStoreProvider.overrideWithValue(store)],
          child: MaterialApp(
            home: EditServerScreen(
              initial: initial,
              onSaved: (_) {},
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();

      await tester.enterText(
        find.widgetWithText(TextFormField, 'Server URL'),
        'not-a-url',
      );
      await tester.tap(find.widgetWithText(ElevatedButton, 'Save'));
      await tester.pumpAndSettle();

      expect(
        find.text('Enter a valid URL with scheme and host'),
        findsOneWidget,
      );
      verifyNever(() => store.upsert(any()));
    },
  );
}
