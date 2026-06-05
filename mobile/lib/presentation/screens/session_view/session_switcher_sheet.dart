import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../application/state/reauth_signal_provider.dart';
import '../../../domain/host_config.dart';
import '../../../domain/session_summary.dart';
import '../../../domain/workspace_config.dart';
import '../../../infrastructure/api/remote_dev_client.dart';
import '../../../infrastructure/api/sessions_api.dart';
import '../server_picker/server_picker_screen.dart'
    show serverPickerDataProvider;
import '../webview_host/session_route_host.dart'
    show hostWorkspaceStoreProvider, secureStorageProvider;

/// The session + its (host, workspace) the user picked in the switcher, so the
/// caller can switch the active workspace (when different) before navigating.
@immutable
class SessionSwitchTarget {
  const SessionSwitchTarget({
    required this.host,
    required this.workspace,
    required this.session,
  });

  final HostConfig host;
  final WorkspaceConfig workspace;
  final SessionSummary session;
}

/// Builds a [SessionsApi] for an ARBITRARY (host, workspace) — not just the
/// active one — so the switcher can list a non-active server's sessions. Wires
/// a per-workspace [RemoteDevClient] (origin + basePath + that workspace's
/// stored creds) with a NON-interactive reauth (a background list must never
/// pop a browser); tests override this to return fakes.
final switcherSessionsApiFactoryProvider =
    Provider<SessionsApi Function(HostConfig, WorkspaceConfig)>((ref) {
  final storage = ref.watch(secureStorageProvider);
  return (host, ws) => SessionsApi(
        RemoteDevClient.forWorkspace(
          origin: host.origin,
          basePath: ws.basePath,
          hostId: host.id,
          workspaceId: ws.id,
          storage: storage,
          onReauthNeeded: () =>
              ref.read(reauthSignalProvider.notifier).request(),
        ),
      );
});

/// Active+suspended sessions for the workspace with [workspaceId]. autoDispose
/// so the family entries are released when the switcher closes; a per-workspace
/// failure (not signed in / offline) surfaces as an AsyncError the section
/// renders inline with a retry.
final switcherSessionsProvider = FutureProvider.autoDispose
    .family<List<SessionSummary>, String>((ref, workspaceId) async {
  final store = ref.watch(hostWorkspaceStoreProvider);
  final workspaces = await store.loadWorkspaces();
  WorkspaceConfig? ws;
  for (final w in workspaces) {
    if (w.id == workspaceId) {
      ws = w;
      break;
    }
  }
  if (ws == null) return const <SessionSummary>[];
  final host = await store.loadHost(ws.hostId);
  if (host == null) return const <SessionSummary>[];
  return ref.watch(switcherSessionsApiFactoryProvider)(host, ws).list();
});

/// Shows the session switcher as a modal bottom sheet. Resolves to the picked
/// [SessionSwitchTarget], or null if dismissed.
Future<SessionSwitchTarget?> showSessionSwitcher(
  BuildContext context, {
  required String currentSessionId,
  required String currentWorkspaceId,
}) {
  return showModalBottomSheet<SessionSwitchTarget>(
    context: context,
    backgroundColor: const Color(0xFF1A1B26),
    isScrollControlled: true,
    showDragHandle: true,
    builder: (_) => SessionSwitcherSheet(
      currentSessionId: currentSessionId,
      currentWorkspaceId: currentWorkspaceId,
    ),
  );
}

/// Expandable grouped session switcher: every signed-in workspace is an
/// expandable row; expanding reveals that workspace's active sessions. The
/// current workspace starts expanded and the current session is marked. All
/// workspaces' sessions load in the background as soon as the sheet opens (each
/// row watches its own [switcherSessionsProvider]) and fill in as they arrive,
/// so expanding an already-loaded row is instant.
class SessionSwitcherSheet extends ConsumerStatefulWidget {
  const SessionSwitcherSheet({
    required this.currentSessionId,
    required this.currentWorkspaceId,
    super.key,
  });

  final String currentSessionId;
  final String currentWorkspaceId;

  @override
  ConsumerState<SessionSwitcherSheet> createState() =>
      _SessionSwitcherSheetState();
}

class _SessionSwitcherSheetState extends ConsumerState<SessionSwitcherSheet> {
  // Workspace ids whose section is expanded. The current workspace starts open.
  late final Set<String> _expanded = {widget.currentWorkspaceId};

  void _toggle(String workspaceId) {
    setState(() {
      if (!_expanded.remove(workspaceId)) _expanded.add(workspaceId);
    });
  }

  @override
  Widget build(BuildContext context) {
    final dataAsync = ref.watch(serverPickerDataProvider);
    final maxHeight = MediaQuery.sizeOf(context).height * 0.7;
    return SafeArea(
      top: false,
      child: ConstrainedBox(
        constraints: BoxConstraints(maxHeight: maxHeight),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Padding(
              padding: EdgeInsets.fromLTRB(20, 4, 20, 12),
              child: Align(
                alignment: Alignment.centerLeft,
                child: Text(
                  'Switch session',
                  style: TextStyle(
                    color: Colors.white,
                    fontSize: 16,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
            ),
            Flexible(
              child: dataAsync.when(
                loading: () => const Padding(
                  padding: EdgeInsets.all(32),
                  child: CupertinoActivityIndicator(color: Colors.white70),
                ),
                error: (e, _) => Padding(
                  padding: const EdgeInsets.all(24),
                  child: Text(
                    'Failed to load servers: $e',
                    style: const TextStyle(color: Colors.white70),
                  ),
                ),
                data: (data) {
                  final rows = <_WorkspaceRowData>[];
                  for (final entry in data.entries) {
                    for (final ws in entry.workspaces) {
                      rows.add(
                        _WorkspaceRowData(
                          host: entry.host,
                          workspace: ws,
                          isSingleWorkspaceRow: entry.isSingleWorkspaceRow,
                        ),
                      );
                    }
                  }
                  if (rows.isEmpty) {
                    return const Padding(
                      padding: EdgeInsets.all(24),
                      child: Text(
                        'No workspaces opened yet.',
                        style: TextStyle(color: Colors.white70),
                      ),
                    );
                  }
                  return ListView(
                    shrinkWrap: true,
                    padding: const EdgeInsets.only(bottom: 8),
                    children: [for (final r in rows) _buildSection(r)],
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildSection(_WorkspaceRowData row) {
    final ws = row.workspace;
    final isCurrentWorkspace = ws.id == widget.currentWorkspaceId;
    final expanded = _expanded.contains(ws.id);
    // Watch unconditionally so EVERY workspace's sessions load in the background
    // as soon as the sheet opens (and refresh in place as they resolve).
    final sessionsAsync = ref.watch(switcherSessionsProvider(ws.id));

    final title = row.isSingleWorkspaceRow
        ? (ws.displayName.isNotEmpty ? ws.displayName : row.host.label)
        : '${row.host.label} / '
            '${ws.displayName.isNotEmpty ? ws.displayName : ws.slug}';

    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        InkWell(
          onTap: () => _toggle(ws.id),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            child: Row(
              children: [
                Icon(
                  expanded ? Icons.expand_more : Icons.chevron_right,
                  color: Colors.white54,
                  size: 20,
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    title,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      color: Colors.white,
                      fontSize: 14,
                      fontWeight: isCurrentWorkspace
                          ? FontWeight.w600
                          : FontWeight.w400,
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                _SectionTrailing(sessions: sessionsAsync),
              ],
            ),
          ),
        ),
        if (expanded)
          _SectionBody(
            sessions: sessionsAsync,
            currentSessionId:
                isCurrentWorkspace ? widget.currentSessionId : null,
            onRetry: () => ref.invalidate(switcherSessionsProvider(ws.id)),
            onPick: (session) => Navigator.of(context).pop(
              SessionSwitchTarget(
                host: row.host,
                workspace: ws,
                session: session,
              ),
            ),
          ),
        const Divider(color: Color(0xFF2F334D), height: 1),
      ],
    );
  }
}

class _WorkspaceRowData {
  const _WorkspaceRowData({
    required this.host,
    required this.workspace,
    required this.isSingleWorkspaceRow,
  });
  final HostConfig host;
  final WorkspaceConfig workspace;
  final bool isSingleWorkspaceRow;
}

/// Trailing widget on a server row: a session-count badge once loaded, a
/// spinner while loading, or an error dot.
class _SectionTrailing extends StatelessWidget {
  const _SectionTrailing({required this.sessions});
  final AsyncValue<List<SessionSummary>> sessions;

  @override
  Widget build(BuildContext context) {
    return sessions.when(
      loading: () => const SizedBox(
        width: 14,
        height: 14,
        child: CupertinoActivityIndicator(color: Colors.white38, radius: 7),
      ),
      error: (_, __) => const Icon(
        Icons.error_outline,
        color: Color(0xFFF7768E),
        size: 16,
      ),
      data: (list) => Text(
        '${list.length}',
        style: const TextStyle(color: Colors.white38, fontSize: 13),
      ),
    );
  }
}

class _SectionBody extends StatelessWidget {
  const _SectionBody({
    required this.sessions,
    required this.currentSessionId,
    required this.onRetry,
    required this.onPick,
  });

  final AsyncValue<List<SessionSummary>> sessions;
  final String? currentSessionId;
  final VoidCallback onRetry;
  final ValueChanged<SessionSummary> onPick;

  @override
  Widget build(BuildContext context) {
    return sessions.when(
      loading: () => const Padding(
        padding: EdgeInsets.symmetric(vertical: 16),
        child: CupertinoActivityIndicator(color: Colors.white38),
      ),
      error: (_, __) => Padding(
        padding: const EdgeInsets.fromLTRB(48, 4, 16, 12),
        child: Row(
          children: [
            const Expanded(
              child: Text(
                "Couldn't load sessions",
                style: TextStyle(color: Colors.white54, fontSize: 13),
              ),
            ),
            TextButton(
              onPressed: onRetry,
              child: const Text(
                'Retry',
                style: TextStyle(color: Color(0xFF7AA2F7)),
              ),
            ),
          ],
        ),
      ),
      data: (list) {
        if (list.isEmpty) {
          return const Padding(
            padding: EdgeInsets.fromLTRB(48, 4, 16, 12),
            child: Align(
              alignment: Alignment.centerLeft,
              child: Text(
                'No active sessions',
                style: TextStyle(color: Colors.white38, fontSize: 13),
              ),
            ),
          );
        }
        return Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            for (final s in list)
              _SwitcherSessionRow(
                session: s,
                isCurrent: s.id == currentSessionId,
                onTap: () => onPick(s),
              ),
          ],
        );
      },
    );
  }
}

class _SwitcherSessionRow extends StatelessWidget {
  const _SwitcherSessionRow({
    required this.session,
    required this.isCurrent,
    required this.onTap,
  });
  final SessionSummary session;
  final bool isCurrent;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return ListTile(
      contentPadding: const EdgeInsets.only(left: 44, right: 12),
      dense: true,
      tileColor: isCurrent ? const Color(0xFF24283B) : null,
      leading: _SwitcherPip(activity: session.activity),
      title: Text(
        session.name,
        overflow: TextOverflow.ellipsis,
        style: const TextStyle(color: Colors.white, fontSize: 14),
      ),
      subtitle: Text(
        session.tmuxSessionName,
        overflow: TextOverflow.ellipsis,
        style: const TextStyle(color: Colors.white38, fontSize: 12),
      ),
      trailing: isCurrent
          ? const Text(
              'current',
              style: TextStyle(color: Color(0xFF9ECE6A), fontSize: 12),
            )
          : const Icon(Icons.chevron_right, color: Colors.white38, size: 20),
      onTap: onTap,
    );
  }
}

/// Activity pip mirroring the Sessions tab's colour mapping.
class _SwitcherPip extends StatelessWidget {
  const _SwitcherPip({required this.activity});
  final AgentActivityStatus activity;

  @override
  Widget build(BuildContext context) {
    final color = switch (activity) {
      AgentActivityStatus.running => const Color(0xFF9ECE6A),
      AgentActivityStatus.waiting => const Color(0xFFE0AF68),
      AgentActivityStatus.idle => const Color(0xFF565F89),
      AgentActivityStatus.error => const Color(0xFFF7768E),
      AgentActivityStatus.none => null,
    };
    return SizedBox(
      width: 20,
      height: 20,
      child: Center(
        child: color == null
            ? const SizedBox.shrink()
            : Container(
                width: 9,
                height: 9,
                decoration: BoxDecoration(color: color, shape: BoxShape.circle),
              ),
      ),
    );
  }
}
