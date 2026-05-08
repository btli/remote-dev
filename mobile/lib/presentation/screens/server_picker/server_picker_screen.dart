import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../domain/server_config.dart';
import '../webview_host/session_route_host.dart' show serverConfigStoreProvider;

final serversListProvider = FutureProvider<List<ServerConfig>>((ref) async {
  return ref.watch(serverConfigStoreProvider).loadAll();
});

class ServerPickerScreen extends ConsumerWidget {
  const ServerPickerScreen({
    required this.onSelect,
    required this.onAdd,
    super.key,
  });

  final void Function(ServerConfig) onSelect;
  final VoidCallback onAdd;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final asyncServers = ref.watch(serversListProvider);
    return Scaffold(
      backgroundColor: const Color(0xFF1A1B26),
      appBar: AppBar(
        backgroundColor: const Color(0xFF1A1B26),
        title: const Text('Servers', style: TextStyle(color: Colors.white)),
        actions: [
          IconButton(
            icon: const Icon(Icons.add, color: Colors.white),
            onPressed: onAdd,
          ),
        ],
      ),
      body: asyncServers.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(
          child: Text(
            'Failed to load servers: $e',
            style: const TextStyle(color: Colors.white70),
          ),
        ),
        data: (servers) {
          if (servers.isEmpty) {
            return Center(
              child: Padding(
                padding: const EdgeInsets.all(32),
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    const Text(
                      'No servers yet.',
                      style: TextStyle(color: Colors.white, fontSize: 20),
                    ),
                    const SizedBox(height: 16),
                    ElevatedButton(
                      onPressed: onAdd,
                      child: const Text('Add a server'),
                    ),
                  ],
                ),
              ),
            );
          }
          return ListView.builder(
            itemCount: servers.length,
            itemBuilder: (context, i) {
              final server = servers[i];
              return Dismissible(
                key: ValueKey(server.id),
                direction: DismissDirection.endToStart,
                background: Container(
                  color: Colors.red,
                  alignment: Alignment.centerRight,
                  padding: const EdgeInsets.only(right: 16),
                  child: const Icon(Icons.delete, color: Colors.white),
                ),
                onDismissed: (_) async {
                  await ref
                      .read(serverConfigStoreProvider)
                      .remove(server.id);
                  ref.invalidate(serversListProvider);
                },
                child: ListTile(
                  title: Text(
                    server.label,
                    style: const TextStyle(color: Colors.white),
                  ),
                  subtitle: Text(
                    server.url,
                    style: const TextStyle(color: Colors.white70),
                  ),
                  onTap: () => onSelect(server),
                ),
              );
            },
          );
        },
      ),
    );
  }
}
