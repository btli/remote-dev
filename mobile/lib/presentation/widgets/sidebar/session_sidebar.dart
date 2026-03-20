import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import 'package:remote_dev/domain/entities/session.dart';
import 'package:remote_dev/presentation/screens/session/session_list_screen.dart';
import 'package:remote_dev/presentation/widgets/sidebar/folder_tree.dart';

class SessionSidebar extends StatelessWidget {
  const SessionSidebar({
    super.key,
    required this.sessions,
    required this.activeSessionId,
    required this.onSessionTap,
    required this.onCreateSession,
    required this.onRefresh,
    this.isLoading = false,
  });

  final List<Session> sessions;
  final String? activeSessionId;
  final void Function(Session session) onSessionTap;
  final VoidCallback onCreateSession;
  final Future<void> Function() onRefresh;
  final bool isLoading;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;

    return Container(
      color: colorScheme.surfaceContainerLow,
      child: SafeArea(
        child: Column(
          children: [
            // Branding
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
              child: Row(
                children: [
                  Icon(
                    Icons.terminal,
                    size: 20,
                    color: colorScheme.primary,
                  ),
                  const SizedBox(width: 8),
                  Text(
                    'Remote Dev',
                    style: theme.textTheme.titleSmall?.copyWith(
                      fontWeight: FontWeight.bold,
                      color: colorScheme.primary,
                    ),
                  ),
                ],
              ),
            ),

            Divider(
              height: 1,
              color: colorScheme.outlineVariant,
            ),

            // Folder tree (scrollable, shares space with session list)
            const Flexible(
              child: SingleChildScrollView(
                child: FolderTree(),
              ),
            ),

            Divider(
              height: 1,
              color: colorScheme.outlineVariant,
            ),

            // Session list (shares remaining space)
            Flexible(
              flex: 2,
              child: SessionListScreen(
                sessions: sessions,
                activeSessionId: activeSessionId,
                onSessionTap: onSessionTap,
                onCreateSession: onCreateSession,
                onRefresh: onRefresh,
                isLoading: isLoading,
              ),
            ),

            Divider(
              height: 1,
              color: colorScheme.outlineVariant,
            ),

            // Bottom bar
            Padding(
              padding: const EdgeInsets.all(8),
              child: Row(
                children: [
                  IconButton.filledTonal(
                    icon: const Icon(Icons.settings_outlined, size: 20),
                    onPressed: () => context.push('/settings'),
                    tooltip: 'Settings',
                    style: IconButton.styleFrom(
                      tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                      minimumSize: const Size(36, 36),
                    ),
                  ),
                  const Spacer(),
                  Text(
                    '${sessions.length} sessions',
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: colorScheme.onSurface.withValues(alpha: 0.4),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
