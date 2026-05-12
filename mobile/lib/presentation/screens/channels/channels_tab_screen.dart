import 'dart:async';

import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../domain/active_node.dart';
import '../../../domain/channel.dart';
import '../../../infrastructure/api/channels_api.dart';
import '../../../infrastructure/api/preferences_api.dart';
import '../sessions/project_tree_sheet.dart' show showProjectTreeSheet;
import '../shell/home_shell.dart';

/// Polling cadence for live unread refresh while the Channels tab is mounted
/// and the app is in the foreground. 30s is a deliberate trade-off: short
/// enough that unread badges feel "live" without push, long enough to be
/// cheap on battery and metered networks. Tune via this constant.
const _kChannelPollInterval = Duration(seconds: 30);

/// Provider for the channels API. Must be overridden in main.dart once a
/// [RemoteDevClient] is wired for the active server (Wave 4 wiring).
final channelsApiProvider = Provider<ChannelsApi>((ref) {
  throw UnimplementedError(
    'channelsApiProvider must be overridden with ChannelsApi(client) in main.dart',
  );
});

/// Provider for the preferences API. Overridden in main.dart alongside the
/// other server-scoped APIs so it rebinds when the active server changes.
final preferencesApiProvider = Provider<PreferencesApi>((ref) {
  throw UnimplementedError(
    'preferencesApiProvider must be overridden with PreferencesApi(client) in main.dart',
  );
});

/// Holds the user's active project/group selection. Mirrors the PWA
/// mobile-web's `usePreferencesContext().activeProject`: every tab that
/// needs project scoping (Channels today, Tasks/Peers later) should
/// watch this notifier so they react to changes initiated anywhere in
/// the UI (sessions tab, project picker, etc.).
class ActiveNodeNotifier extends AsyncNotifier<ActiveNode?> {
  @override
  Future<ActiveNode?> build() async {
    return ref.watch(preferencesApiProvider).getActiveNode();
  }

  /// Select a node (project or group). Persists to the server first so
  /// subsequent reads from any client see the same value, then refreshes
  /// the local state so dependent providers (`channelsListProvider`)
  /// rebuild.
  Future<void> select({
    required String? nodeId,
    required ActiveNodeType? nodeType,
  }) async {
    final api = ref.read(preferencesApiProvider);
    state = const AsyncValue.loading();
    try {
      await api.setActiveNode(nodeId: nodeId, nodeType: nodeType);
      final fresh = await api.getActiveNode();
      state = AsyncValue.data(fresh);
    } catch (err, stack) {
      state = AsyncValue.error(err, stack);
    }
  }
}

final activeNodeProvider =
    AsyncNotifierProvider<ActiveNodeNotifier, ActiveNode?>(
  ActiveNodeNotifier.new,
);

/// Family-keyed channels list. Re-fetches when the active node changes;
/// returns an empty list when [node] is `null` (matches the API
/// short-circuit in [ChannelsApi.list]).
final channelsListProvider = FutureProvider.autoDispose
    .family<List<Channel>, ActiveNode?>((ref, node) async {
  if (node == null) return const <Channel>[];
  return ref.watch(channelsApiProvider).list(activeNode: node);
});

class ChannelsTabScreen extends ConsumerStatefulWidget {
  const ChannelsTabScreen({super.key});

  @override
  ConsumerState<ChannelsTabScreen> createState() => _ChannelsTabScreenState();
}

class _ChannelsTabScreenState extends ConsumerState<ChannelsTabScreen>
    with WidgetsBindingObserver {
  Timer? _pollTimer;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _startPolling();
  }

  @override
  void dispose() {
    _stopPolling();
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      if (_pollTimer == null) {
        // Refresh immediately on return-to-foreground so unread counts are
        // current without waiting a full interval. Use the current active
        // node so we don't fan out a request for a stale family key.
        final node = ref.read(activeNodeProvider).valueOrNull;
        ref.invalidate(channelsListProvider(node));
        _startPolling();
      }
    } else if (state == AppLifecycleState.paused ||
        state == AppLifecycleState.detached ||
        state == AppLifecycleState.hidden) {
      _stopPolling();
    }
  }

  void _startPolling() {
    _pollTimer?.cancel();
    _pollTimer = Timer.periodic(_kChannelPollInterval, (_) {
      if (!mounted) return;
      final node = ref.read(activeNodeProvider).valueOrNull;
      ref.invalidate(channelsListProvider(node));
    });
  }

  void _stopPolling() {
    _pollTimer?.cancel();
    _pollTimer = null;
  }

  Future<void> _refresh(ActiveNode? node) async {
    ref.invalidate(channelsListProvider(node));
    await ref.read(channelsListProvider(node).future);
  }

  Future<void> _pickProject() async {
    final projectId = await showProjectTreeSheet(context);
    if (projectId == null || !mounted) return;
    await ref.read(activeNodeProvider.notifier).select(
          nodeId: projectId,
          nodeType: ActiveNodeType.project,
        );
  }

  Future<void> _archive(Channel channel, ActiveNode? node) async {
    final api = ref.read(channelsApiProvider);
    try {
      await api.archive(channel.id);
      await _refresh(node);
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
    context.push('/home/channel/${channel.id}');
  }

  @override
  Widget build(BuildContext context) {
    final asyncNode = ref.watch(activeNodeProvider);

    return Scaffold(
      backgroundColor: const Color(0xFF1A1B26),
      appBar: AppBar(
        backgroundColor: const Color(0xFF1A1B26),
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Text(
              'Channels',
              style: TextStyle(color: Colors.white),
            ),
            // Active project subtitle, matching the PWA's "Channels · name"
            // header. Only render when we actually have a name to show.
            if (asyncNode.valueOrNull?.name != null)
              Text(
                asyncNode.value!.name!,
                style: const TextStyle(
                  color: Colors.white54,
                  fontSize: 12,
                  fontWeight: FontWeight.w400,
                ),
                overflow: TextOverflow.ellipsis,
              ),
          ],
        ),
        actions: [
          IconButton(
            tooltip: 'Pick project',
            onPressed: _pickProject,
            icon: const Icon(Icons.folder_open, color: Colors.white70),
          ),
        ],
      ),
      body: asyncNode.when(
        loading: () => const Center(
          child: CupertinoActivityIndicator(color: Colors.white70),
        ),
        error: (err, _) => _ErrorView(
          message: 'Failed to load preferences',
          detail: '$err',
          onRetry: () async => ref.refresh(activeNodeProvider.future),
        ),
        data: (node) {
          if (node == null) {
            return _NoActiveProjectState(onPickProject: _pickProject);
          }
          return _ChannelsListBody(
            node: node,
            onRefresh: () => _refresh(node),
            onArchive: (c) => _archive(c, node),
            confirmArchive: _confirmArchive,
            onTapChannel: _onTapChannel,
          );
        },
      ),
    );
  }
}

class _ChannelsListBody extends ConsumerWidget {
  const _ChannelsListBody({
    required this.node,
    required this.onRefresh,
    required this.onArchive,
    required this.confirmArchive,
    required this.onTapChannel,
  });

  final ActiveNode node;
  final Future<void> Function() onRefresh;
  final void Function(Channel) onArchive;
  final Future<bool> Function(Channel) confirmArchive;
  final void Function(Channel) onTapChannel;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final asyncChannels = ref.watch(channelsListProvider(node));
    return asyncChannels.when(
      loading: () => const Center(
        child: CupertinoActivityIndicator(color: Colors.white70),
      ),
      error: (err, _) => _ErrorView(
        message: 'Failed to load channels',
        detail: '$err',
        onRetry: onRefresh,
      ),
      data: (channels) {
        if (channels.isEmpty) {
          return _EmptyState(onRefresh: onRefresh);
        }
        return RefreshIndicator(
          onRefresh: onRefresh,
          color: const Color(0xFF7AA2F7),
          backgroundColor: const Color(0xFF24283B),
          child: ListView.separated(
            physics: const AlwaysScrollableScrollPhysics(),
            padding: EdgeInsets.only(
              bottom: tabContentBottomPadding(context),
            ),
            itemCount: channels.length,
            separatorBuilder: (_, __) => const Divider(
              color: Color(0xFF2F334D),
              height: 1,
            ),
            itemBuilder: (context, i) {
              final c = channels[i];
              return _ChannelRow(
                channel: c,
                onTap: () => onTapChannel(c),
                onArchive: () => onArchive(c),
                confirmArchive: () => confirmArchive(c),
              );
            },
          ),
        );
      },
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
              'Channels for this project will appear here.',
              style: TextStyle(color: Colors.white38, fontSize: 13),
              textAlign: TextAlign.center,
            ),
          ),
        ],
      ),
    );
  }
}

/// Shown when no project (or group) is selected. Mirrors the PWA's
/// "Pick a project from the Sessions tab to load channels" copy and
/// gives the user a direct path to fix it without leaving the tab.
class _NoActiveProjectState extends StatelessWidget {
  const _NoActiveProjectState({required this.onPickProject});
  final Future<void> Function() onPickProject;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(
              Icons.folder_off_outlined,
              size: 48,
              color: Colors.white24,
            ),
            const SizedBox(height: 16),
            const Text(
              'No project selected',
              style: TextStyle(color: Colors.white70, fontSize: 16),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 8),
            const Text(
              'Pick a project to load channels.',
              style: TextStyle(color: Colors.white38, fontSize: 13),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 24),
            ElevatedButton.icon(
              onPressed: onPickProject,
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFF7AA2F7),
                foregroundColor: const Color(0xFF1A1B26),
                padding: const EdgeInsets.symmetric(
                  horizontal: 16,
                  vertical: 12,
                ),
              ),
              icon: const Icon(Icons.folder_open),
              label: const Text(
                'Pick a project',
                style: TextStyle(fontWeight: FontWeight.w600),
              ),
            ),
          ],
        ),
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
