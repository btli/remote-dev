import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../application/ports/server_config_store.dart';
import '../../../infrastructure/storage/flutter_secure_storage_port.dart';
import '../../../infrastructure/storage/server_config_store_impl.dart';
import 'webview_host_screen.dart';

final secureStorageProvider = Provider<FlutterSecureStoragePort>(
  (_) => FlutterSecureStoragePort(),
);

final serverConfigStoreProvider = Provider<ServerConfigStore>(
  (ref) => ServerConfigStoreImpl(ref.watch(secureStorageProvider)),
);

final activeServerProvider = FutureProvider.autoDispose((ref) async {
  return ref.watch(serverConfigStoreProvider).loadActive();
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
