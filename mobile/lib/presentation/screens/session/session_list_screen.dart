import 'package:flutter/material.dart';

import 'package:remote_dev/domain/entities/session.dart';
import 'package:remote_dev/domain/value_objects/agent_provider.dart';

/// Session list screen showing all active/suspended sessions.
///
/// On phone: full-screen list with pull-to-refresh.
/// On tablet: rendered as the sidebar panel in AdaptiveScaffold.
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
        // Header
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
              IconButton(
                icon: const Icon(Icons.add, size: 20),
                onPressed: onCreateSession,
                tooltip: 'New session',
              ),
            ],
          ),
        ),

        // Session list
        Expanded(
          child: sessions.isEmpty
              ? _EmptyState(onCreateSession: onCreateSession)
              : RefreshIndicator(
                  onRefresh: onRefresh,
                  child: ListView.builder(
                    itemCount: sessions.length,
                    padding: const EdgeInsets.symmetric(horizontal: 8),
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
      null => session.isActive ? Colors.green.withValues(alpha: 0.5) : Colors.grey,
    };
  }

  IconData _typeIcon() => session.isAgent
      ? Icons.smart_toy_outlined
      : Icons.terminal;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Material(
      color: isActive
          ? theme.colorScheme.primary.withValues(alpha: 0.1)
          : Colors.transparent,
      borderRadius: BorderRadius.circular(8),
      child: InkWell(
        borderRadius: BorderRadius.circular(8),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          child: Row(
            children: [
              // Status dot
              Container(
                width: 8,
                height: 8,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: _statusColor(),
                ),
              ),
              const SizedBox(width: 10),
              // Type icon
              Icon(_typeIcon(), size: 16, color: theme.colorScheme.onSurface.withValues(alpha: 0.6)),
              const SizedBox(width: 8),
              // Session name
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      session.name,
                      style: theme.textTheme.bodyMedium?.copyWith(
                        fontWeight: isActive ? FontWeight.w600 : FontWeight.normal,
                      ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    if (session.isAgent && session.agentProvider.isAgent)
                      Text(
                        session.agentProvider.displayName,
                        style: theme.textTheme.bodySmall?.copyWith(
                          color: theme.colorScheme.onSurface.withValues(alpha: 0.5),
                          fontSize: 11,
                        ),
                      ),
                  ],
                ),
              ),
              // Suspended indicator
              if (session.isSuspended)
                Icon(
                  Icons.pause_circle_outline,
                  size: 16,
                  color: theme.colorScheme.onSurface.withValues(alpha: 0.4),
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

    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            Icons.terminal,
            size: 48,
            color: theme.colorScheme.onSurface.withValues(alpha: 0.3),
          ),
          const SizedBox(height: 16),
          Text(
            'No sessions yet',
            style: theme.textTheme.bodyLarge?.copyWith(
              color: theme.colorScheme.onSurface.withValues(alpha: 0.5),
            ),
          ),
          const SizedBox(height: 8),
          FilledButton.icon(
            onPressed: onCreateSession,
            icon: const Icon(Icons.add),
            label: const Text('Create session'),
          ),
        ],
      ),
    );
  }
}
