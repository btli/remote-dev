import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../domain/session_summary.dart';
import '../../../infrastructure/api/sessions_api.dart';
import '../shell/home_shell.dart';
import 'new_session_sheet.dart';

/// Provider for the sessions API. Must be overridden in main.dart / app.dart
/// once a [RemoteDevClient] is wired for the active server.
final sessionsApiProvider = Provider<SessionsApi>((ref) {
  throw UnimplementedError(
    'sessionsApiProvider must be overridden with SessionsApi(client) in main.dart',
  );
});

/// Map of projectId -> project name. Override in main.dart with the projects
/// API. Defaults to an empty map so the screen still renders names from
/// tmuxSessionName fallback.
final projectNamesProvider = FutureProvider<Map<String, String>>((ref) async {
  return const <String, String>{};
});

final sessionsListProvider =
    FutureProvider.autoDispose<List<SessionSummary>>((ref) async {
  return ref.watch(sessionsApiProvider).list();
});

class SessionsTabScreen extends ConsumerStatefulWidget {
  const SessionsTabScreen({super.key});

  @override
  ConsumerState<SessionsTabScreen> createState() => _SessionsTabScreenState();
}

class _SessionsTabScreenState extends ConsumerState<SessionsTabScreen> {
  Future<void> _refresh() async {
    ref.invalidate(sessionsListProvider);
    await ref.read(sessionsListProvider.future);
  }

  Future<bool> _confirmClose(SessionSummary session) async {
    final result = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: const Color(0xFF24283B),
        title: Text(
          'Close session?',
          style: const TextStyle(color: Colors.white),
        ),
        content: Text(
          '"${session.name}" will be closed and its tmux session killed.',
          style: const TextStyle(color: Colors.white70),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            style: TextButton.styleFrom(foregroundColor: const Color(0xFFF7768E)),
            child: const Text('Close'),
          ),
        ],
      ),
    );
    return result ?? false;
  }

  Future<void> _close(SessionSummary session) async {
    final api = ref.read(sessionsApiProvider);
    try {
      await api.close(session.id);
      await _refresh();
      if (!mounted) return;
      _showSnack('Session closed');
    } catch (e) {
      if (!mounted) return;
      _showSnack('Failed to close: $e');
    }
  }

  void _showSnack(String msg) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(msg), duration: const Duration(seconds: 2)),
    );
  }

  Future<void> _onNew() async {
    final created = await showNewSessionSheet(context);
    if (created != null && mounted) {
      // Refresh the list and navigate to the session view.
      ref.invalidate(sessionsListProvider);
      // push so the session view has an implicit back arrow that pops
      // to the Sessions tab inside HomeShell. Pass the created summary as
      // `extra` so the header shows the real name immediately (no list
      // round-trip).
      context.push('/home/session/${created.id}', extra: created);
    }
  }

  void _onTapSession(SessionSummary session) {
    // Pass the summary as `extra` so SessionViewScreen's header renders the
    // session name immediately instead of resolving it from the list.
    context.push('/home/session/${session.id}', extra: session);
  }

  @override
  Widget build(BuildContext context) {
    final asyncSessions = ref.watch(sessionsListProvider);
    final asyncProjects = ref.watch(projectNamesProvider);
    final projectNames = asyncProjects.asData?.value ?? const <String, String>{};

    return Scaffold(
      backgroundColor: const Color(0xFF1A1B26),
      appBar: AppBar(
        backgroundColor: const Color(0xFF1A1B26),
        title: const Text('Sessions', style: TextStyle(color: Colors.white)),
        actions: [
          IconButton(
            icon: const Icon(Icons.add, color: Colors.white),
            tooltip: 'New session',
            onPressed: _onNew,
          ),
        ],
      ),
      body: asyncSessions.when(
        loading: () => const Center(
          child: CupertinoActivityIndicator(color: Colors.white70),
        ),
        error: (err, _) => _ErrorView(
          message: 'Failed to load sessions',
          detail: '$err',
          onRetry: _refresh,
        ),
        data: (sessions) {
          if (sessions.isEmpty) {
            return _EmptyState(onNew: _onNew);
          }
          return RefreshIndicator(
            onRefresh: _refresh,
            color: const Color(0xFF7AA2F7),
            backgroundColor: const Color(0xFF24283B),
            child: ListView.separated(
              physics: const AlwaysScrollableScrollPhysics(),
              // Reserve space below the last row so it never tucks under the
              // host shell's bottom nav bar (or the Android gesture inset).
              padding: EdgeInsets.only(
                bottom: tabContentBottomPadding(context),
              ),
              itemCount: sessions.length,
              separatorBuilder: (_, __) => const Divider(
                color: Color(0xFF2F334D),
                height: 1,
              ),
              itemBuilder: (context, i) {
                final s = sessions[i];
                final project = s.projectId != null
                    ? projectNames[s.projectId!]
                    : null;
                return _SessionRow(
                  session: s,
                  projectName: project,
                  onTap: () => _onTapSession(s),
                  onClose: () => _close(s),
                  confirmClose: () => _confirmClose(s),
                );
              },
            ),
          );
        },
      ),
    );
  }
}

class _SessionRow extends StatelessWidget {
  const _SessionRow({
    required this.session,
    required this.projectName,
    required this.onTap,
    required this.onClose,
    required this.confirmClose,
  });

  final SessionSummary session;
  final String? projectName;
  final VoidCallback onTap;
  final VoidCallback onClose;
  final Future<bool> Function() confirmClose;

  @override
  Widget build(BuildContext context) {
    final subtitle = projectName ?? session.tmuxSessionName;
    return Dismissible(
      key: ValueKey('session-${session.id}'),
      direction: DismissDirection.endToStart,
      // Swipe-to-close: confirm via dialog, then close on accept.
      dismissThresholds: const {DismissDirection.endToStart: 0.6},
      confirmDismiss: (_) async {
        final ok = await confirmClose();
        if (ok) {
          onClose();
        }
        // Always return false: the row is removed when the list refetches.
        return false;
      },
      background: const SizedBox.shrink(),
      secondaryBackground: _SwipeBackground(),
      child: ListTile(
        onTap: onTap,
        leading: _ActivityPip(activity: session.activity),
        title: Text(
          session.name,
          style: const TextStyle(color: Colors.white),
          overflow: TextOverflow.ellipsis,
        ),
        subtitle: Text(
          subtitle,
          style: const TextStyle(color: Colors.white60, fontSize: 12),
          overflow: TextOverflow.ellipsis,
        ),
        trailing: const Icon(Icons.chevron_right, color: Colors.white38),
      ),
    );
  }
}

class _SwipeBackground extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return Container(
      color: const Color(0xFFF7768E),
      alignment: Alignment.centerRight,
      padding: const EdgeInsets.symmetric(horizontal: 24),
      child: const Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.close, color: Colors.white),
          SizedBox(width: 8),
          Text(
            'Close',
            style: TextStyle(color: Colors.white, fontWeight: FontWeight.w600),
          ),
        ],
      ),
    );
  }
}

class _ActivityPip extends StatelessWidget {
  const _ActivityPip({required this.activity});
  final AgentActivityStatus activity;

  @override
  Widget build(BuildContext context) {
    final color = _colorFor(activity);
    return SizedBox(
      width: 24,
      height: 24,
      child: Center(
        child: color == null
            ? const SizedBox.shrink()
            : Container(
                width: 10,
                height: 10,
                decoration: BoxDecoration(
                  color: color,
                  shape: BoxShape.circle,
                ),
              ),
      ),
    );
  }

  Color? _colorFor(AgentActivityStatus a) {
    switch (a) {
      case AgentActivityStatus.running:
        return const Color(0xFF9ECE6A);
      case AgentActivityStatus.waiting:
        return const Color(0xFFE0AF68);
      case AgentActivityStatus.idle:
        return const Color(0xFF565F89);
      case AgentActivityStatus.error:
        return const Color(0xFFF7768E);
      case AgentActivityStatus.subagent:
        return const Color(0xFFBB9AF7);
      case AgentActivityStatus.compacting:
        return const Color(0xFF7AA2F7);
      case AgentActivityStatus.ended:
        return const Color(0xFF565F89);
      case AgentActivityStatus.none:
        return null;
    }
  }
}

class _EmptyState extends StatelessWidget {
  const _EmptyState({required this.onNew});
  final VoidCallback onNew;

  @override
  Widget build(BuildContext context) {
    return ListView(
      // Allow pull-to-refresh on empty state too.
      physics: const AlwaysScrollableScrollPhysics(),
      children: [
        const SizedBox(height: 96),
        const Icon(
          Icons.list_alt,
          size: 48,
          color: Colors.white24,
        ),
        const SizedBox(height: 16),
        const Center(
          child: Text(
            'No sessions yet',
            style: TextStyle(color: Colors.white70, fontSize: 16),
          ),
        ),
        const SizedBox(height: 8),
        const Center(
          child: Text(
            'Create your first session to get started.',
            style: TextStyle(color: Colors.white38, fontSize: 13),
          ),
        ),
        const SizedBox(height: 24),
        Center(
          child: FilledButton.icon(
            onPressed: onNew,
            icon: const Icon(Icons.add),
            label: const Text('New session'),
            style: FilledButton.styleFrom(
              backgroundColor: const Color(0xFF7AA2F7),
              foregroundColor: const Color(0xFF1A1B26),
            ),
          ),
        ),
      ],
    );
  }
}

class _ErrorView extends StatelessWidget {
  const _ErrorView({
    required this.message,
    required this.detail,
    required this.onRetry,
  });
  final String message;
  final String detail;
  final Future<void> Function() onRetry;

  @override
  Widget build(BuildContext context) {
    return RefreshIndicator(
      onRefresh: onRetry,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        children: [
          const SizedBox(height: 96),
          const Icon(
            Icons.error_outline,
            size: 48,
            color: Color(0xFFF7768E),
          ),
          const SizedBox(height: 16),
          Center(
            child: Text(
              message,
              style: const TextStyle(color: Colors.white70, fontSize: 16),
            ),
          ),
          const SizedBox(height: 8),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 24),
            child: Text(
              detail,
              textAlign: TextAlign.center,
              style: const TextStyle(color: Colors.white38, fontSize: 12),
            ),
          ),
          const SizedBox(height: 24),
          Center(
            child: TextButton.icon(
              onPressed: onRetry,
              icon: const Icon(Icons.refresh, color: Color(0xFF7AA2F7)),
              label: const Text(
                'Retry',
                style: TextStyle(color: Color(0xFF7AA2F7)),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
