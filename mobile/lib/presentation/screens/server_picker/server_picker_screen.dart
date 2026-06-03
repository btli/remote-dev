import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../domain/host_config.dart';
import '../../../domain/workspace_config.dart';
import '../../router/app_router.dart' show pushTokenRegistrarProvider;
import '../webview_host/session_route_host.dart'
    show activeWorkspaceProvider, hostWorkspaceStoreProvider;

/// One host together with the workspace(s) that belong to it. A
/// single-workspace host (migrated legacy server) carries exactly one
/// workspace whose `slug` is `''`; a multi-workspace (Supervisor) host carries
/// the instances the user has signed into.
@immutable
class HostEntry {
  const HostEntry({required this.host, required this.workspaces});

  final HostConfig host;
  final List<WorkspaceConfig> workspaces;

  /// A host is rendered as a single tappable row (no group header) when it has
  /// exactly one workspace AND that workspace is the implicit single-workspace
  /// one (empty slug). Multi-workspace hosts — or a single host that somehow
  /// owns several workspaces — render as a group with a header.
  bool get isSingleWorkspaceRow =>
      workspaces.length == 1 && workspaces.single.slug.isEmpty;
}

/// The picker's view of the Host/Workspace store: every host paired with its
/// workspaces, plus the id of the currently-active workspace (so the list can
/// mark it). Loaded from [HostWorkspaceStore] — the picker no longer reads the
/// legacy per-server store.
@immutable
class ServerPickerData {
  const ServerPickerData({required this.entries, required this.activeWorkspaceId});

  final List<HostEntry> entries;
  final String? activeWorkspaceId;

  bool get isEmpty => entries.isEmpty;
}

/// Loads hosts + workspaces from [HostWorkspaceStore] and groups them. Watches
/// [activeWorkspaceProvider] so that switching/deleting (which invalidates it)
/// also refreshes the active highlight here.
final serverPickerDataProvider =
    FutureProvider.autoDispose<ServerPickerData>((ref) async {
  final store = ref.watch(hostWorkspaceStoreProvider);
  // Depend on the active-connection provider so a switch elsewhere repaints the
  // active marker. A bare `watch` (not `.future`) means we re-run when it next
  // resolves but never suspend this provider on the active one's reload — the
  // host/workspace lists below are the real data source.
  ref.watch(activeWorkspaceProvider);

  final hosts = await store.loadHosts();
  final workspaces = await store.loadWorkspaces();
  final active = await store.loadActiveWorkspace();

  final byHost = <String, List<WorkspaceConfig>>{};
  for (final ws in workspaces) {
    (byHost[ws.hostId] ??= <WorkspaceConfig>[]).add(ws);
  }

  final entries = hosts
      .map(
        (h) => HostEntry(
          host: h,
          workspaces: byHost[h.id] ?? const <WorkspaceConfig>[],
        ),
      )
      .toList(growable: false);

  return ServerPickerData(entries: entries, activeWorkspaceId: active?.id);
});

/// Connection picker rebuilt on the Host/Workspace store.
///
/// - A single-workspace host renders as one row labelled by its workspace's
///   display name; tapping it activates that workspace.
/// - A multi-workspace host renders a header (its label) with its signed-into
///   workspaces beneath, each tappable to activate. Its header carries an
///   "open another workspace" affordance.
///
/// Selecting a workspace writes the NEW active pointer
/// (`store.setActiveWorkspace`) and invalidates [activeWorkspaceProvider]; it
/// never touches the legacy `active_server_id`.
class ServerPickerScreen extends ConsumerWidget {
  const ServerPickerScreen({
    required this.onSelectWorkspace,
    required this.onAddHost,
    this.onEditHost,
    this.onEditWorkspace,
    this.onOpenAnotherWorkspace,
    this.onTestBridge,
    super.key,
  });

  /// Tapping a workspace activates it. The router supplies a handler that sets
  /// the active workspace, invalidates [activeWorkspaceProvider], and navigates
  /// `/home`.
  final void Function(WorkspaceConfig) onSelectWorkspace;

  /// Add a brand-new host (routes to the host onboarding flow).
  final VoidCallback onAddHost;

  /// Edit a host's label. For a single-workspace host the sole workspace is
  /// passed too so the edit screen can rename its display name in the same
  /// pass; for a multi-workspace host header it is null. Null callback in tests
  /// that only assert the action sheet.
  final void Function(HostConfig, WorkspaceConfig? soleWorkspace)? onEditHost;

  /// Edit a single workspace's display name (multi-workspace hosts). For a
  /// single-workspace host the host edit screen edits both at once, so this is
  /// only wired for workspaces under a multi-workspace host.
  final void Function(HostConfig, WorkspaceConfig)? onEditWorkspace;

  /// Open another workspace under an already-linked multi-workspace host
  /// (re-lists instances via the Supervisor and pushes the workspace picker).
  final void Function(HostConfig)? onOpenAnotherWorkspace;

  final VoidCallback? onTestBridge;

  /// Best-effort push-token unregister for a workspace, run BEFORE its
  /// credentials are cleared (the registrar needs the per-workspace API key +
  /// host CF cookie to authenticate the DELETE). Never throws: a missing
  /// registrar override (dev builds without Firebase) or a network failure must
  /// not block deletion. The registrar itself also swallows its own failures.
  Future<void> _unregisterPushBestEffort(
    WidgetRef ref,
    String workspaceId,
  ) async {
    try {
      await ref
          .read(pushTokenRegistrarProvider)
          .unregisterWorkspace(workspaceId);
    } catch (_) {
      // Intentional: push unregister is best-effort. Deletion proceeds.
    }
  }

  Future<void> _deleteWorkspace(WidgetRef ref, WorkspaceConfig ws) async {
    // Unregister the push token FIRST, while the workspace's creds still exist
    // (removeWorkspace clears them). Best-effort — never blocks the delete.
    await _unregisterPushBestEffort(ref, ws.id);
    final store = ref.read(hostWorkspaceStoreProvider);
    await store.removeWorkspace(ws.id);
    ref.invalidate(activeWorkspaceProvider);
    ref.invalidate(serverPickerDataProvider);
  }

  Future<void> _deleteHost(WidgetRef ref, HostConfig host) async {
    final store = ref.read(hostWorkspaceStoreProvider);
    // Unregister every child workspace's push token BEFORE removeHost cascades
    // away their creds. Best-effort: a failed lookup/unregister must not block
    // the host delete. removeHost then clears creds + re-points/clears the
    // active pointer.
    try {
      final children = await store.loadWorkspaces(hostId: host.id);
      for (final ws in children) {
        await _unregisterPushBestEffort(ref, ws.id);
      }
    } catch (_) {
      // Intentional: enumerating children for unregister is best-effort.
    }
    await store.removeHost(host.id);
    ref.invalidate(activeWorkspaceProvider);
    ref.invalidate(serverPickerDataProvider);
  }

  Future<void> _showWorkspaceActionSheet(
    BuildContext context,
    WidgetRef ref,
    HostConfig host,
    WorkspaceConfig ws, {
    required bool isSingleWorkspaceRow,
  }) async {
    final action = await showModalBottomSheet<_RowAction>(
      context: context,
      backgroundColor: const Color(0xFF24283B),
      builder: (sheetCtx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.edit, color: Colors.white),
              title: const Text('Edit', style: TextStyle(color: Colors.white)),
              onTap: () => Navigator.of(sheetCtx).pop(_RowAction.edit),
            ),
            ListTile(
              leading: const Icon(Icons.delete, color: Colors.redAccent),
              title: const Text(
                'Delete',
                style: TextStyle(color: Colors.redAccent),
              ),
              onTap: () => Navigator.of(sheetCtx).pop(_RowAction.delete),
            ),
          ],
        ),
      ),
    );

    if (action == null) return;
    switch (action) {
      case _RowAction.edit:
        // For a single-workspace row, editing edits the host (label) AND its
        // workspace display name in one screen. For a workspace under a
        // multi-workspace host, edit just that workspace's display name.
        if (isSingleWorkspaceRow) {
          onEditHost?.call(host, ws);
        } else {
          onEditWorkspace?.call(host, ws);
        }
      case _RowAction.delete:
        if (isSingleWorkspaceRow) {
          // Deleting the only workspace of a single-workspace host removes the
          // whole host (cascading creds) so we don't strand an empty host row.
          await _deleteHost(ref, host);
        } else {
          await _deleteWorkspace(ref, ws);
        }
    }
  }

  Future<void> _showHostActionSheet(
    BuildContext context,
    WidgetRef ref,
    HostConfig host,
  ) async {
    final action = await showModalBottomSheet<_RowAction>(
      context: context,
      backgroundColor: const Color(0xFF24283B),
      builder: (sheetCtx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.edit, color: Colors.white),
              title: const Text(
                'Edit host',
                style: TextStyle(color: Colors.white),
              ),
              onTap: () => Navigator.of(sheetCtx).pop(_RowAction.edit),
            ),
            ListTile(
              leading: const Icon(Icons.delete, color: Colors.redAccent),
              title: const Text(
                'Delete host',
                style: TextStyle(color: Colors.redAccent),
              ),
              onTap: () => Navigator.of(sheetCtx).pop(_RowAction.delete),
            ),
          ],
        ),
      ),
    );

    if (action == null) return;
    switch (action) {
      case _RowAction.edit:
        onEditHost?.call(host, null);
      case _RowAction.delete:
        await _deleteHost(ref, host);
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final asyncData = ref.watch(serverPickerDataProvider);
    return Scaffold(
      backgroundColor: const Color(0xFF1A1B26),
      appBar: AppBar(
        backgroundColor: const Color(0xFF1A1B26),
        title: const Text('Servers', style: TextStyle(color: Colors.white)),
        actions: [
          // Bridge-spike entry point is a Phase 1.5 development POC; in release
          // builds it shows a non-interactive Cloudflare challenge that confuses
          // users, so gate it behind kDebugMode at compile time.
          if (kDebugMode && onTestBridge != null)
            IconButton(
              icon: const Icon(Icons.bug_report, color: Colors.white),
              tooltip: 'Test bridge',
              onPressed: onTestBridge,
            ),
          IconButton(
            icon: const Icon(Icons.add, color: Colors.white),
            onPressed: onAddHost,
          ),
        ],
      ),
      body: asyncData.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(
          child: Text(
            'Failed to load servers: $e',
            style: const TextStyle(color: Colors.white70),
          ),
        ),
        data: (data) {
          if (data.isEmpty) {
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
                      onPressed: onAddHost,
                      child: const Text('Add a server'),
                    ),
                  ],
                ),
              ),
            );
          }
          return ListView(
            children: [
              for (final entry in data.entries)
                ..._buildHostSection(
                  context,
                  ref,
                  entry,
                  activeWorkspaceId: data.activeWorkspaceId,
                ),
            ],
          );
        },
      ),
    );
  }

  List<Widget> _buildHostSection(
    BuildContext context,
    WidgetRef ref,
    HostEntry entry, {
    required String? activeWorkspaceId,
  }) {
    if (entry.isSingleWorkspaceRow) {
      final ws = entry.workspaces.single;
      return [
        _workspaceTile(
          context,
          ref,
          host: entry.host,
          ws: ws,
          // Single-workspace row title prefers the workspace display name and
          // falls back to the host label.
          title: ws.displayName.isNotEmpty ? ws.displayName : entry.host.label,
          subtitle: entry.host.origin,
          isActive: ws.id == activeWorkspaceId,
          isSingleWorkspaceRow: true,
        ),
      ];
    }

    // Multi-workspace host: a header (host label + origin) with its signed-into
    // workspaces beneath. The header long-press edits/deletes the host; the
    // trailing add-button opens another workspace.
    return [
      ListTile(
        title: Text(
          entry.host.label,
          style: const TextStyle(
            color: Colors.white,
            fontWeight: FontWeight.w600,
          ),
        ),
        subtitle: Text(
          entry.host.origin,
          style: const TextStyle(color: Colors.white54),
        ),
        trailing: onOpenAnotherWorkspace == null
            ? null
            : IconButton(
                icon: const Icon(Icons.add, color: Colors.white70),
                tooltip: 'Open another workspace',
                onPressed: () => onOpenAnotherWorkspace!(entry.host),
              ),
        onLongPress: () => _showHostActionSheet(context, ref, entry.host),
      ),
      if (entry.workspaces.isEmpty)
        const Padding(
          padding: EdgeInsets.only(left: 32, right: 16, bottom: 12),
          child: Align(
            alignment: Alignment.centerLeft,
            child: Text(
              'No workspaces opened yet.',
              style: TextStyle(color: Colors.white38, fontSize: 13),
            ),
          ),
        )
      else
        for (final ws in entry.workspaces)
          Padding(
            padding: const EdgeInsets.only(left: 16),
            child: _workspaceTile(
              context,
              ref,
              host: entry.host,
              ws: ws,
              title: ws.displayName.isNotEmpty ? ws.displayName : ws.slug,
              subtitle: ws.status == null
                  ? ws.slug
                  : '${ws.slug} · ${ws.status}',
              isActive: ws.id == activeWorkspaceId,
              isSingleWorkspaceRow: false,
            ),
          ),
      const Divider(color: Color(0xFF2F334D), height: 1),
    ];
  }

  Widget _workspaceTile(
    BuildContext context,
    WidgetRef ref, {
    required HostConfig host,
    required WorkspaceConfig ws,
    required String title,
    required String subtitle,
    required bool isActive,
    required bool isSingleWorkspaceRow,
  }) {
    return Dismissible(
      key: ValueKey(ws.id),
      direction: DismissDirection.endToStart,
      background: Container(
        color: Colors.red,
        alignment: Alignment.centerRight,
        padding: const EdgeInsets.only(right: 16),
        child: const Icon(Icons.delete, color: Colors.white),
      ),
      onDismissed: (_) {
        if (isSingleWorkspaceRow) {
          _deleteHost(ref, host);
        } else {
          _deleteWorkspace(ref, ws);
        }
      },
      child: ListTile(
        leading: isActive
            ? const Icon(Icons.check_circle, color: Color(0xFF9ECE6A))
            : const Icon(Icons.circle_outlined, color: Colors.white24),
        title: Text(title, style: const TextStyle(color: Colors.white)),
        subtitle: Text(
          subtitle,
          style: const TextStyle(color: Colors.white70),
        ),
        onTap: () => onSelectWorkspace(ws),
        onLongPress: () => _showWorkspaceActionSheet(
          context,
          ref,
          host,
          ws,
          isSingleWorkspaceRow: isSingleWorkspaceRow,
        ),
      ),
    );
  }
}

enum _RowAction { edit, delete }
