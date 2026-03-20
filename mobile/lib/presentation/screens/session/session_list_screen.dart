import 'package:flutter/material.dart';

import 'package:remote_dev/domain/entities/session.dart';
import 'package:remote_dev/domain/value_objects/agent_provider.dart';

class SessionListScreen extends StatelessWidget {
  const SessionListScreen({
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

    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 8, 8),
          child: Row(
            children: [
              Text(
                'Sessions',
                style: theme.textTheme.titleMedium?.copyWith(
                  fontWeight: FontWeight.bold,
                ),
              ),
              const Spacer(),
              IconButton.filledTonal(
                icon: const Icon(Icons.add, size: 20),
                onPressed: onCreateSession,
                tooltip: 'New session',
                style: IconButton.styleFrom(
                  tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                  minimumSize: const Size(36, 36),
                ),
              ),
            ],
          ),
        ),
        Expanded(
          child: sessions.isEmpty
              ? _EmptyState(onCreateSession: onCreateSession)
              : RefreshIndicator(
                  onRefresh: onRefresh,
                  child: ListView.separated(
                    itemCount: sessions.length,
                    padding: const EdgeInsets.symmetric(
                      horizontal: 8,
                      vertical: 4,
                    ),
                    separatorBuilder: (_, __) => const SizedBox(height: 2),
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
        ),
      ],
    );
  }
}

class _SessionTile extends StatelessWidget {
  const _SessionTile({
    required this.session,
    required this.isActive,
    required this.onTap,
  });

  final Session session;
  final bool isActive;
  final VoidCallback onTap;

  Color _statusColor() {
    if (session.agentNeedsAttention) return Colors.red;

    return switch (session.agentActivityStatus) {
      AgentActivityStatus.running => Colors.green,
      AgentActivityStatus.waiting => Colors.amber,
      AgentActivityStatus.idle => Colors.grey,
      AgentActivityStatus.error => Colors.red,
      AgentActivityStatus.compacting => Colors.blue,
      null => session.isActive
          ? Colors.green.withValues(alpha: 0.5)
          : Colors.grey,
    };
  }

  IconData _typeIcon() =>
      session.isAgent ? Icons.smart_toy_outlined : Icons.terminal;

  String? _subtitle() {
    final parts = <String>[];

    final path = session.projectPath;
    if (path != null && path.isNotEmpty) {
      final projectName = path.split('/').lastWhere(
        (s) => s.isNotEmpty,
        orElse: () => '',
      );
      if (projectName.isNotEmpty) parts.add(projectName);
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

    return Material(
      color: isActive
          ? colorScheme.surfaceContainerHigh
          : Colors.transparent,
      borderRadius: BorderRadius.circular(12),
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
          child: Row(
            children: [
              Container(
                width: 8,
                height: 8,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: _statusColor(),
                ),
              ),
              const SizedBox(width: 10),
              Icon(
                _typeIcon(),
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
                            isActive ? FontWeight.w600 : FontWeight.normal,
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
    );
  }
}

class _EmptyState extends StatelessWidget {
  const _EmptyState({required this.onCreateSession});
  final VoidCallback onCreateSession;

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
            Container(
              width: 80,
              height: 80,
              decoration: BoxDecoration(
                color: colorScheme.surfaceContainerHigh,
                borderRadius: BorderRadius.circular(20),
              ),
              child: Icon(
                Icons.terminal,
                size: 40,
                color: colorScheme.onSurface.withValues(alpha: 0.3),
              ),
            ),
            const SizedBox(height: 20),
            Text(
              'No sessions yet',
              style: theme.textTheme.titleMedium?.copyWith(
                color: colorScheme.onSurface.withValues(alpha: 0.6),
              ),
            ),
            const SizedBox(height: 8),
            Text(
              'Create a terminal or agent session to get started',
              style: theme.textTheme.bodySmall?.copyWith(
                color: colorScheme.onSurface.withValues(alpha: 0.4),
              ),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 20),
            FilledButton.icon(
              onPressed: onCreateSession,
              icon: const Icon(Icons.add),
              label: const Text('Create session'),
            ),
          ],
        ),
      ),
    );
  }
}
