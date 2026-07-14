import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../domain/host_config.dart';
import '../../domain/instance_summary.dart';
import '../../domain/session_summary.dart';
import '../../infrastructure/api/instances_api.dart';
import '../../infrastructure/push/push_token_registrar.dart';
import '../screens/biometric/biometric_settings_screen.dart';
import '../screens/bridge_spike/bridge_spike_screen.dart';
import '../screens/channels/channel_screen.dart';
import '../screens/host_picker/add_host_screen.dart';
import '../screens/host_picker/workspace_picker_screen.dart';
import '../screens/profile/about_screen.dart';
import '../screens/profile/account_screen.dart';
import '../screens/profile/appearance_screen.dart';
import '../screens/profile/github_accounts_screen.dart';
import '../screens/profile/servers_screen.dart';
import '../screens/recording/recording_screen.dart';
import '../screens/server_picker/edit_host_screen.dart';
import '../screens/server_picker/server_picker_screen.dart';
import '../screens/session_view/session_view_screen.dart';
import '../screens/shell/adaptive_bottom_bar.dart';
import '../screens/shell/home_shell.dart';
import '../screens/webview_host/reauth_screen.dart';
import '../screens/webview_host/session_route_host.dart';
import 'app_route.dart';

/// App-wide [RouteObserver] for `RouteAware` subscribers.
///
/// Registered in the [GoRouter]'s `observers:` list so screens can learn when
/// a route stacked ON TOP of them is popped (`didPopNext`). The session view
/// uses this to `refit()` the embedded terminal when the user returns from a
/// pushed route (Recordings / Settings) — inside a platform WebView that
/// pop-back emits no page-level resize signal, so the grid would otherwise
/// stay stale until the next pinch (remote-dev-u5q5.2).
///
/// Typed `ModalRoute<void>` so it matches the `MaterialPage`-backed routes
/// GoRouter builds (their result type is `void`), which is what lets a
/// `RouteAware` widget subscribe via `routeObserver.subscribe(this,
/// ModalRoute.of(context)!)`.
final RouteObserver<ModalRoute<void>> routeObserver =
    RouteObserver<ModalRoute<void>>();

/// FCM token registrar wired against the app's PushPort + HostWorkspaceStore +
/// MobileCredentialsStore + workspace API-client factory. Default impl throws —
/// `main.dart` overrides this in the `ProviderScope` after Firebase is
/// initialized (matching the `sessionsApiProvider` pattern). The server picker
/// reads it best-effort so dev builds without Firebase config still allow
/// workspace deletion.
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

  /// "Open another workspace" on an already-linked multi-workspace host:
  /// re-discover its instances via the Supervisor (`GET /api/instances`, using
  /// the stored host CF token) and push the [WorkspacePickerScreen]. If the
  /// re-list fails (network, expired token) we surface a snackbar but still
  /// push the picker with an empty list so the user can pull-to-refresh / retry
  /// from there rather than being dead-ended.
  Future<void> _openAnotherWorkspace(
    BuildContext context,
    WidgetRef ref,
    HostConfig host,
  ) async {
    List<InstanceSummary> instances = const [];
    try {
      final api = InstancesApi(
        origin: host.origin,
        hostId: host.id,
        storage: ref.read(secureStorageProvider),
      );
      instances = await api.list();
    } catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Could not refresh workspaces: $e')),
        );
      }
    }
    if (!context.mounted) return;
    context.push(
      '/hosts/workspaces',
      extra: WorkspacePickerArgs(host: host, instances: instances),
    );
  }

  GoRouter _buildRouter() {
    return GoRouter(
      initialLocation: const ServerPickerRoute().toPath(),
      // Drives `RouteAware.didPopNext` for the session view's terminal refit
      // on route pop-back (remote-dev-u5q5.2). GoRouter forwards this list to
      // the underlying root Navigator.
      observers: [routeObserver],
      // The system-browser CF Access / OIDC login returns to the app via
      // `remotedev://auth/callback?...`. The OS Flutter engine forwards that URI
      // to MaterialApp.router's route information provider, which would otherwise
      // hand it to GoRouter and throw `GoException: no routes for location:
      // remotedev://...`. The Android engine ALSO re-fires a bare-`/` URI on
      // return from a Chrome Custom Tab, for which no `/` route exists.
      //
      // This redirect's ONLY remaining job is to ABSORB those stray URIs as a
      // no-op by returning the last-known-good location (go_router treats
      // "redirect to the current location" as a no-op — no Page swap).
      //
      // NOTE (remote-dev state-independent add-host): completion NO LONGER
      // depends on any screen staying mounted. The add-host flow is driven by
      // the app-global `AddHostLoginCompleter` off a durable pending-login
      // record + the `deepLinkStreamProvider` broadcast stream; it persists the
      // host, detects single-vs-supervisor, activates, and navigates itself. So
      // this redirect no longer needs to preserve `AddHostScreen`'s State — it
      // only prevents GoRouter from throwing on the unknown callback/`/` URI.
      // (Non-add-host launchers — reauth / workspace open — still consume their
      // own callback via their in-flight stream subscription in parallel.)
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
              // D3: select/switch now drives the Host/Workspace store. Setting
              // the active workspace + invalidating activeWorkspaceProvider
              // (which the display-only activeServerProvider shim derives from)
              // is what actually makes switching between connections work.
              onSelectWorkspace: (ws) async {
                await ref
                    .read(hostWorkspaceStoreProvider)
                    .setActiveWorkspace(ws.id);
                ref.invalidate(activeWorkspaceProvider);
                ref.invalidate(serverPickerDataProvider);
                if (context.mounted) {
                  context.go('/home');
                }
              },
              // push sub-routes so the server picker stays on the back
              // stack and the AppBar shows an implicit back arrow.
              onAddHost: () => context.push('/hosts/add'),
              onEditHost: (host, soleWorkspace) => context.push(
                '/servers/edit',
                extra: EditHostArgs(host: host, workspace: soleWorkspace),
              ),
              onEditWorkspace: (host, ws) => context.push(
                '/servers/edit',
                extra: EditHostArgs(host: host, workspace: ws),
              ),
              onOpenAnotherWorkspace: (host) =>
                  _openAnotherWorkspace(context, ref, host),
              onTestBridge: () => context.push('/spike'),
            ),
          ),
        ),
        GoRoute(
          path: '/servers/edit',
          builder: (context, state) {
            final args = state.extra;
            if (args is! EditHostArgs) {
              // Direct deep-link without state — bounce back to the picker.
              return _EditMissingExtraScreen(
                onBack: () => context.go('/servers'),
              );
            }
            return Consumer(
              builder: (context, ref, _) => EditHostScreen(
                args: args,
                onSaved: () {
                  // EditHostScreen already invalidated the picker data + the
                  // active-connection shim.
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
        // --- D2: host / workspace onboarding ---------------------------------
        GoRoute(
          path: '/hosts/add',
          // Thin trigger: writes a durable pending-login record + launches the
          // browser. The whole persist/detect/activate/navigate flow runs in the
          // app-global AddHostLoginCompleter (wired in app.dart), which survives
          // this page being rebuilt/disposed on the `remotedev://auth/callback`
          // return — so navigation to /home (single) or the workspace picker
          // (supervisor) happens there, not here.
          builder: (context, state) => const AddHostScreen(),
        ),
        GoRoute(
          path: '/hosts/workspaces',
          builder: (context, state) {
            final args = state.extra;
            if (args is! WorkspacePickerArgs) {
              // Direct deep-link without state — bounce back to the picker.
              return _MissingExtraScreen(
                title: 'Workspaces',
                message: 'No host selected.',
                onBack: () => context.go('/servers'),
              );
            }
            return Consumer(
              builder: (context, ref, _) => WorkspacePickerScreen(
                host: args.host,
                instances: args.instances,
                onActivated: (_) {
                  // activeWorkspaceProvider already invalidated in-screen.
                  context.go('/home');
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
          builder: (context, state) {
            final id = state.pathParameters['id']!;
            // Key by session id so the screen REMOUNTS whenever the session
            // changes. SessionViewScreen + _Webview cache per-session state in
            // initState (resolved name, resolved WebView target); without a key a
            // future context.go(...) or route restoration could reuse this element
            // across sessions and leave those caches stale (remote-dev-9c5j).
            return SessionViewScreen(
              key: ValueKey('session-$id'),
              sessionId: id,
              // Pre-resolved summary when navigation carries one (Sessions
              // list / freshly-created session). Notification/deep-link
              // cold-starts pass no extra, so the screen resolves the name
              // from the sessions list instead. Guard the cast: GoRouter may
              // hand back arbitrary extras (e.g. a ServerConfig from an
              // unrelated push) so only accept a SessionSummary.
              initialSummary: state.extra is SessionSummary
                  ? state.extra! as SessionSummary
                  : null,
            );
          },
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
                // Fresh host/workspace credentials have been persisted;
                // refresh the active-connection provider so any consumer
                // (incl. the rebuilt API client) re-reads, then bounce home.
                // The activeServerProvider shim derives from this.
                ref.invalidate(activeWorkspaceProvider);
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
          'Edit host',
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
                'No host selected.',
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

/// Generic "this route needs an `extra` that wasn't supplied" fallback, used by
/// routes (e.g. the workspace picker) reached without their required state —
/// typically a cold-start deep link.
class _MissingExtraScreen extends StatelessWidget {
  const _MissingExtraScreen({
    required this.title,
    required this.message,
    required this.onBack,
  });

  final String title;
  final String message;
  final VoidCallback onBack;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF1A1B26),
      appBar: AppBar(
        backgroundColor: const Color(0xFF1A1B26),
        title: Text(title, style: const TextStyle(color: Colors.white)),
        iconTheme: const IconThemeData(color: Colors.white),
      ),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Text(
                message,
                style: const TextStyle(color: Colors.white, fontSize: 16),
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
