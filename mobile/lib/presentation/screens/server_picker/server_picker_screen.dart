import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../domain/server_config.dart';
import '../../router/app_router.dart' show pushTokenRegistrarProvider;
import '../webview_host/session_route_host.dart' show serverConfigStoreProvider;

final serversListProvider = FutureProvider<List<ServerConfig>>((ref) async {
  return ref.watch(serverConfigStoreProvider).loadAll();
});

class ServerPickerScreen extends ConsumerWidget {
  const ServerPickerScreen({
    required this.onSelect,
    required this.onAdd,
    this.onEdit,
    this.onTestBridge,
    super.key,
  });

  final void Function(ServerConfig) onSelect;
  final VoidCallback onAdd;

  /// Invoked when the user picks "Edit" from the long-press action sheet.
  /// The router supplies a real handler that pushes [EditServerScreen]; in
  /// tests this is left null and the action sheet still renders for assertions
  /// against the menu items.
  final void Function(ServerConfig)? onEdit;
  final VoidCallback? onTestBridge;

  Future<void> _deleteServer(WidgetRef ref, ServerConfig server) async {
    // P3.7: unregister FCM token from this server before dropping it.
    // Best-effort — dev builds without Firebase config will throw
    // UnimplementedError from the default provider, so swallow and continue.
    try {
      await ref
          .read(pushTokenRegistrarProvider)
          .unregisterFromServer(server.id);
    } catch (e) {
      debugPrint('[Push] unregister on delete failed: $e');
    }
    await ref.read(serverConfigStoreProvider).remove(server.id);
    ref.invalidate(serversListProvider);
  }

  Future<void> _showActionSheet(
    BuildContext context,
    WidgetRef ref,
    ServerConfig server,
  ) async {
    final action = await showModalBottomSheet<_ServerRowAction>(
      context: context,
      backgroundColor: const Color(0xFF24283B),
      builder: (sheetCtx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.edit, color: Colors.white),
              title: const Text(
                'Edit',
                style: TextStyle(color: Colors.white),
              ),
              onTap: () =>
                  Navigator.of(sheetCtx).pop(_ServerRowAction.edit),
            ),
            ListTile(
              leading: const Icon(Icons.delete, color: Colors.redAccent),
              title: const Text(
                'Delete',
                style: TextStyle(color: Colors.redAccent),
              ),
              onTap: () =>
                  Navigator.of(sheetCtx).pop(_ServerRowAction.delete),
            ),
          ],
        ),
      ),
    );

    if (action == null) return;
    switch (action) {
      case _ServerRowAction.edit:
        onEdit?.call(server);
      case _ServerRowAction.delete:
        await _deleteServer(ref, server);
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final asyncServers = ref.watch(serversListProvider);
    return Scaffold(
      backgroundColor: const Color(0xFF1A1B26),
      appBar: AppBar(
        backgroundColor: const Color(0xFF1A1B26),
        title: const Text('Servers', style: TextStyle(color: Colors.white)),
        actions: [
          if (onTestBridge != null)
            IconButton(
              icon: const Icon(Icons.bug_report, color: Colors.white),
              tooltip: 'Test bridge',
              onPressed: onTestBridge,
            ),
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
                onDismissed: (_) => _deleteServer(ref, server),
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
                  onLongPress: () => _showActionSheet(context, ref, server),
                ),
              );
            },
          );
        },
      ),
    );
  }
}

enum _ServerRowAction { edit, delete }
