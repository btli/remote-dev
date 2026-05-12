import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../domain/notification.dart';
import '../../../infrastructure/api/notifications_api.dart';
import '../shell/home_shell.dart';

/// Provider for the notifications API. Must be overridden in main.dart /
/// app.dart once a [RemoteDevClient] is wired for the active server.
final notificationsApiProvider = Provider<NotificationsApi>((ref) {
  throw UnimplementedError(
    'notificationsApiProvider must be overridden with NotificationsApi(client) in main.dart',
  );
});

/// Filter applied to the notifications list.
enum NotificationFilter {
  all('all', 'All'),
  unread('unread', 'Unread'),
  mentions('mentions', 'Mentions');

  const NotificationFilter(this.queryValue, this.label);
  final String queryValue;
  final String label;
}

/// Family-keyed list provider — re-fetches when the filter changes.
final notificationsListProvider = FutureProvider.autoDispose
    .family<List<AppNotification>, NotificationFilter>((ref, filter) async {
  return ref.watch(notificationsApiProvider).list(filter: filter.queryValue);
});

class NotificationsTabScreen extends ConsumerStatefulWidget {
  const NotificationsTabScreen({super.key});

  @override
  ConsumerState<NotificationsTabScreen> createState() =>
      _NotificationsTabScreenState();
}

class _NotificationsTabScreenState
    extends ConsumerState<NotificationsTabScreen> {
  NotificationFilter _filter = NotificationFilter.all;

  Future<void> _refresh() async {
    ref.invalidate(notificationsListProvider(_filter));
    await ref.read(notificationsListProvider(_filter).future);
  }

  void _selectFilter(NotificationFilter filter) {
    if (filter == _filter) return;
    setState(() => _filter = filter);
  }

  Future<void> _markAllRead() async {
    final api = ref.read(notificationsApiProvider);
    try {
      await api.markAllRead();
      await _refresh();
      if (!mounted) return;
      _showSnack('Marked all as read');
    } catch (e) {
      if (!mounted) return;
      _showSnack('Failed to mark all read: $e');
    }
  }

  Future<void> _markRead(AppNotification notif) async {
    if (notif.read) return;
    final api = ref.read(notificationsApiProvider);
    try {
      await api.markRead([notif.id]);
      await _refresh();
    } catch (e) {
      if (!mounted) return;
      _showSnack('Failed to mark read: $e');
    }
  }

  Future<void> _dismiss(AppNotification notif) async {
    final api = ref.read(notificationsApiProvider);
    try {
      await api.dismiss(notif.id);
      await _refresh();
      if (!mounted) return;
      _showSnack('Notification dismissed');
    } catch (e) {
      if (!mounted) return;
      _showSnack('Failed to dismiss: $e');
    }
  }

  Future<void> _dismissAll() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: const Color(0xFF24283B),
        title: const Text(
          'Clear all notifications?',
          style: TextStyle(color: Colors.white),
        ),
        content: const Text(
          'This will permanently dismiss all notifications. '
          'This action cannot be undone.',
          style: TextStyle(color: Colors.white70),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            style:
                TextButton.styleFrom(foregroundColor: const Color(0xFFF7768E)),
            child: const Text('Clear all'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    if (!mounted) return;
    final api = ref.read(notificationsApiProvider);
    try {
      await api.dismissAll();
      if (!mounted) return;
      await _refresh();
      if (!mounted) return;
      _showSnack('All notifications dismissed');
    } catch (e) {
      if (!mounted) return;
      _showSnack('Failed to dismiss all: $e');
    }
  }

  void _showSnack(String msg) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(msg), duration: const Duration(seconds: 2)),
    );
  }

  void _onTapNotification(AppNotification notif) {
    // Mark read first (fire-and-forget); navigation should not block on it.
    if (!notif.read) {
      // ignore: discarded_futures
      _markRead(notif);
    }
    if (notif.sessionId != null && notif.sessionId!.isNotEmpty) {
      // push so the session view has an implicit back arrow that pops
      // to the Notifications tab inside HomeShell.
      context.push('/home/session/${notif.sessionId}');
    } else if (notif.channelId != null && notif.channelId!.isNotEmpty) {
      context.push('/home/channel/${notif.channelId}');
    }
    // Otherwise remain on the tab.
  }

  @override
  Widget build(BuildContext context) {
    final asyncList = ref.watch(notificationsListProvider(_filter));
    final hasItems = asyncList.valueOrNull?.isNotEmpty ?? false;

    return Scaffold(
      backgroundColor: const Color(0xFF1A1B26),
      appBar: AppBar(
        backgroundColor: const Color(0xFF1A1B26),
        title: const Text(
          'Notifications',
          style: TextStyle(color: Colors.white),
        ),
        actions: [
          TextButton(
            onPressed: _markAllRead,
            child: const Text(
              'Mark all read',
              style: TextStyle(color: Color(0xFF7AA2F7)),
            ),
          ),
          if (hasItems)
            TextButton(
              onPressed: _dismissAll,
              child: const Text(
                'Clear all',
                style: TextStyle(color: Color(0xFFF7768E)),
              ),
            ),
        ],
      ),
      body: Column(
        children: [
          _FilterChipRow(active: _filter, onSelected: _selectFilter),
          Expanded(
            child: asyncList.when(
              loading: () => const Center(
                child: CupertinoActivityIndicator(color: Colors.white70),
              ),
              error: (err, _) => _ErrorView(
                message: 'Failed to load notifications',
                detail: '$err',
                onRetry: _refresh,
              ),
              data: (items) {
                if (items.isEmpty) {
                  return _EmptyState(filter: _filter, onRefresh: _refresh);
                }
                return RefreshIndicator(
                  onRefresh: _refresh,
                  color: const Color(0xFF7AA2F7),
                  backgroundColor: const Color(0xFF24283B),
                  child: ListView.separated(
                    physics: const AlwaysScrollableScrollPhysics(),
                    // Reserve space below the last row so it never tucks
                    // under the host shell's bottom nav bar (or the Android
                    // gesture inset).
                    padding: EdgeInsets.only(
                      bottom: tabContentBottomPadding(context),
                    ),
                    itemCount: items.length,
                    separatorBuilder: (_, __) => const Divider(
                      color: Color(0xFF2F334D),
                      height: 1,
                    ),
                    itemBuilder: (context, i) {
                      final n = items[i];
                      return _NotificationRow(
                        notification: n,
                        onTap: () => _onTapNotification(n),
                        onDismiss: () => _dismiss(n),
                        onMarkRead: () => _markRead(n),
                      );
                    },
                  ),
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}

class _FilterChipRow extends StatelessWidget {
  const _FilterChipRow({required this.active, required this.onSelected});

  final NotificationFilter active;
  final ValueChanged<NotificationFilter> onSelected;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
      child: Row(
        children: [
          for (final filter in NotificationFilter.values) ...[
            FilterChip(
              label: Text(filter.label),
              selected: filter == active,
              onSelected: (_) => onSelected(filter),
              backgroundColor: const Color(0xFF24283B),
              selectedColor: const Color(0xFF7AA2F7),
              checkmarkColor: const Color(0xFF1A1B26),
              labelStyle: TextStyle(
                color: filter == active
                    ? const Color(0xFF1A1B26)
                    : Colors.white70,
                fontWeight: FontWeight.w600,
              ),
              side: const BorderSide(color: Color(0xFF2F334D)),
            ),
            const SizedBox(width: 8),
          ],
        ],
      ),
    );
  }
}

class _NotificationRow extends StatelessWidget {
  const _NotificationRow({
    required this.notification,
    required this.onTap,
    required this.onDismiss,
    required this.onMarkRead,
  });

  final AppNotification notification;
  final VoidCallback onTap;
  final VoidCallback onDismiss;
  final VoidCallback onMarkRead;

  @override
  Widget build(BuildContext context) {
    final isUnread = !notification.read;
    return Dismissible(
      key: ValueKey('notif-${notification.id}'),
      // Right-to-left swipe (endToStart) → dismiss / delete (red).
      // Left-to-right swipe (startToEnd) → mark read (green).
      background: const _SwipeBackground(
        color: Color(0xFF9ECE6A),
        icon: Icons.mark_email_read,
        label: 'Read',
        alignment: Alignment.centerLeft,
      ),
      secondaryBackground: const _SwipeBackground(
        color: Color(0xFFF7768E),
        icon: Icons.delete_outline,
        label: 'Dismiss',
        alignment: Alignment.centerRight,
      ),
      confirmDismiss: (direction) async {
        if (direction == DismissDirection.endToStart) {
          onDismiss();
        } else {
          onMarkRead();
        }
        // Always return false; the row is removed when the list refetches.
        return false;
      },
      child: ListTile(
        onTap: onTap,
        leading: SizedBox(
          width: 12,
          height: 12,
          child: Center(
            child: isUnread
                ? Container(
                    width: 8,
                    height: 8,
                    decoration: const BoxDecoration(
                      color: Color(0xFF7AA2F7),
                      shape: BoxShape.circle,
                    ),
                  )
                : const SizedBox.shrink(),
          ),
        ),
        title: Text(
          notification.title,
          style: TextStyle(
            color: Colors.white,
            fontWeight: isUnread ? FontWeight.w600 : FontWeight.w400,
          ),
          overflow: TextOverflow.ellipsis,
        ),
        subtitle: Text(
          notification.body,
          style: const TextStyle(color: Colors.white60, fontSize: 12),
          maxLines: 2,
          overflow: TextOverflow.ellipsis,
        ),
        trailing: const Icon(Icons.chevron_right, color: Colors.white38),
      ),
    );
  }
}

class _SwipeBackground extends StatelessWidget {
  const _SwipeBackground({
    required this.color,
    required this.icon,
    required this.label,
    required this.alignment,
  });

  final Color color;
  final IconData icon;
  final String label;
  final Alignment alignment;

  @override
  Widget build(BuildContext context) {
    final isLeft = alignment == Alignment.centerLeft;
    return Container(
      color: color,
      alignment: alignment,
      padding: const EdgeInsets.symmetric(horizontal: 24),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: isLeft
            ? [
                Icon(icon, color: Colors.white),
                const SizedBox(width: 8),
                Text(
                  label,
                  style: const TextStyle(
                    color: Colors.white,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ]
            : [
                Text(
                  label,
                  style: const TextStyle(
                    color: Colors.white,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(width: 8),
                Icon(icon, color: Colors.white),
              ],
      ),
    );
  }
}

class _EmptyState extends StatelessWidget {
  const _EmptyState({required this.filter, required this.onRefresh});

  final NotificationFilter filter;
  final Future<void> Function() onRefresh;

  @override
  Widget build(BuildContext context) {
    final message = switch (filter) {
      NotificationFilter.all => 'No notifications',
      NotificationFilter.unread => 'No unread notifications',
      NotificationFilter.mentions => 'No mentions',
    };
    return RefreshIndicator(
      onRefresh: onRefresh,
      color: const Color(0xFF7AA2F7),
      backgroundColor: const Color(0xFF24283B),
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        children: [
          const SizedBox(height: 96),
          const Icon(
            Icons.notifications_none,
            size: 48,
            color: Colors.white24,
          ),
          const SizedBox(height: 16),
          Center(
            child: Text(
              message,
              style: const TextStyle(color: Colors.white70, fontSize: 16),
            ),
          ),
          const SizedBox(height: 8),
          const Center(
            child: Text(
              'Pull down to refresh.',
              style: TextStyle(color: Colors.white38, fontSize: 13),
            ),
          ),
        ],
      ),
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
