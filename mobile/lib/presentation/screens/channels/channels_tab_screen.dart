import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../domain/channel.dart';
import '../../../infrastructure/api/channels_api.dart';

/// Provider for the channels API. Must be overridden in main.dart once a
/// [RemoteDevClient] is wired for the active server (Wave 4 wiring).
final channelsApiProvider = Provider<ChannelsApi>((ref) {
  throw UnimplementedError(
    'channelsApiProvider must be overridden with ChannelsApi(client) in main.dart',
  );
});

final channelsListProvider =
    FutureProvider.autoDispose<List<Channel>>((ref) async {
  return ref.watch(channelsApiProvider).list();
});

class ChannelsTabScreen extends ConsumerStatefulWidget {
  const ChannelsTabScreen({super.key});

  @override
  ConsumerState<ChannelsTabScreen> createState() => _ChannelsTabScreenState();
}

class _ChannelsTabScreenState extends ConsumerState<ChannelsTabScreen> {
  Future<void> _refresh() async {
    ref.invalidate(channelsListProvider);
    await ref.read(channelsListProvider.future);
  }

  Future<void> _archive(Channel channel) async {
    final api = ref.read(channelsApiProvider);
    try {
      await api.archive(channel.id);
      await _refresh();
      if (!mounted) return;
      _showSnack('Channel archived');
    } catch (e) {
      if (!mounted) return;
      _showSnack('Failed to archive: $e');
    }
  }

  Future<bool> _confirmArchive(Channel channel) async {
    final result = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: const Color(0xFF24283B),
        title: const Text(
          'Archive channel?',
          style: TextStyle(color: Colors.white),
        ),
        content: Text(
          '"${channel.name}" will be archived.',
          style: const TextStyle(color: Colors.white70),
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
            child: const Text('Archive'),
          ),
        ],
      ),
    );
    return result ?? false;
  }

  void _showSnack(String msg) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(msg), duration: const Duration(seconds: 2)),
    );
  }

  void _onTapChannel(Channel channel) {
    // P4.3 lands the actual /home/channel/:id route; for now we route to it
    // and the router falls back gracefully if the route is not registered.
    context.go('/home/channel/${channel.id}');
  }

  @override
  Widget build(BuildContext context) {
    final asyncChannels = ref.watch(channelsListProvider);

    return Scaffold(
      backgroundColor: const Color(0xFF1A1B26),
      appBar: AppBar(
        backgroundColor: const Color(0xFF1A1B26),
        title: const Text('Channels', style: TextStyle(color: Colors.white)),
      ),
      body: asyncChannels.when(
        loading: () => const Center(
          child: CupertinoActivityIndicator(color: Colors.white70),
        ),
        error: (err, _) => _ErrorView(
          message: 'Failed to load channels',
          detail: '$err',
          onRetry: _refresh,
        ),
        data: (channels) {
          if (channels.isEmpty) {
            return _EmptyState(onRefresh: _refresh);
          }
          return RefreshIndicator(
            onRefresh: _refresh,
            color: const Color(0xFF7AA2F7),
            backgroundColor: const Color(0xFF24283B),
            child: ListView.separated(
              physics: const AlwaysScrollableScrollPhysics(),
              itemCount: channels.length,
              separatorBuilder: (_, __) => const Divider(
                color: Color(0xFF2F334D),
                height: 1,
              ),
              itemBuilder: (context, i) {
                final c = channels[i];
                return _ChannelRow(
                  channel: c,
                  onTap: () => _onTapChannel(c),
                  onArchive: () => _archive(c),
                  confirmArchive: () => _confirmArchive(c),
                );
              },
            ),
          );
        },
      ),
    );
  }
}

class _ChannelRow extends StatelessWidget {
  const _ChannelRow({
    required this.channel,
    required this.onTap,
    required this.onArchive,
    required this.confirmArchive,
  });

  final Channel channel;
  final VoidCallback onTap;
  final VoidCallback onArchive;
  final Future<bool> Function() confirmArchive;

  @override
  Widget build(BuildContext context) {
    return Dismissible(
      key: ValueKey('channel-${channel.id}'),
      direction: DismissDirection.endToStart,
      dismissThresholds: const {DismissDirection.endToStart: 0.6},
      confirmDismiss: (_) async {
        final ok = await confirmArchive();
        if (ok) {
          onArchive();
        }
        // Always return false: the row is removed when the list refetches.
        return false;
      },
      background: const SizedBox.shrink(),
      secondaryBackground: _SwipeBackground(),
      child: ListTile(
        onTap: onTap,
        leading: const Icon(Icons.tag, color: Colors.white54),
        title: Text(
          channel.name,
          style: const TextStyle(color: Colors.white),
          overflow: TextOverflow.ellipsis,
        ),
        trailing: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (channel.unreadCount > 0)
              _UnreadBadge(count: channel.unreadCount),
            const SizedBox(width: 8),
            const Icon(Icons.chevron_right, color: Colors.white38),
          ],
        ),
      ),
    );
  }
}

class _UnreadBadge extends StatelessWidget {
  const _UnreadBadge({required this.count});
  final int count;

  @override
  Widget build(BuildContext context) {
    final label = count > 99 ? '99+' : '$count';
    return Container(
      constraints: const BoxConstraints(minWidth: 22, minHeight: 22),
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
      decoration: const BoxDecoration(
        color: Color(0xFFF7768E),
        shape: BoxShape.circle,
      ),
      alignment: Alignment.center,
      child: Text(
        label,
        style: const TextStyle(
          color: Colors.white,
          fontSize: 12,
          fontWeight: FontWeight.w600,
        ),
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
          Icon(Icons.archive_outlined, color: Colors.white),
          SizedBox(width: 8),
          Text(
            'Archive',
            style: TextStyle(color: Colors.white, fontWeight: FontWeight.w600),
          ),
        ],
      ),
    );
  }
}

class _EmptyState extends StatelessWidget {
  const _EmptyState({required this.onRefresh});
  final Future<void> Function() onRefresh;

  @override
  Widget build(BuildContext context) {
    return RefreshIndicator(
      onRefresh: onRefresh,
      color: const Color(0xFF7AA2F7),
      backgroundColor: const Color(0xFF24283B),
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        children: const [
          SizedBox(height: 96),
          Icon(
            Icons.forum_outlined,
            size: 48,
            color: Colors.white24,
          ),
          SizedBox(height: 16),
          Center(
            child: Text(
              'No channels yet',
              style: TextStyle(color: Colors.white70, fontSize: 16),
            ),
          ),
          SizedBox(height: 8),
          Center(
            child: Text(
              'Channels will appear here once a project is selected.',
              style: TextStyle(color: Colors.white38, fontSize: 13),
              textAlign: TextAlign.center,
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
