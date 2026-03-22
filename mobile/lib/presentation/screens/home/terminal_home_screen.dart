import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'package:remote_dev/domain/entities/session.dart';
import 'package:remote_dev/domain/value_objects/agent_provider.dart';
import 'package:remote_dev/presentation/providers/providers.dart';
import 'package:remote_dev/presentation/widgets/common/glassmorphic_container.dart';
import 'package:remote_dev/presentation/widgets/session/create_session_sheet.dart';
import 'package:remote_dev/presentation/widgets/sidebar/folder_tree.dart';

/// Terminal-first home screen with edge drawer navigation.
///
/// The terminal takes full viewport. UI chrome lives at the edges:
/// - Swipe from left edge → session drawer (frosted glass)
/// - Swipe from right edge → quick actions panel
/// - Floating status pill at top shows current session
/// - MobileInputBar + KeyboardToolbar at bottom
class TerminalHomeScreen extends ConsumerStatefulWidget {
  const TerminalHomeScreen({super.key, this.child});

  /// Terminal screen content (from GoRouter shell route).
  final Widget? child;

  @override
  ConsumerState<TerminalHomeScreen> createState() => _TerminalHomeScreenState();
}

class _TerminalHomeScreenState extends ConsumerState<TerminalHomeScreen> {
  final GlobalKey<ScaffoldState> _scaffoldKey = GlobalKey();

  void _openSessionDrawer() {
    HapticFeedback.lightImpact();
    _scaffoldKey.currentState?.openDrawer();
  }

  void _onCreateSession() {
    final folderId = ref.read(activeFolderIdProvider);
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: Colors.transparent,
      builder: (context) => GlassmorphicContainer.sheet(
        child: CreateSessionSheet(folderId: folderId),
      ),
    );
  }

  void _onSessionTap(Session session) {
    _scaffoldKey.currentState?.closeDrawer();
    HapticFeedback.selectionClick();
    ref.read(activeSessionIdProvider.notifier).state = session.id;
    context.go('/sessions/${session.id}');
  }

  Future<void> _onSessionClose(Session session) async {
    final activeId = ref.read(activeSessionIdProvider);
    await ref.read(sessionListProvider.notifier).closeSession(session.id);

    if (!mounted) return;
    HapticFeedback.mediumImpact();

    // If the closed session was the active one, navigate to empty state
    if (activeId == session.id) {
      _scaffoldKey.currentState?.closeDrawer();
      ref.read(activeSessionIdProvider.notifier).state = null;
      context.go('/sessions');
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;
    final activeSessionId = ref.watch(activeSessionIdProvider);
    final activeServer = ref.watch(activeServerConfigProvider);

    return Scaffold(
      key: _scaffoldKey,
      backgroundColor: colorScheme.surface,
      drawer: _SessionDrawer(
        serverName: activeServer?.displayName,
        onSessionTap: _onSessionTap,
        onSessionClose: _onSessionClose,
        onCreateSession: _onCreateSession,
        onServerTap: () {
          _scaffoldKey.currentState?.closeDrawer();
          context.push('/servers');
        },
      ),
      drawerEdgeDragWidth: 40,
      drawerEnableOpenDragGesture: true,
      body: Stack(
        children: [
          if (activeSessionId != null)
            widget.child ?? const SizedBox.expand()
          else
            _EmptyState(
              onCreateSession: _onCreateSession,
              onOpenDrawer: _openSessionDrawer,
            ),
          if (activeSessionId != null)
            Positioned(
              top: MediaQuery.of(context).padding.top + 8,
              left: 0,
              right: 0,
              child: Center(
                child: _StatusPill(
                  onTap: _openSessionDrawer,
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/// Session drawer with frosted glass surface.
class _SessionDrawer extends ConsumerWidget {
  const _SessionDrawer({
    required this.serverName,
    required this.onSessionTap,
    required this.onSessionClose,
    required this.onCreateSession,
    required this.onServerTap,
  });

  final String? serverName;
  final void Function(Session) onSessionTap;
  final Future<void> Function(Session) onSessionClose;
  final VoidCallback onCreateSession;
  final VoidCallback onServerTap;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;
    final drawerWidth = MediaQuery.of(context).size.width * 0.80;
    final sessions = ref.watch(filteredSessionsProvider);
    final activeSessionId = ref.watch(activeSessionIdProvider);

    return SizedBox(
      width: drawerWidth.clamp(280, 360).toDouble(),
      child: Drawer(
        child: GlassmorphicContainer.drawer(
          child: SafeArea(
            child: Column(
              children: [
                // Server indicator
                InkWell(
                  onTap: onServerTap,
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
                    child: Row(
                      children: [
                        Container(
                          width: 8,
                          height: 8,
                          decoration: BoxDecoration(
                            shape: BoxShape.circle,
                            color: colorScheme.primary,
                          ),
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            serverName ?? 'No server',
                            style: theme.textTheme.labelLarge?.copyWith(
                              color: colorScheme.onSurfaceVariant,
                            ),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                        Icon(
                          Icons.swap_horiz_rounded,
                          size: 18,
                          color: colorScheme.onSurfaceVariant,
                        ),
                      ],
                    ),
                  ),
                ),

                Divider(color: colorScheme.outlineVariant),

                // Folder tree (collapsible, filters sessions)
                ConstrainedBox(
                  constraints: BoxConstraints(
                    maxHeight: MediaQuery.of(context).size.height * 0.35,
                  ),
                  child: const SingleChildScrollView(
                    child: FolderTree(),
                  ),
                ),

                Divider(color: colorScheme.outlineVariant),

                // New session button
                Padding(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 12,
                    vertical: 4,
                  ),
                  child: FilledButton.icon(
                    onPressed: onCreateSession,
                    icon: const Icon(Icons.add_rounded, size: 18),
                    label: const Text('New Session'),
                    style: FilledButton.styleFrom(
                      minimumSize: const Size.fromHeight(40),
                    ),
                  ),
                ),

                const SizedBox(height: 4),

                // Session list
                Expanded(
                  child: sessions.isEmpty
                      ? Center(
                          child: Text(
                            'No sessions yet',
                            style: theme.textTheme.bodyMedium?.copyWith(
                              color: colorScheme.onSurfaceVariant,
                            ),
                          ),
                        )
                      : ListView.builder(
                          padding: const EdgeInsets.symmetric(horizontal: 8),
                          itemCount: sessions.length,
                          itemBuilder: (context, index) {
                            final session = sessions[index];
                            final isActive = session.id == activeSessionId;

                            return Dismissible(
                              key: ValueKey(session.id),
                              direction: DismissDirection.endToStart,
                              // Return false: the provider rebuild handles
                              // removal; letting Dismissible animate out would
                              // conflict with the list rebuilding.
                              confirmDismiss: (_) async {
                                await onSessionClose(session);
                                return false;
                              },
                              background: Container(
                                alignment: Alignment.centerRight,
                                padding: const EdgeInsets.only(right: 20),
                                margin: const EdgeInsets.symmetric(vertical: 1),
                                decoration: BoxDecoration(
                                  color: colorScheme.error,
                                  borderRadius: BorderRadius.circular(12),
                                ),
                                child: Icon(
                                  Icons.delete_outline_rounded,
                                  color: colorScheme.onError,
                                  size: 20,
                                ),
                              ),
                              child: _SessionTile(
                                session: session,
                                isActive: isActive,
                                onTap: () => onSessionTap(session),
                              ),
                            );
                          },
                        ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// A single session tile in the drawer.
class _SessionTile extends StatelessWidget {
  const _SessionTile({
    required this.session,
    required this.isActive,
    required this.onTap,
  });

  final Session session;
  final bool isActive;
  final VoidCallback onTap;

  Color _statusColor(ColorScheme colorScheme) {
    if (session.agentNeedsAttention) return colorScheme.error;

    return switch (session.agentActivityStatus) {
      AgentActivityStatus.running => Colors.green,
      AgentActivityStatus.waiting => Colors.amber,
      AgentActivityStatus.idle || AgentActivityStatus.ended => Colors.grey,
      AgentActivityStatus.error => colorScheme.error,
      AgentActivityStatus.compacting => Colors.blue,
      null => session.isActive
          ? colorScheme.primary
          : colorScheme.outlineVariant,
    };
  }

  IconData get _typeIcon =>
      session.isAgent ? Icons.smart_toy_outlined : Icons.terminal_rounded;

  String? _subtitle() {
    final parts = <String>[];

    final path = session.projectPath;
    if (path != null && path.isNotEmpty) {
      final segments = path.split('/').where((s) => s.isNotEmpty);
      if (segments.isNotEmpty) parts.add(segments.last);
    }

    final branch = session.worktreeBranch;
    if (branch != null && branch.isNotEmpty) {
      parts.add(branch);
    }

    if (session.isAgent && session.agentProvider.isAgent) {
      parts.add(session.agentProvider.displayName);
    }

    return parts.isEmpty ? null : parts.join(' \u00b7 ');
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;
    final subtitle = _subtitle();

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 1),
      child: Material(
        color: isActive
            ? colorScheme.primary.withValues(alpha: 0.12)
            : Colors.transparent,
        borderRadius: BorderRadius.circular(12),
        child: InkWell(
          borderRadius: BorderRadius.circular(12),
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
            child: Row(
              children: [
                Container(
                  width: 8,
                  height: 8,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: _statusColor(colorScheme),
                  ),
                ),
                const SizedBox(width: 10),
                Icon(
                  _typeIcon,
                  size: 18,
                  color: isActive
                      ? colorScheme.primary
                      : colorScheme.onSurface.withValues(alpha: 0.6),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        session.name,
                        style: theme.textTheme.bodyMedium?.copyWith(
                          fontWeight:
                              isActive ? FontWeight.w600 : FontWeight.w400,
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                      if (subtitle != null)
                        Padding(
                          padding: const EdgeInsets.only(top: 2),
                          child: Text(
                            subtitle,
                            style: theme.textTheme.bodySmall?.copyWith(
                              color: colorScheme.onSurface
                                  .withValues(alpha: 0.5),
                              fontSize: 11,
                            ),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                    ],
                  ),
                ),
                if (session.isSuspended)
                  Padding(
                    padding: const EdgeInsets.only(left: 8),
                    child: Icon(
                      Icons.pause_circle_outline,
                      size: 16,
                      color: colorScheme.onSurface.withValues(alpha: 0.4),
                    ),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Floating status pill showing current session info.
class _StatusPill extends ConsumerWidget {
  const _StatusPill({
    required this.onTap,
  });

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;
    final session = ref.watch(activeSessionProvider);

    if (session == null) return const SizedBox.shrink();

    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: onTap,
      child: GlassmorphicContainer.statusBar(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              session.isAgent
                  ? Icons.smart_toy_rounded
                  : Icons.terminal_rounded,
              size: 14,
              color: colorScheme.onSurface.withValues(alpha: 0.7),
            ),
            const SizedBox(width: 6),
            ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 160),
              child: Text(
                session.name,
                style: theme.textTheme.labelSmall?.copyWith(
                  color: colorScheme.onSurface.withValues(alpha: 0.8),
                  fontWeight: FontWeight.w500,
                ),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            ),
            const SizedBox(width: 4),
            Icon(
              Icons.keyboard_arrow_down_rounded,
              size: 14,
              color: colorScheme.onSurface.withValues(alpha: 0.5),
            ),
          ],
        ),
      ),
    );
  }
}

/// Empty state shown when no session is active.
class _EmptyState extends StatelessWidget {
  const _EmptyState({
    required this.onCreateSession,
    required this.onOpenDrawer,
  });

  final VoidCallback onCreateSession;
  final VoidCallback onOpenDrawer;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;

    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              Icons.terminal_rounded,
              size: 72,
              color: colorScheme.onSurface.withValues(alpha: 0.15),
            ),
            const SizedBox(height: 24),
            Text(
              'No active session',
              style: theme.textTheme.titleMedium?.copyWith(
                color: colorScheme.onSurface.withValues(alpha: 0.4),
              ),
            ),
            const SizedBox(height: 8),
            Text(
              'Swipe from the left edge to browse sessions\nor create a new one',
              style: theme.textTheme.bodyMedium?.copyWith(
                color: colorScheme.onSurface.withValues(alpha: 0.3),
              ),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 32),
            FilledButton.icon(
              onPressed: onCreateSession,
              icon: const Icon(Icons.add_rounded),
              label: const Text('New Session'),
            ),
            const SizedBox(height: 12),
            OutlinedButton.icon(
              onPressed: onOpenDrawer,
              icon: const Icon(Icons.menu_rounded),
              label: const Text('Browse Sessions'),
            ),
          ],
        ),
      ),
    );
  }
}
