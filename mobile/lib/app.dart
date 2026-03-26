import 'dart:async';

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
///
/// Listens for `remotedev://auth/callback` deep links via the shared
/// [deepLinkStreamProvider] so that automatic CF Access token refresh
/// can complete even when the login screen is not mounted. When the
/// [CfTokenRefreshService] has an active refresh in progress, the deep
/// link is routed there. Otherwise the link is ignored here (the login
/// screen subscribes to the same broadcast stream for initial auth).
class RemoteDevApp extends ConsumerStatefulWidget {
  const RemoteDevApp({super.key});

  @override
  ConsumerState<RemoteDevApp> createState() => _RemoteDevAppState();
}

class _RemoteDevAppState extends ConsumerState<RemoteDevApp> {
  StreamSubscription<Uri>? _deepLinkSub;

  @override
  void initState() {
    super.initState();
    // Defer subscription until after the first build so that
    // ref.read is safe and the provider container is fully wired.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      final stream = ref.read(deepLinkStreamProvider);
      _deepLinkSub = stream.listen(_handleDeepLink);
    });
  }

  Future<void> _handleDeepLink(Uri uri) async {
    if (uri.scheme != 'remotedev' ||
        uri.host != 'auth' ||
        uri.path != '/callback') {
      return;
    }

    final refreshService = ref.read(cfTokenRefreshServiceProvider);

    // Only intercept the deep link when a token refresh is in progress.
    // If no refresh is active, the login screen's own listener handles it.
    if (refreshService == null || !refreshService.isRefreshing) return;

    await refreshService.handleDeepLink(uri);

    // After credentials are refreshed, invalidate data providers so the
    // UI refetches with the new token.
    ref.invalidate(sessionListProvider);
    ref.invalidate(folderListProvider);
  }

  @override
  void dispose() {
    _deepLinkSub?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
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
