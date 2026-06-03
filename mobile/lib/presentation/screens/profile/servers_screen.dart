import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../server_picker/server_picker_screen.dart';
import '../webview_host/session_route_host.dart'
    show activeWorkspaceProvider, serverConfigStoreProvider;

/// Profile → Servers entry point.
///
/// Reuses the boot-time [ServerPickerScreen] so the list, add, edit, and
/// delete flows stay in lockstep. Selecting a server here switches the
/// active server and pops back to the Profile tab when this screen was
/// pushed onto the stack; if there is nothing to pop (e.g. deep-linked at
/// boot) we fall back to `/home` so the user lands somewhere sane instead
/// of stranded on this picker.
class ServersScreen extends ConsumerWidget {
  const ServersScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return ServerPickerScreen(
      onSelect: (server) async {
        // Legacy server store (Task D migrates the picker to Host/Workspace).
        // Invalidate the workspace provider so the activeServerProvider shim
        // re-derives.
        await ref.read(serverConfigStoreProvider).setActive(server.id);
        ref.invalidate(activeWorkspaceProvider);
        ref.invalidate(serversListProvider);
        if (!context.mounted) return;
        // Prefer pop so the Profile tab (HomeShell) stays on the back stack;
        // only force-navigate to /home when there is no prior route.
        if (context.canPop()) {
          context.pop();
        } else {
          context.go('/home');
        }
      },
      onAdd: () => context.push('/servers/add'),
      onEdit: (server) => context.push('/servers/edit', extra: server),
    );
  }
}
