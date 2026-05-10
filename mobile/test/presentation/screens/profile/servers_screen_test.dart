import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:remote_dev/application/ports/server_config_store.dart';
import 'package:remote_dev/presentation/screens/profile/servers_screen.dart';
import 'package:remote_dev/presentation/screens/webview_host/session_route_host.dart'
    show serverConfigStoreProvider;

class _MockStore extends Mock implements ServerConfigStore {}

void main() {
  // The profile-tab Servers entry now reuses ServerPickerScreen, so we just
  // smoke-test that the screen mounts and surfaces the picker's empty state.
  testWidgets(
    'ServersScreen mounts the server picker (empty state)',
    (tester) async {
      final store = _MockStore();
      when(store.loadAll).thenAnswer((_) async => const []);

      await tester.pumpWidget(
        ProviderScope(
          overrides: [serverConfigStoreProvider.overrideWithValue(store)],
          child: const MaterialApp(home: ServersScreen()),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('Servers'), findsOneWidget);
      expect(find.text('No servers yet.'), findsOneWidget);
      expect(find.text('Add a server'), findsOneWidget);
    },
  );
}
