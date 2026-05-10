import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../server_picker/server_picker_screen.dart';
import '../webview_host/session_route_host.dart'
    show activeServerProvider, serverConfigStoreProvider;

/// Profile → Servers entry point.
///
/// Reuses the boot-time [ServerPickerScreen] so the list, add, edit, and
/// delete flows stay in lockstep. Selecting a server here switches the
/// active server and bounces to /home, matching the boot picker behavior.
class ServersScreen extends ConsumerWidget {
  const ServersScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return ServerPickerScreen(
      onSelect: (server) async {
        await ref.read(serverConfigStoreProvider).setActive(server.id);
        ref.invalidate(activeServerProvider);
        ref.invalidate(serversListProvider);
        if (context.mounted) {
          context.go('/home');
        }
      },
      onAdd: () => context.push('/servers/add'),
      onEdit: (server) => context.push('/servers/edit', extra: server),
    );
  }
}
