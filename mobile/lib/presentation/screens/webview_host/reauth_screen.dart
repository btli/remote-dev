import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../server_picker/cf_login_webview_screen.dart';
import 'session_route_host.dart'
    show activeServerProvider, secureStorageProvider;

/// Screen we land on whenever Dio sees a 401/403 from the active server
/// (see `CfAuthInterceptor` + `reauthSignalProvider`). It re-runs the
/// CF Access WebView login flow against the *active* server, persists the
/// fresh `CF_Authorization` cookie back into secure storage under the same
/// `cf_authorization` key the Add Server flow uses, then bounces back to
/// `/home` so the user resumes where they were.
///
/// Two callbacks are accepted so the router can decide where the user
/// goes after success / cancel:
///   * [onSuccess] — fired after the new cookie is persisted. Typically
///     `() => context.go('/home')`.
///   * [onCancel] — fired when the user backs out of the WebView. Typically
///     `() => context.go('/servers')` so they can pick a different server.
///
/// If there is no active server (edge case — e.g. a stale `/reauth` deep
/// link after the user wiped their server list), we render a small
/// "no active server" panel that punts to [onCancel].
class ReauthScreen extends ConsumerWidget {
  const ReauthScreen({
    required this.onSuccess,
    required this.onCancel,
    this.cfLoginLauncherOverride,
    super.key,
  });

  /// Called after the new cookie is persisted. The router should navigate
  /// the user back into the app (`/home`).
  final VoidCallback onSuccess;

  /// Called when the user dismisses the WebView or when there's no active
  /// server to reauth against. The router should send them to `/servers`.
  final VoidCallback onCancel;

  /// Test seam — replaces the embedded [CfLoginWebViewScreen] body with a
  /// fake widget so unit tests don't have to host a real InAppWebView.
  /// The override receives the same [serverUrl], [onSuccess], [onCancel]
  /// callbacks the real WebView would.
  final Widget Function({
    required Uri serverUrl,
    required void Function(String cookieValue) onSuccess,
    required VoidCallback onCancel,
  })? cfLoginLauncherOverride;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final asyncServer = ref.watch(activeServerProvider);
    return asyncServer.when(
      loading: () => const Scaffold(
        backgroundColor: Color(0xFF1A1B26),
        body: Center(child: CircularProgressIndicator()),
      ),
      error: (e, _) => _NoActiveServer(onCancel: onCancel, message: '$e'),
      data: (server) {
        if (server == null) {
          return _NoActiveServer(onCancel: onCancel);
        }
        final serverUrl = Uri.parse(server.url);
        Future<void> handleSuccess(String cookieValue) async {
          // Persist the fresh cookie under the same key the Add Server flow
          // writes to (`cf_authorization`) so `CfAuthInterceptor` picks it
          // up on its next request.
          final storage = ref.read(secureStorageProvider);
          await storage.write(server.id, 'cf_authorization', cookieValue);
          onSuccess();
        }

        if (cfLoginLauncherOverride != null) {
          return cfLoginLauncherOverride!(
            serverUrl: serverUrl,
            onSuccess: handleSuccess,
            onCancel: onCancel,
          );
        }
        return CfLoginWebViewScreen(
          serverUrl: serverUrl,
          onSuccess: handleSuccess,
          onCancel: onCancel,
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
