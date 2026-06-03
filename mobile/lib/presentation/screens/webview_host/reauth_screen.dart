import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../application/state/active_connection.dart';
import '../../../infrastructure/auth/mobile_callback_login_launcher.dart';
import '../../../infrastructure/auth/mobile_credentials.dart';
import '../../../infrastructure/deep_link/deep_link_stream_provider.dart';
import 'session_route_host.dart'
    show activeWorkspaceProvider, mobileCredentialsStoreProvider;

/// Test seam — mirrors [MobileCallbackLauncher] from `AddServerScreen`.
/// In production this is `null` and we build a real
/// [MobileCallbackLoginLauncher] against the shared deep-link stream.
typedef MobileCallbackLauncherForReauth = Future<MobileCredentials?> Function(
  Uri serverUrl,
);

/// Screen we land on whenever Dio sees a 401/403 from the active server
/// (see [reauthSignalProvider]). Runs the same system-browser flow the
/// Add Server screen uses — opens `<server>/auth/mobile-callback` in
/// the platform browser, waits for the `remotedev://auth/callback`
/// deep link, persists the fresh credentials back into secure storage
/// under the active server's id, then bounces back to `/home`.
///
/// Two callbacks are accepted so the router can decide where the user
/// goes after success / cancel:
///   * [onSuccess] — fired after the new credentials are persisted.
///     Typically `() => context.go('/home')`.
///   * [onCancel] — fired when the launcher returns `null` (user
///     cancel, timeout, malformed callback). Typically
///     `() => context.go('/servers')` so they can pick a different
///     server.
///
/// If there is no active server (edge case — e.g. a stale `/reauth`
/// deep link after the user wiped their server list), we render a
/// small "no active server" panel that punts to [onCancel].
class ReauthScreen extends ConsumerStatefulWidget {
  const ReauthScreen({
    required this.onSuccess,
    required this.onCancel,
    this.mobileCallbackLauncherOverride,
    super.key,
  });

  /// Called after fresh credentials are persisted. The router should
  /// navigate the user back into the app (`/home`).
  final VoidCallback onSuccess;

  /// Called when the launcher returns null or when there's no active
  /// server to reauth against. The router should send them to `/servers`.
  final VoidCallback onCancel;

  /// Test seam — replaces the system-browser launcher with a stub
  /// (e.g. one that returns canned [MobileCredentials] or null).
  final MobileCallbackLauncherForReauth? mobileCallbackLauncherOverride;

  @override
  ConsumerState<ReauthScreen> createState() => _ReauthScreenState();
}

class _ReauthScreenState extends ConsumerState<ReauthScreen> {
  bool _running = false;
  bool _completed = false;

  Future<void> _runLaunch(ActiveConnection conn) async {
    if (_running || _completed) return;
    setState(() => _running = true);
    final serverUrl = Uri.parse(conn.effectiveUrl);
    final launcher = widget.mobileCallbackLauncherOverride;
    final result = launcher != null
        ? await launcher(serverUrl)
        : await MobileCallbackLoginLauncher(
            deepLinkStream: ref.read(deepLinkStreamProvider),
          ).login(serverUrl: serverUrl);
    if (!mounted) return;
    if (result == null) {
      _completed = true;
      widget.onCancel();
      return;
    }
    // Persist onto the host/workspace namespaces: CF token is host-wide,
    // API key is per-workspace.
    final credentials = ref.read(mobileCredentialsStoreProvider);
    final cf = result.cfToken;
    if (cf != null && cf.isNotEmpty) {
      await credentials.setHostCfToken(conn.host.id, cf);
    }
    await credentials.setWorkspaceApiKey(conn.workspace.id, result.apiKey);
    if (!mounted) return;
    _completed = true;
    widget.onSuccess();
  }

  @override
  Widget build(BuildContext context) {
    final asyncConn = ref.watch(activeWorkspaceProvider);
    return asyncConn.when(
      loading: () => const Scaffold(
        backgroundColor: Color(0xFF1A1B26),
        body: Center(child: CircularProgressIndicator()),
      ),
      error: (e, _) => _NoActiveServer(onCancel: widget.onCancel, message: '$e'),
      data: (conn) {
        if (conn == null) {
          return _NoActiveServer(onCancel: widget.onCancel);
        }
        // Fire-and-forget the launch the first time we settle on a
        // non-null active connection. Subsequent rebuilds while the launcher
        // is in flight are gated by `_running` / `_completed`.
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (!mounted) return;
          _runLaunch(conn);
        });
        return Scaffold(
          backgroundColor: const Color(0xFF1A1B26),
          appBar: AppBar(
            backgroundColor: const Color(0xFF1A1B26),
            title: Text(
              'Sign in to ${Uri.parse(conn.effectiveUrl).host}',
              style: const TextStyle(color: Colors.white),
            ),
            iconTheme: const IconThemeData(color: Colors.white),
            leading: IconButton(
              icon: const Icon(Icons.close),
              onPressed: () {
                if (_completed) return;
                _completed = true;
                widget.onCancel();
              },
            ),
          ),
          body: SafeArea(
            child: Center(
              child: Padding(
                padding: const EdgeInsets.all(32),
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    const Icon(
                      Icons.shield_outlined,
                      size: 64,
                      color: Color(0xFF7AA2F7),
                    ),
                    const SizedBox(height: 24),
                    const Text(
                      'Re-authenticate',
                      style: TextStyle(color: Colors.white, fontSize: 22),
                    ),
                    const SizedBox(height: 12),
                    const Text(
                      'Your session expired. Complete the sign-in in '
                      'your browser to continue.',
                      textAlign: TextAlign.center,
                      style: TextStyle(color: Colors.white70),
                    ),
                    const SizedBox(height: 32),
                    if (_running)
                      const CircularProgressIndicator()
                    else
                      ElevatedButton(
                        onPressed: () => _runLaunch(conn),
                        child: const Text('Open browser again'),
                      ),
                  ],
                ),
              ),
            ),
          ),
        );
      },
    );
  }
}

class _NoActiveServer extends StatelessWidget {
  const _NoActiveServer({required this.onCancel, this.message});

  final VoidCallback onCancel;
  final String? message;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF1A1B26),
      body: SafeArea(
        child: Center(
          child: Padding(
            padding: const EdgeInsets.all(32),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                const Icon(
                  Icons.lock_outline,
                  size: 64,
                  color: Color(0xFF7AA2F7),
                ),
                const SizedBox(height: 24),
                const Text(
                  'No active server',
                  style: TextStyle(color: Colors.white, fontSize: 22),
                ),
                const SizedBox(height: 12),
                Text(
                  message ??
                      'Sign in to a server to continue. '
                          'Your saved servers are still available on the '
                          'next screen.',
                  textAlign: TextAlign.center,
                  style: const TextStyle(color: Colors.white70),
                ),
                const SizedBox(height: 32),
                ElevatedButton(
                  onPressed: onCancel,
                  child: const Text('Choose a server'),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
