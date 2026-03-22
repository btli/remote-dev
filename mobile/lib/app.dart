import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'package:remote_dev/presentation/providers/providers.dart';
import 'package:remote_dev/presentation/providers/push_notification_providers.dart';
import 'package:remote_dev/presentation/screens/auth/login_screen.dart';
import 'package:remote_dev/presentation/screens/home/terminal_home_screen.dart';
import 'package:remote_dev/presentation/screens/server/add_server_screen.dart';
import 'package:remote_dev/presentation/screens/session/terminal_screen.dart';
import 'package:remote_dev/presentation/screens/settings/settings_screen.dart';
import 'package:remote_dev/presentation/theme/app_theme.dart';

class _RouterRefreshNotifier extends ChangeNotifier {
  void notify() => notifyListeners();
}

final routerProvider = Provider<GoRouter>((ref) {
  final refreshNotifier = _RouterRefreshNotifier();

  ref.listen(authNotifierProvider, (_, __) => refreshNotifier.notify());
  ref.listen(serverListProvider, (_, __) => refreshNotifier.notify());
  ref.listen(activeServerIdProvider, (_, __) => refreshNotifier.notify());

  return GoRouter(
    initialLocation: '/sessions',
    refreshListenable: refreshNotifier,
    redirect: (context, state) {
      final authState = ref.read(authNotifierProvider);
      final hasServers = ref.read(serverListProvider).isNotEmpty;
      final location = state.matchedLocation;
      final isOnLogin = location == '/login';
      final isOnSetup = location == '/servers/add';

      // No servers → setup
      if (!hasServers && !isOnSetup) return '/servers/add';
      // Let setup screen stay
      if (isOnSetup) return null;

      return switch (authState) {
        AuthLoading() => null,
        // Unauthenticated → login (has servers but no credentials)
        Unauthenticated() => isOnLogin ? null : '/login',
        // Authenticated → home (redirect away from login)
        Authenticated() => isOnLogin ? '/sessions' : null,
      };
    },
    routes: [
      GoRoute(
        path: '/login',
        builder: (context, state) => const LoginScreen(),
      ),
      GoRoute(
        path: '/servers/add',
        builder: (context, state) => const AddServerScreen(),
      ),
      // TerminalHomeScreen wraps session routes
      ShellRoute(
        builder: (context, state, child) => TerminalHomeScreen(child: child),
        routes: [
          GoRoute(
            path: '/sessions',
            builder: (context, state) => const _EmptySessionPlaceholder(),
          ),
          GoRoute(
            path: '/sessions/:id',
            builder: (context, state) {
              final id = state.pathParameters['id']!;
              return TerminalScreen(key: ValueKey(id), sessionId: id);
            },
          ),
        ],
      ),
      GoRoute(
        path: '/settings',
        builder: (context, state) => const SettingsScreen(),
      ),
      GoRoute(
        path: '/servers',
        builder: (context, state) => const SettingsScreen(),
      ),
    ],
  );
});

/// Transparent placeholder — TerminalHomeScreen shows its own empty state
/// when this is the child (no active session selected).
class _EmptySessionPlaceholder extends StatelessWidget {
  const _EmptySessionPlaceholder();

  @override
  Widget build(BuildContext context) => const SizedBox.shrink();
}

/// Root application widget.
class RemoteDevApp extends ConsumerWidget {
  const RemoteDevApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final palette = ref.watch(terminalPaletteProvider);
    final router = ref.watch(routerProvider);
    ref.watch(pushRegistrationProvider);

    return MaterialApp.router(
      title: 'Remote Dev',
      darkTheme: AppTheme.fromPalette(palette),
      themeMode: ThemeMode.dark,
      debugShowCheckedModeBanner: false,
      routerConfig: router,
    );
  }
}
