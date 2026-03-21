import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'package:remote_dev/presentation/providers/providers.dart';
import 'package:remote_dev/presentation/widgets/common/adaptive_scaffold.dart';
import 'package:remote_dev/presentation/widgets/session/create_session_sheet.dart';
import 'package:remote_dev/presentation/widgets/sidebar/session_sidebar.dart';

/// Main orchestrator screen with sidebar + terminal area.
///
/// - Phone: tapping a session navigates to `/sessions/:id`
/// - Tablet: embedded terminal area next to sidebar
class HomeScreen extends ConsumerStatefulWidget {
  const HomeScreen({super.key});

  @override
  ConsumerState<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends ConsumerState<HomeScreen> {
  void _onCreateSession() {
    final folderId = ref.read(activeFolderIdProvider);
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (context) => CreateSessionSheet(folderId: folderId),
    );
  }

  @override
  Widget build(BuildContext context) {
    final sessionsAsync = ref.watch(sessionListProvider);
    final activeSessionId = ref.watch(activeSessionIdProvider);
    final isTablet =
        MediaQuery.of(context).size.width >= kTabletBreakpoint;

    // Use filtered sessions for display
    final sessions = ref.watch(filteredSessionsProvider);

    final sidebar = SessionSidebar(
      sessions: sessions,
      activeSessionId: activeSessionId,
      onSessionTap: (session) {
        ref.read(activeSessionIdProvider.notifier).state = session.id;
        if (!isTablet) {
          // Close drawer on phone, then navigate
          Navigator.of(context).maybePop();
          context.push('/sessions/${session.id}');
        }
      },
      onCreateSession: _onCreateSession,
      onRefresh: () async {
        await ref.read(sessionListProvider.notifier).refresh();
        await ref.read(folderListProvider.notifier).refresh();
      },
      isLoading: sessionsAsync.isLoading,
    );

    final body = activeSessionId != null && isTablet
        ? _TerminalPlaceholder(
            onTap: () => context.push('/sessions/$activeSessionId'),
          )
        : _EmptyBody(onCreateSession: _onCreateSession);

    return AdaptiveScaffold(
      title: const Text('Remote Dev'),
      sidebar: sidebar,
      body: body,
      floatingActionButton: FloatingActionButton(
        onPressed: _onCreateSession,
        child: const Icon(Icons.add),
      ),
    );
  }
}

class _EmptyBody extends StatelessWidget {
  const _EmptyBody({required this.onCreateSession});
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
            size: 64,
            color: theme.colorScheme.onSurface.withValues(alpha: 0.2),
          ),
          const SizedBox(height: 16),
          Text(
            'Select a session or create a new one',
            style: theme.textTheme.bodyLarge?.copyWith(
              color: theme.colorScheme.onSurface.withValues(alpha: 0.4),
            ),
          ),
        ],
      ),
    );
  }
}

class _TerminalPlaceholder extends StatelessWidget {
  const _TerminalPlaceholder({required this.onTap});
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return GestureDetector(
      onTap: onTap,
      child: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              Icons.open_in_new,
              size: 48,
              color: theme.colorScheme.primary.withValues(alpha: 0.6),
            ),
            const SizedBox(height: 12),
            Text(
              'Tap to open terminal',
              style: theme.textTheme.bodyLarge?.copyWith(
                color: theme.colorScheme.primary.withValues(alpha: 0.6),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
