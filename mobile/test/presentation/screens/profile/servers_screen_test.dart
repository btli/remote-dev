import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mocktail/mocktail.dart';
import 'package:remote_dev/application/ports/server_config_store.dart';
import 'package:remote_dev/domain/server_config.dart';
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

  // Codex review on remote-dev-w5f5: tapping a row used to call
  // `context.go('/home')`, which nukes the Profile tab back stack. Behavior
  // now: setActive(serverId) is called and the route is popped back to
  // whatever pushed us (here: the synthetic `/profile` root). We use a real
  // GoRouter so `context.canPop()` returns true and the pop branch is taken.
  testWidgets(
    'tapping a server activates it and pops back to the previous route',
    (tester) async {
      final store = _MockStore();
      final server = ServerConfig(
        id: 'srv-1',
        label: 'Prod',
        url: 'https://prod.example.com',
        lastUsedAt: DateTime.utc(2026, 1, 1),
      );
      when(store.loadAll).thenAnswer((_) async => [server]);
      when(() => store.setActive(any())).thenAnswer((_) async {});

      final router = GoRouter(
        initialLocation: '/profile',
        routes: [
          GoRoute(
            path: '/profile',
            builder: (context, _) => Scaffold(
              appBar: AppBar(title: const Text('profile-root')),
              body: Center(
                child: ElevatedButton(
                  onPressed: () => context.push('/profile/servers'),
                  child: const Text('open-servers'),
                ),
              ),
            ),
            routes: [
              GoRoute(
                path: 'servers',
                builder: (_, __) => const ServersScreen(),
              ),
            ],
          ),
          // /home target included so that, if our pop logic ever regresses
          // to context.go('/home'), the test would still navigate somewhere
          // valid — but the assertion below proves we did NOT take that path.
          GoRoute(
            path: '/home',
            builder: (_, __) => const Scaffold(body: Text('home-root')),
          ),
        ],
      );

      await tester.pumpWidget(
        ProviderScope(
          overrides: [serverConfigStoreProvider.overrideWithValue(store)],
          child: MaterialApp.router(routerConfig: router),
        ),
      );
      await tester.pumpAndSettle();

      // Push the Servers screen onto the stack the way the real Profile tab
      // does (`context.push`).
      await tester.tap(find.text('open-servers'));
      await tester.pumpAndSettle();
      expect(find.text('Servers'), findsOneWidget);
      expect(find.text('Prod'), findsOneWidget);

      // Tap the row.
      await tester.tap(find.text('Prod'));
      await tester.pumpAndSettle();

      // setActive was invoked with the server's id.
      verify(() => store.setActive('srv-1')).called(1);

      // We popped back to /profile, not navigated to /home.
      expect(find.text('open-servers'), findsOneWidget);
      expect(find.text('home-root'), findsNothing);
    },
  );

  // Sanity check for the canPop=false fallback: when ServersScreen is the
  // initial route there is nothing to pop, so onSelect should fall back to
  // `context.go('/home')`.
  testWidgets(
    'tapping a server falls back to /home when canPop is false',
    (tester) async {
      final store = _MockStore();
      final server = ServerConfig(
        id: 'srv-2',
        label: 'Staging',
        url: 'https://staging.example.com',
        lastUsedAt: DateTime.utc(2026, 1, 1),
      );
      when(store.loadAll).thenAnswer((_) async => [server]);
      when(() => store.setActive(any())).thenAnswer((_) async {});

      final router = GoRouter(
        initialLocation: '/servers',
        routes: [
          GoRoute(
            path: '/servers',
            builder: (_, __) => const ServersScreen(),
          ),
          GoRoute(
            path: '/home',
            builder: (_, __) => const Scaffold(body: Text('home-root')),
          ),
        ],
      );

      await tester.pumpWidget(
        ProviderScope(
          overrides: [serverConfigStoreProvider.overrideWithValue(store)],
          child: MaterialApp.router(routerConfig: router),
        ),
      );
      await tester.pumpAndSettle();

      await tester.tap(find.text('Staging'));
      await tester.pumpAndSettle();

      verify(() => store.setActive('srv-2')).called(1);
      expect(find.text('home-root'), findsOneWidget);
    },
  );
}
