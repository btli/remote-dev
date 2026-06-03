import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../application/ports/host_workspace_store.dart';
import '../../../application/ports/server_config_store.dart';
import '../../../application/state/active_connection.dart';
import '../../../domain/server_config.dart';
import '../../../infrastructure/auth/mobile_credentials.dart';
import '../../../infrastructure/storage/flutter_secure_storage_port.dart';
import '../../../infrastructure/storage/host_workspace_store_impl.dart';
import '../../../infrastructure/storage/server_config_store_impl.dart';
import '../../../infrastructure/webview/webview_cookie_seeder.dart';
import 'webview_host_screen.dart';

final secureStorageProvider = Provider<FlutterSecureStoragePort>(
  (_) => FlutterSecureStoragePort(),
);

/// Legacy per-server store. Retained for the server add/edit/picker flows
/// (Task D will migrate those to the Host/Workspace model) and for the
/// push-token registrar, which still iterates legacy [ServerConfig] rows.
final serverConfigStoreProvider = Provider<ServerConfigStore>(
  (ref) => ServerConfigStoreImpl(ref.watch(secureStorageProvider)),
);

/// Host → Workspace store backing [activeWorkspaceProvider] and the startup
/// legacy migration.
final hostWorkspaceStoreProvider = Provider<HostWorkspaceStore>(
  (ref) => HostWorkspaceStoreImpl(ref.watch(secureStorageProvider)),
);

/// Typed helper for reading / writing per-server credentials persisted
/// by `MobileCallbackLoginLauncher`.
final mobileCredentialsStoreProvider = Provider<MobileCredentialsStore>(
  (ref) => MobileCredentialsStore(ref.watch(secureStorageProvider)),
);

/// Seeds the in-app WebView's `CookieManager` with the persisted CF
/// JWT before navigation. Overrideable so widget tests can substitute
/// a fake that records calls instead of touching the platform plugin.
final webViewCookieSeederProvider = Provider<WebViewCookieSeeder>(
  (_) => WebViewCookieSeeder(),
);

/// Resolves the active [WorkspaceConfig] AND its owning [HostConfig] into an
/// [ActiveConnection]. This is the source of truth the rewired
/// [_apiClientProvider], WebView cookie seeders, and reauth flow read from.
///
/// `autoDispose` so invalidating it (after switching workspaces or signing
/// out) rebinds every downstream provider — same pattern the old
/// per-server `activeServerProvider` used.
final activeWorkspaceProvider =
    FutureProvider.autoDispose<ActiveConnection?>((ref) async {
  final store = ref.watch(hostWorkspaceStoreProvider);
  final workspace = await store.loadActiveWorkspace();
  if (workspace == null) return null;
  final host = await store.loadHost(workspace.hostId);
  if (host == null) return null;
  return ActiveConnection(host: host, workspace: workspace);
});

/// TRANSITIONAL shim: a [ServerConfig]-shaped view of [activeWorkspaceProvider]
/// so existing screens that only read the URL / label / id keep working
/// without being rewritten to the Host/Workspace API.
///
/// Mapping:
/// - `id`        = `workspace.id`
/// - `label`     = `workspace.displayName`
/// - `url`       = `host.origin + workspace.basePath` (== `host.origin` for
///                 migrated single-workspace configs, where basePath is `''`)
/// - `lastUsedAt`= `workspace.lastUsedAt`
///
/// IMPORTANT: credentials must NOT be read via this view's `id` using the
/// legacy per-server `readApiKey`/`readCfToken` path. CF tokens are host-wide
/// and API keys are per-workspace, so the credential-touching call sites
/// (the Dio client, the WebView cookie seeders, reauth) read
/// [activeWorkspaceProvider] directly and use
/// `getHostCfToken(host.id)` / `getWorkspaceApiKey(workspace.id)`.
final activeServerProvider =
    FutureProvider.autoDispose<ServerConfig?>((ref) async {
  final conn = await ref.watch(activeWorkspaceProvider.future);
  if (conn == null) return null;
  return ServerConfig(
    id: conn.workspace.id,
    label: conn.workspace.displayName,
    url: conn.effectiveUrl,
    lastUsedAt: conn.workspace.lastUsedAt,
  );
});

class SessionRouteHost extends ConsumerWidget {
  const SessionRouteHost({required this.sessionId, super.key});

  final String sessionId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final asyncServer = ref.watch(activeServerProvider);
    return asyncServer.when(
      loading: () => const Scaffold(
        backgroundColor: Color(0xFF1A1B26),
        body: Center(child: CircularProgressIndicator()),
      ),
      error: (e, _) => Scaffold(
        backgroundColor: const Color(0xFF1A1B26),
        body: Center(
          child: Text(
            'Failed to resolve server: $e',
            style: const TextStyle(color: Colors.white70),
          ),
        ),
      ),
      data: (server) {
        if (server == null) {
          return Scaffold(
            backgroundColor: const Color(0xFF1A1B26),
            body: Center(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    const Text(
                      'No active server.',
                      style: TextStyle(color: Colors.white, fontSize: 18),
                    ),
                    const SizedBox(height: 16),
                    ElevatedButton(
                      onPressed: () => context.go('/servers'),
                      child: const Text('Choose a server'),
                    ),
                  ],
                ),
              ),
            ),
          );
        }
        final origin = Uri.parse(server.url);
        return WebViewHostScreen(
          initialUrl: Uri.parse('${server.url}/m/session/$sessionId'),
          serverOrigin: origin,
          allowedPathPrefixes: const ['/m/session/'],
        );
      },
    );
  }
}
