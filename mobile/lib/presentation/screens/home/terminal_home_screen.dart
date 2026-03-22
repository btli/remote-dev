import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'package:remote_dev/domain/entities/session.dart';
import 'package:remote_dev/presentation/providers/providers.dart';
import 'package:remote_dev/presentation/widgets/common/glassmorphic_container.dart';
import 'package:remote_dev/presentation/widgets/session/create_session_sheet.dart';

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
  ConsumerState<TerminalHomeScreen> createState() =>
      _TerminalHomeScreenState();
}

class _TerminalHomeScreenState extends ConsumerState<TerminalHomeScreen> {
  final GlobalKey<ScaffoldState> _scaffoldKey = GlobalKey();
  bool _showQuickActions = false;

  void _openSessionDrawer() {
    HapticFeedback.lightImpact();
    _scaffoldKey.currentState?.openDrawer();
  }

  void _onCreateSession() {
    setState(() => _showQuickActions = false);
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
    ref.read(activeSessionIdProvider.notifier).state = session.id;
    Navigator.of(context).maybePop(); // Close drawer
    HapticFeedback.selectionClick();
    context.go('/sessions/${session.id}');
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;
    final sessions = ref.watch(filteredSessionsProvider);
    final activeSessionId = ref.watch(activeSessionIdProvider);
    final activeServer = ref.watch(activeServerConfigProvider);

    return Scaffold(
      key: _scaffoldKey,
      backgroundColor: colorScheme.surface,
      drawer: _SessionDrawer(
        sessions: sessions,
        activeSessionId: activeSessionId,
        serverName: activeServer?.displayName,
        onSessionTap: _onSessionTap,
        onCreateSession: _onCreateSession,
        onServerTap: () {
          Navigator.of(context).maybePop();
          context.push('/servers');
        },
      ),
      drawerEdgeDragWidth: 40,
      drawerEnableOpenDragGesture: true,
      body: Stack(
        children: [
          widget.child ??
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

          if (_showQuickActions)
            Positioned(
              right: 0,
              top: 0,
              bottom: 0,
              child: GestureDetector(
                onHorizontalDragEnd: (details) {
                  if (details.primaryVelocity != null &&
                      details.primaryVelocity! > 0) {
                    setState(() => _showQuickActions = false);
                  }
                },
                child: _QuickActionsPanel(
                  onCreateSession: _onCreateSession,
                  onSettings: () {
                    setState(() => _showQuickActions = false);
                    context.push('/settings');
                  },
                  onServers: () {
                    setState(() => _showQuickActions = false);
                    context.push('/servers');
                  },
                  onClose: () => setState(() => _showQuickActions = false),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/// Session drawer with frosted glass surface.
class _SessionDrawer extends StatelessWidget {
  const _SessionDrawer({
    required this.sessions,
    required this.activeSessionId,
    required this.serverName,
    required this.onSessionTap,
    required this.onCreateSession,
    required this.onServerTap,
  });

  final List<Session> sessions;
  final String? activeSessionId;
  final String? serverName;
  final void Function(Session) onSessionTap;
  final VoidCallback onCreateSession;
  final VoidCallback onServerTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;
    final drawerWidth = MediaQuery.of(context).size.width * 0.80;

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

                            return _SessionTile(
                              session: session,
                              isActive: isActive,
                              onTap: () => onSessionTap(session),
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
    if (session.isAgent) {
      if (session.agentNeedsAttention) return colorScheme.error;
      if (session.agentIsWaiting) return Colors.amber;
      return colorScheme.primary;
    }
    if (session.isActive) return colorScheme.primary;
    return colorScheme.outlineVariant;
  }

  IconData get _typeIcon {
    if (session.isAgent) return Icons.smart_toy_rounded;
    return Icons.terminal_rounded;
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 1),
      child: ListTile(
        dense: true,
        visualDensity: VisualDensity.compact,
        selected: isActive,
        selectedColor: colorScheme.primary,
        selectedTileColor: colorScheme.primary.withValues(alpha: 0.12),
        leading: Icon(_typeIcon, size: 18),
        title: Text(
          session.name,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: theme.textTheme.bodyMedium?.copyWith(
            fontWeight: isActive ? FontWeight.w600 : FontWeight.w400,
          ),
        ),
        trailing: Container(
          width: 8,
          height: 8,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            color: _statusColor(colorScheme),
          ),
        ),
        onTap: onTap,
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

/// Quick actions panel (right edge).
class _QuickActionsPanel extends StatelessWidget {
  const _QuickActionsPanel({
    required this.onCreateSession,
    required this.onSettings,
    required this.onServers,
    required this.onClose,
  });

  final VoidCallback onCreateSession;
  final VoidCallback onSettings;
  final VoidCallback onServers;
  final VoidCallback onClose;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;

    return GlassmorphicContainer.panel(
      width: 200,
      child: SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: Row(
                  children: [
                    Text(
                      'Quick Actions',
                      style: theme.textTheme.labelLarge?.copyWith(
                        color: colorScheme.onSurface.withValues(alpha: 0.7),
                      ),
                    ),
                    const Spacer(),
                    IconButton(
                      icon: const Icon(Icons.close_rounded, size: 18),
                      onPressed: onClose,
                      visualDensity: VisualDensity.compact,
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 8),
              _QuickAction(
                icon: Icons.add_rounded,
                label: 'New Session',
                onTap: onCreateSession,
              ),
              const Divider(indent: 16, endIndent: 16),
              _QuickAction(
                icon: Icons.dns_rounded,
                label: 'Servers',
                onTap: onServers,
              ),
              _QuickAction(
                icon: Icons.settings_rounded,
                label: 'Settings',
                onTap: onSettings,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _QuickAction extends StatelessWidget {
  const _QuickAction({
    required this.icon,
    required this.label,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return ListTile(
      dense: true,
      visualDensity: VisualDensity.compact,
      leading: Icon(icon, size: 20),
      title: Text(
        label,
        style: theme.textTheme.bodyMedium,
      ),
      onTap: onTap,
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
