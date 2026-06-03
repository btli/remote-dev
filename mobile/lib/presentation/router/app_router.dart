import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../domain/server_config.dart';
import '../../domain/session_summary.dart';
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
import '../screens/shell/adaptive_bottom_bar.dart';
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
  AppRouter() {
    _config = _buildRouter();
  }

  late final GoRouter _config;
  GoRouter get config => _config;

  /// Tracks the most recent successfully-matched location so that the
  /// `redirect` callback below can absorb stray `remotedev://auth/callback`
  /// and bare `/` URIs without disturbing the navigation stack. Initialized
  /// to the same path as `initialLocation` so the first redirect call sees
  /// a valid value.
  String _lastGoodLocation = const ServerPickerRoute().toPath();

  /// Navigate to a deep-linked target (notification tap / app-link) such that
  /// a back target always exists.
  ///
  /// A plain [GoRouter.go] REPLACES the whole navigation stack, so when the
  /// app is cold-started from a notification there is nothing beneath the
  /// target to pop back to and the system/back button does nothing. For
  /// session/channel targets this roots the navigation at `/home` and then
  /// PUSHES the target on top, so back returns to the home shell instead of
  /// being a dead end.
  ///
  /// `/home` and the deep-link targets (`/home/session/:id`,
  /// `/home/channel/:id`, `/notifications`, …) are sibling top-level
  /// `GoRoute`s — not a `StatefulShellRoute` — so `go('/home')` + `push(...)`
  /// yields a genuinely poppable two-entry stack.
  void navigateDeepLink(AppRoute route) {
    final loc = route.toPath();
    final homeLoc = const AppRoute.home().toPath();
    final notifLoc = const AppRoute.notifications().toPath();
    // Home and notifications are both full `HomeShell` destinations with their
    // own internal tab + back handling. Pushing notifications on top of /home
    // would stack a second shell instance, so replace (go) rather than push.
    if (loc == homeLoc || loc == notifLoc) {
      _config.go(loc);
      return;
    }
    // Re-entrancy / double-tap guard: Android can deliver a tap via both
    // getInitialMessage AND onMessageOpenedApp, and a fast double-tap can
    // fire twice. If the target is already on top of a rooted stack, bail so
    // we don't stack `[home, target, home, target]`.
    final current = _config.routerDelegate.currentConfiguration;
    if (current.matches.length >= 2 &&
        current.matches.last.matchedLocation == loc) {
      return;
    }
    // Ensure the home shell is beneath the target so back returns to it.
    _config.go(homeLoc);
    _config.push(loc);
  }

  GoRouter _buildRouter() {
    return GoRouter(
      initialLocation: const ServerPickerRoute().toPath(),
      // The system-browser CF Access login (see MobileCallbackLoginLauncher)
      // returns to the app via `remotedev://auth/callback?...`. The OS
      // Flutter engine forwards that URI to MaterialApp.router's route
      // information provider, which would otherwise hand it to GoRouter
      // and throw `GoException: no routes for location: remotedev://...`.
      //
      // The launcher's own broadcast-stream subscription (via
      // `deepLinkStreamProvider`) consumes the URI for credentials in
      // parallel. We must NOT navigate away from the current screen here:
      // `AddServerScreen._save()` is `await`-ing `_runCallbackLogin()`,
      // and if GoRouter swaps in a different page the State is disposed,
      // the post-await `if (!mounted) return;` aborts, and the new server
      // is never persisted (v0.3.12 regression: CF Access succeeds, but
      // no server appears).
      //
      // The trick is to return the LAST-KNOWN-GOOD location from the
      // redirect. go_router treats "redirect to the current location" as
      // a no-op (no Page swap, no State.dispose). So the AddServer page
      // stays mounted, its mounted check passes, the credentials are
      // persisted, and `widget.onSaved` drives the post-save nav.
      //
      // Same trick covers the bare-`/` URI the Android engine re-fires
      // when returning from a Chrome Custom Tab — no registered `/`
      // route exists.
      redirect: (context, state) {
        final uri = state.uri;
        final isAuthCallback = uri.scheme == 'remotedev' &&
            uri.host == 'auth' &&
            uri.path == '/callback';
        final isBareRoot =
            uri.path == '/' && uri.scheme.isEmpty && uri.host.isEmpty;
        if (isAuthCallback || isBareRoot) {
          return _lastGoodLocation;
        }
        // Normal navigation — remember this location so the next stray
        // callback URI can be absorbed back to it.
        _lastGoodLocation = uri.toString();
        return null;
      },
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
            // Pre-resolved summary when navigation carries one (Sessions
            // list / freshly-created session). Notification/deep-link
            // cold-starts pass no extra, so the screen resolves the name
            // from the sessions list instead. Guard the cast: GoRouter may
            // hand back arbitrary extras (e.g. a ServerConfig from an
            // unrelated push) so only accept a SessionSummary.
            initialSummary: state.extra is SessionSummary
                ? state.extra! as SessionSummary
                : null,
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
          builder: (_, __) =>
              const HomeShell(initialTab: HomeTab.notifications),
        ),
        GoRoute(
          path: '/reauth',
          builder: (context, state) => Consumer(
            builder: (context, ref, _) => ReauthScreen(
              onSuccess: () {
                // Fresh cookie has been persisted; refresh the active
                // server provider so any consumer that already cached a
                // null/expired session re-reads, then bounce home.
                ref.invalidate(activeServerProvider);
                context.go('/home');
              },
              onCancel: () => context.go('/servers'),
            ),
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
        iconTheme: const IconThemeData(color: Colors.white),
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
