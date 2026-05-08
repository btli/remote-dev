import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../screens/webview_host/session_route_host.dart';
import 'app_route.dart';

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
          builder: (_, __) => const _PlaceholderScreen(name: 'Servers'),
        ),
        GoRoute(
          path: '/servers/add',
          builder: (_, __) => const _PlaceholderScreen(name: 'Add server'),
        ),
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
          builder: (_, __) => const _PlaceholderScreen(name: 'Re-auth'),
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
