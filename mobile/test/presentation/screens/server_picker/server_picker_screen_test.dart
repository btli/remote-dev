import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:remote_dev/application/ports/server_config_store.dart';
import 'package:remote_dev/domain/server_config.dart';
import 'package:remote_dev/presentation/screens/server_picker/server_picker_screen.dart';
import 'package:remote_dev/presentation/screens/webview_host/session_route_host.dart'
    show serverConfigStoreProvider;

class _MockStore extends Mock implements ServerConfigStore {}

void main() {
  testWidgets('empty state shows add CTA', (tester) async {
    final store = _MockStore();
    when(store.loadAll).thenAnswer((_) async => const []);

    await tester.pumpWidget(
      ProviderScope(
        overrides: [serverConfigStoreProvider.overrideWithValue(store)],
        child: MaterialApp(
          home: ServerPickerScreen(onSelect: (_) {}, onAdd: () {}),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('No servers yet.'), findsOneWidget);
    expect(find.text('Add a server'), findsOneWidget);
  });

  testWidgets('populated state shows the server list', (tester) async {
    final store = _MockStore();
    when(store.loadAll).thenAnswer(
      (_) async => [
        ServerConfig(
          id: 'a',
          label: 'Work',
          url: 'https://dev.example.com',
          lastUsedAt: DateTime(2026, 5, 8),
        ),
      ],
    );

    await tester.pumpWidget(
      ProviderScope(
        overrides: [serverConfigStoreProvider.overrideWithValue(store)],
        child: MaterialApp(
          home: ServerPickerScreen(onSelect: (_) {}, onAdd: () {}),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Work'), findsOneWidget);
    expect(find.text('https://dev.example.com'), findsOneWidget);
  });
}
