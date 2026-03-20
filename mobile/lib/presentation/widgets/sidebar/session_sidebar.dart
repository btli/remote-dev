import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import 'package:remote_dev/domain/entities/folder.dart';
import 'package:remote_dev/domain/entities/session.dart';
import 'package:remote_dev/presentation/screens/session/session_list_screen.dart';

/// Sidebar combining folder tree and session list.
///
/// Used as the persistent sidebar on tablets and as the drawer on phones.
class SessionSidebar extends StatelessWidget {
  const SessionSidebar({
    super.key,
    required this.sessions,
    required this.folders,
    required this.activeSessionId,
    required this.onSessionTap,
    required this.onCreateSession,
    required this.onRefresh,
    this.isLoading = false,
  });

  final List<Session> sessions;
  final List<Folder> folders;
  final String? activeSessionId;
  final void Function(Session session) onSessionTap;
  final VoidCallback onCreateSession;
  final Future<void> Function() onRefresh;
  final bool isLoading;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Container(
      color: theme.scaffoldBackgroundColor,
      child: SafeArea(
        child: Column(
          children: [
            // App branding
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
              child: Row(
                children: [
                  Icon(
                    Icons.terminal,
                    size: 20,
                    color: theme.colorScheme.primary,
                  ),
                  const SizedBox(width: 8),
                  Text(
                    'Remote Dev',
                    style: theme.textTheme.titleSmall?.copyWith(
                      fontWeight: FontWeight.bold,
                      color: theme.colorScheme.primary,
                    ),
                  ),
                ],
              ),
            ),

            const Divider(height: 1),

            // Session list (reuses the session list screen)
            Expanded(
              child: SessionListScreen(
                sessions: sessions,
                activeSessionId: activeSessionId,
                onSessionTap: onSessionTap,
                onCreateSession: onCreateSession,
                onRefresh: onRefresh,
                isLoading: isLoading,
              ),
            ),

            // Bottom actions
            const Divider(height: 1),
            Padding(
              padding: const EdgeInsets.all(8),
              child: Row(
                children: [
                  IconButton(
                    icon: const Icon(Icons.settings_outlined, size: 20),
                    onPressed: () => context.push('/settings'),
                    tooltip: 'Settings',
                  ),
                  const Spacer(),
                  Text(
                    '${sessions.length} sessions',
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: theme.colorScheme.onSurface.withValues(alpha: 0.4),
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
