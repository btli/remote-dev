import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../domain/host_config.dart';
import '../../../infrastructure/api/instances_api.dart';
import '../../../domain/instance_summary.dart';
import '../host_picker/workspace_picker_screen.dart' show WorkspacePickerArgs;
import '../server_picker/edit_host_screen.dart';
import '../server_picker/server_picker_screen.dart';
import '../webview_host/session_route_host.dart'
    show activeWorkspaceProvider, hostWorkspaceStoreProvider, secureStorageProvider;

/// Profile → Servers entry point.
///
/// Reuses the boot-time [ServerPickerScreen] so the list, add, edit, switch,
/// and delete flows stay in lockstep. Selecting a workspace here switches the
/// active workspace and pops back to the Profile tab when this screen was
/// pushed onto the stack; if there is nothing to pop (e.g. deep-linked at
/// boot) we fall back to `/home` so the user lands somewhere sane instead
/// of stranded on this picker.
class ServersScreen extends ConsumerWidget {
  const ServersScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return ServerPickerScreen(
      onSelectWorkspace: (ws) async {
        await ref.read(hostWorkspaceStoreProvider).setActiveWorkspace(ws.id);
        ref.invalidate(activeWorkspaceProvider);
        ref.invalidate(serverPickerDataProvider);
        if (!context.mounted) return;
        // Prefer pop so the Profile tab (HomeShell) stays on the back stack;
        // only force-navigate to /home when there is no prior route.
        if (context.canPop()) {
          context.pop();
        } else {
          context.go('/home');
        }
      },
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
    );
  }

  /// Mirrors `AppRouter._openAnotherWorkspace`: re-discover instances and push
  /// the workspace picker, surfacing a snackbar (but still pushing) on failure.
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
}
