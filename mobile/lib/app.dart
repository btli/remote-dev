import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'package:remote_dev/presentation/providers/providers.dart';
import 'package:remote_dev/presentation/providers/push_notification_providers.dart';
import 'package:remote_dev/presentation/providers/server_config_providers.dart';
import 'package:remote_dev/presentation/screens/auth/login_screen.dart';
import 'package:remote_dev/presentation/screens/home/terminal_home_screen.dart';
import 'package:remote_dev/presentation/screens/server/add_server_screen.dart';
import 'package:remote_dev/presentation/screens/session/terminal_screen.dart';
import 'package:remote_dev/presentation/screens/settings/settings_screen.dart';
import 'package:remote_dev/presentation/theme/app_theme.dart';

/// Listenable that notifies GoRouter to re-evaluate redirects
/// without rebuilding the entire router instance.
class _RouterRefreshNotifier extends ChangeNotifier {
  void notify() => notifyListeners();
}

/// Single GoRouter instance — persists across state changes.
/// Uses refreshListenable to re-evaluate redirects reactively.
final routerProvider = Provider<GoRouter>((ref) {
  final refreshNotifier = _RouterRefreshNotifier();

  // Listen to auth and server changes, trigger redirect re-evaluation
  ref.listen(authNotifierProvider, (_, __) => refreshNotifier.notify());
  ref.listen(serverListProvider, (_, __) => refreshNotifier.notify());

  return GoRouter(
    initialLocation: '/sessions',
    refreshListenable: refreshNotifier,
    redirect: (context, state) {
      final authState = ref.read(authNotifierProvider);
      final hasServers = ref.read(serverListProvider).isNotEmpty;
      final location = state.matchedLocation;
      final isOnLogin = location == '/login';
      final isOnSetup = location == '/servers/add';

      if (!hasServers && !isOnSetup) return '/servers/add';
      if (isOnSetup) return null;

      return switch (authState) {
        AuthLoading() => null,
        Unauthenticated() => isOnLogin ? null : '/login',
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
      ShellRoute(
        builder: (context, state, child) => TerminalHomeScreen(child: child),
        routes: [
          GoRoute(
            path: '/sessions',
            builder: (context, state) => const SizedBox.shrink(),
          ),
          GoRoute(
            path: '/sessions/:id',
            builder: (context, state) => TerminalScreen(
              sessionId: state.pathParameters['id']!,
            ),
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
