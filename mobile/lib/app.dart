import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'package:remote_dev/presentation/providers/providers.dart';
import 'package:remote_dev/presentation/screens/auth/login_screen.dart';
import 'package:remote_dev/presentation/screens/home/home_screen.dart';
import 'package:remote_dev/presentation/screens/session/terminal_screen.dart';
import 'package:remote_dev/presentation/screens/settings/settings_screen.dart';
import 'package:remote_dev/presentation/theme/app_theme.dart';

/// GoRouter configuration with auth-based redirects.
final routerProvider = Provider<GoRouter>((ref) {
  final authState = ref.watch(authNotifierProvider);

  return GoRouter(
    initialLocation: '/login',
    redirect: (context, state) {
      final isOnLogin = state.matchedLocation == '/login';

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
        path: '/sessions',
        builder: (context, state) => const HomeScreen(),
      ),
      GoRoute(
        path: '/sessions/:id',
        builder: (context, state) => TerminalScreen(
          sessionId: state.pathParameters['id']!,
        ),
      ),
      GoRoute(
        path: '/settings',
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
    final theme = AppTheme.fromPalette(palette);
    final router = ref.watch(routerProvider);

    return MaterialApp.router(
      title: 'Remote Dev',
      theme: theme,
      darkTheme: theme,
      themeMode: ThemeMode.dark,
      debugShowCheckedModeBanner: false,
      routerConfig: router,
    );
  }
}
