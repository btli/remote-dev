import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../domain/server_config.dart';
import '../../infrastructure/push/push_token_registrar.dart';
import '../screens/biometric/biometric_settings_screen.dart';
import '../screens/bridge_spike/bridge_spike_screen.dart';
import '../screens/channels/channel_screen.dart';
import '../screens/profile/about_screen.dart';
import '../screens/profile/account_screen.dart';
import '../screens/profile/appearance_screen.dart';
import '../screens/profile/github_accounts_screen.dart';
import '../screens/profile/servers_screen.dart';
import '../screens/recording/recording_screen.dart';
import '../screens/server_picker/add_server_screen.dart';
import '../screens/server_picker/edit_server_screen.dart';
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
              // push sub-routes so the server picker stays on the back
              // stack and the AppBar shows an implicit back arrow.
              onAdd: () => context.push('/servers/add'),
              onEdit: (server) => context.push(
                '/servers/edit',
                extra: server,
              ),
              onTestBridge: () => context.push('/spike'),
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
                // Prefer pop so the picker beneath us survives. Fall back
                // to go for direct deep-link cold-starts where add is
                // the root of the stack.
                if (context.canPop()) {
                  context.pop();
                } else {
                  context.go('/servers');
                }
              },
            ),
          ),
        ),
        GoRoute(
          path: '/servers/edit',
          builder: (context, state) {
            final server = state.extra;
            if (server is! ServerConfig) {
              // Direct deep-link without state — bounce back to the picker.
              return _EditMissingExtraScreen(
                onBack: () => context.go('/servers'),
              );
            }
            return Consumer(
              builder: (context, ref, _) => EditServerScreen(
                initial: server,
                onSaved: (_) {
                  ref.invalidate(serversListProvider);
                  ref.invalidate(activeServerProvider);
                  if (context.canPop()) {
                    context.pop();
                  } else {
                    context.go('/servers');
                  }
                },
              ),
            );
          },
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
        GoRoute(
          path: '/home/channel/:id',
          builder: (context, state) => ChannelScreen(
            channelId: state.pathParameters['id']!,
          ),
        ),
        GoRoute(
          path: '/home/profile/account',
          builder: (context, state) => Consumer(
            builder: (context, ref, _) => const AccountScreen(),
          ),
        ),
        GoRoute(
          path: '/home/profile/github',
          builder: (context, state) => Consumer(
            builder: (context, ref, _) => const GitHubAccountsScreen(),
          ),
        ),
        GoRoute(
          path: '/home/profile/appearance',
          builder: (context, state) => Consumer(
            builder: (context, ref, _) => const AppearanceScreen(),
          ),
        ),
        GoRoute(
          path: '/home/profile/servers',
          builder: (context, state) => Consumer(
            builder: (context, ref, _) => const ServersScreen(),
          ),
        ),
        GoRoute(
          path: '/home/profile/biometric',
          builder: (context, state) => Consumer(
            builder: (context, ref, _) => const BiometricSettingsScreen(),
          ),
        ),
        GoRoute(
          path: '/home/profile/about',
          builder: (context, state) => Consumer(
            builder: (context, ref, _) => const AboutScreen(),
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
          path: '/home/recording/:id',
          builder: (context, state) => RecordingScreen(
            recordingId: state.pathParameters['id']!,
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

class _EditMissingExtraScreen extends StatelessWidget {
  const _EditMissingExtraScreen({required this.onBack});

  final VoidCallback onBack;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF1A1B26),
      appBar: AppBar(
        backgroundColor: const Color(0xFF1A1B26),
        title: const Text(
          'Edit server',
          style: TextStyle(color: Colors.white),
        ),
      ),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Text(
                'No server selected.',
                style: TextStyle(color: Colors.white, fontSize: 16),
              ),
              const SizedBox(height: 16),
              ElevatedButton(
                onPressed: onBack,
                child: const Text('Back to servers'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
