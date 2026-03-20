import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'package:remote_dev/presentation/screens/auth/login_screen.dart';
import 'package:remote_dev/presentation/theme/app_theme.dart';
import 'package:remote_dev/presentation/theme/terminal_theme.dart';

/// Root application widget.
class RemoteDevApp extends ConsumerWidget {
  const RemoteDevApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // TODO: Watch appearance provider for dynamic theme updates
    final theme = AppTheme.fromPalette(TerminalPalette.defaultDark);

    return MaterialApp.router(
      title: 'Remote Dev',
      theme: theme,
      darkTheme: theme,
      themeMode: ThemeMode.dark,
      debugShowCheckedModeBanner: false,
      routerConfig: _router,
    );
  }
}

final _router = GoRouter(
  initialLocation: '/login',
  routes: [
    GoRoute(
      path: '/login',
      builder: (context, state) => const LoginScreen(),
    ),
  ],
);
