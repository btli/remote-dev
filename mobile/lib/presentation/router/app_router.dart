import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../infrastructure/push/push_token_registrar.dart';
import '../screens/bridge_spike/bridge_spike_screen.dart';
import '../screens/server_picker/add_server_screen.dart';
import '../screens/server_picker/server_picker_screen.dart';
import '../screens/session_view/session_view_screen.dart';
import '../screens/shell/home_shell.dart';
import '../screens/webview_host/reauth_screen.dart';
import '../screens/webview_host/session_route_host.dart';
import 'app_route.dart';

/// FCM token registrar wired against the app's PushPort + ServerConfigStore +
/// API client factory. Default impl throws — `main.dart` overrides this in the
/// `ProviderScope` after Firebase is initialized (matching the
/// `sessionsApiProvider` pattern). The server picker reads it best-effort so
/// dev builds without Firebase config still allow server deletion.
final pushTokenRegistrarProvider = Provider<PushTokenRegistrar>((ref) {
  throw UnimplementedError(
    'pushTokenRegistrarProvider must be overridden in main.dart with '
    'FcmPushService + clientFactory wiring',
  );
});

class AppRouter {
  AppRouter() : _config = _buildRouter();

  final GoRouter _config;
  GoRouter get config => _config;

  void navigateTo(AppRoute route) {
    _config.go(route.toPath());
  }

  static GoRouter _buildRouter() {
    return GoRouter(
      initialLocation: const ServerPickerRoute().toPath(),
      routes: [
        GoRoute(
          path: '/servers',
          builder: (context, state) => Consumer(
            builder: (context, ref, _) => ServerPickerScreen(
              onSelect: (server) async {
                await ref
                    .read(serverConfigStoreProvider)
                    .setActive(server.id);
                ref.invalidate(activeServerProvider);
                ref.invalidate(serversListProvider);
                if (context.mounted) {
                  context.go('/home');
                }
              },
              onAdd: () => context.go('/servers/add'),
              onTestBridge: () => context.go('/spike'),
            ),
          ),
        ),
        GoRoute(
          path: '/servers/add',
          builder: (context, state) => Consumer(
            builder: (context, ref, _) => AddServerScreen(
              onSaved: (server) {
                ref.invalidate(serversListProvider);
                ref.invalidate(activeServerProvider);
                context.go('/servers');
              },
            ),
          ),
        ),
        GoRoute(
          path: '/home',
          builder: (context, state) => const HomeShell(),
        ),
        GoRoute(
          path: '/home/session/:id',
          builder: (context, state) => SessionViewScreen(
            sessionId: state.pathParameters['id']!,
          ),
        ),
        // Legacy WebView-host route, kept for the embedded WebView's own
        // navigation (xterm.js page lives at /m/session/<id> on the
        // server). Direct in-app navigation goes via /home/session/<id>.
        GoRoute(
          path: '/m/session/:id',
          builder: (context, state) => SessionRouteHost(
            sessionId: state.pathParameters['id']!,
          ),
        ),
        GoRoute(
          path: '/m/channel/:id',
          builder: (context, state) => _PlaceholderScreen(
            name: 'Channel ${state.pathParameters['id']}',
          ),
        ),
        GoRoute(
          path: '/m/recording/:id',
          builder: (context, state) => _PlaceholderScreen(
            name: 'Recording ${state.pathParameters['id']}',
          ),
        ),
        GoRoute(
          path: '/notifications',
          builder: (_, __) => const _PlaceholderScreen(name: 'Notifications'),
        ),
        GoRoute(
          path: '/reauth',
          builder: (context, state) => ReauthScreen(
            onReauthenticate: () => context.go('/servers'),
          ),
        ),
        GoRoute(
          path: '/spike',
          builder: (context, state) => Consumer(
            builder: (context, ref, _) => const BridgeSpikeScreen(),
          ),
        ),
      ],
    );
  }
}

class _PlaceholderScreen extends StatelessWidget {
  const _PlaceholderScreen({required this.name});

  final String name;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF1A1B26),
      body: Center(
        child: Text(
          name,
          style: const TextStyle(color: Colors.white, fontSize: 18),
        ),
      ),
    );
  }
}
