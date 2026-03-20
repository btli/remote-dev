import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:remote_dev/domain/entities/folder.dart';
import 'package:remote_dev/presentation/providers/providers.dart';

/// A collapsible folder tree widget for the sidebar.
///
/// Shows "All Sessions" at the top, followed by a nested folder hierarchy.
/// Tapping a folder sets [activeFolderIdProvider]. Folders with children
/// can be expanded/collapsed.
class FolderTree extends ConsumerStatefulWidget {
  const FolderTree({super.key});

  @override
  ConsumerState<FolderTree> createState() => _FolderTreeState();
}

class _FolderTreeState extends ConsumerState<FolderTree> {
  /// Set of folder IDs that are currently expanded.
  final Set<String> _expandedIds = {};

  /// Whether the entire folder section is collapsed.
  bool _sectionCollapsed = false;

  /// Count sessions belonging to a folder (and its descendants).
  int _sessionCount(String folderId, List<Folder> allFolders) {
    final sessionFolders = ref.read(sessionFoldersProvider);
    final sessions = ref.read(sessionListProvider).valueOrNull ?? [];

    // Collect this folder + all descendant folder IDs
    final folderIds = <String>{folderId};
    void collectChildren(String parentId) {
      for (final folder in allFolders) {
        if (folder.parentId == parentId && !folderIds.contains(folder.id)) {
          folderIds.add(folder.id);
          collectChildren(folder.id);
        }
      }
    }
    collectChildren(folderId);

    var count = 0;
    for (final session in sessions) {
      final sessionFolderId =
          session.folderId ?? sessionFolders[session.id];
      if (sessionFolderId != null && folderIds.contains(sessionFolderId)) {
        count++;
      }
    }
    return count;
  }

  List<Folder> _childrenOf(String? parentId, List<Folder> allFolders) {
    final children =
        allFolders.where((f) => f.parentId == parentId).toList();
    children.sort((a, b) => a.sortOrder.compareTo(b.sortOrder));
    return children;
  }

  bool _hasChildren(String folderId, List<Folder> allFolders) {
    return allFolders.any((f) => f.parentId == folderId);
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;
    final folders = ref.watch(foldersProvider);
    final activeFolderId = ref.watch(activeFolderIdProvider);
    final folderListAsync = ref.watch(folderListProvider);
    final allSessions = ref.watch(sessionListProvider).valueOrNull ?? [];

    if (folderListAsync.isLoading && folders.isEmpty) {
      return Padding(
        padding: const EdgeInsets.all(16),
        child: Center(
          child: SizedBox(
            width: 20,
            height: 20,
            child: CircularProgressIndicator(
              strokeWidth: 2,
              color: colorScheme.primary,
            ),
          ),
        ),
      );
    }

    if (folders.isEmpty) {
      return const SizedBox.shrink();
    }

    final rootFolders = _childrenOf(null, folders);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        // Collapsible section header
        InkWell(
          onTap: () =>
              setState(() => _sectionCollapsed = !_sectionCollapsed),
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 12, 4),
            child: Row(
              children: [
                Text(
                  'Folders',
                  style: theme.textTheme.labelSmall?.copyWith(
                    color: colorScheme.onSurface.withValues(alpha: 0.5),
                    fontWeight: FontWeight.w600,
                    letterSpacing: 0.5,
                  ),
                ),
                const Spacer(),
                Icon(
                  _sectionCollapsed
                      ? Icons.chevron_right
                      : Icons.expand_more,
                  size: 16,
                  color: colorScheme.onSurface.withValues(alpha: 0.4),
                ),
              ],
            ),
          ),
        ),

        if (!_sectionCollapsed) ...[
          // "All Sessions" item
          _FolderItem(
            label: 'All Sessions',
            icon: Icons.folder_outlined,
            isActive: activeFolderId == null,
            sessionCount: allSessions.length,
            depth: 0,
            onTap: () {
              ref.read(activeFolderIdProvider.notifier).state = null;
            },
          ),

          // Root folders and their children
          for (final folder in rootFolders)
            _buildFolderSubtree(folder, folders, activeFolderId, 0),
        ],
      ],
    );
  }

  Widget _buildFolderSubtree(
    Folder folder,
    List<Folder> allFolders,
    String? activeFolderId,
    int depth,
  ) {
    final hasChildren = _hasChildren(folder.id, allFolders);
    final isExpanded = _expandedIds.contains(folder.id);
    final children = hasChildren ? _childrenOf(folder.id, allFolders) : <Folder>[];
    final sessionCount = _sessionCount(folder.id, allFolders);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _FolderItem(
          label: folder.name,
          icon: folder.icon != null
              ? _iconFromName(folder.icon!)
              : (isExpanded
                  ? Icons.folder_open_outlined
                  : Icons.folder_outlined),
          isActive: activeFolderId == folder.id,
          sessionCount: sessionCount,
          depth: depth + 1,
          hasChildren: hasChildren,
          isExpanded: isExpanded,
          onTap: () {
            ref.read(activeFolderIdProvider.notifier).state = folder.id;
          },
          onToggleExpand: hasChildren
              ? () {
                  setState(() {
                    if (isExpanded) {
                      _expandedIds.remove(folder.id);
                    } else {
                      _expandedIds.add(folder.id);
                    }
                  });
                }
              : null,
        ),
        if (isExpanded)
          for (final child in children)
            _buildFolderSubtree(child, allFolders, activeFolderId, depth + 1),
      ],
    );
  }

  IconData _iconFromName(String name) {
    return switch (name) {
      'code' => Icons.code,
      'terminal' => Icons.terminal,
      'work' => Icons.work_outline,
      'home' => Icons.home_outlined,
      'star' => Icons.star_outline,
      'bookmark' => Icons.bookmark_outline,
      'science' => Icons.science_outlined,
      'school' => Icons.school_outlined,
      _ => Icons.folder_outlined,
    };
  }
}

class _FolderItem extends StatelessWidget {
  const _FolderItem({
    required this.label,
    required this.icon,
    required this.isActive,
    required this.sessionCount,
    required this.depth,
    required this.onTap,
    this.hasChildren = false,
    this.isExpanded = false,
    this.onToggleExpand,
  });

  final String label;
  final IconData icon;
  final bool isActive;
  final int sessionCount;
  final int depth;
  final VoidCallback onTap;
  final bool hasChildren;
  final bool isExpanded;
  final VoidCallback? onToggleExpand;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 1),
      child: Material(
        color: isActive
            ? colorScheme.surfaceContainerHigh
            : Colors.transparent,
        borderRadius: BorderRadius.circular(12),
        child: InkWell(
          borderRadius: BorderRadius.circular(12),
          onTap: onTap,
          child: Padding(
            padding: EdgeInsets.only(
              left: 12.0 + (depth * 16.0),
              right: 8,
              top: 8,
              bottom: 8,
            ),
            child: Row(
              children: [
                if (hasChildren)
                  GestureDetector(
                    onTap: onToggleExpand,
                    behavior: HitTestBehavior.opaque,
                    child: Padding(
                      padding: const EdgeInsets.only(right: 4),
                      child: Icon(
                        isExpanded
                            ? Icons.expand_more
                            : Icons.chevron_right,
                        size: 16,
                        color: colorScheme.onSurface
                            .withValues(alpha: 0.5),
                      ),
                    ),
                  )
                else
                  const SizedBox(width: 20),
                Icon(
                  icon,
                  size: 18,
                  color: isActive
                      ? colorScheme.primary
                      : colorScheme.onSurface.withValues(alpha: 0.6),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    label,
                    style: theme.textTheme.bodyMedium?.copyWith(
                      fontWeight:
                          isActive ? FontWeight.w600 : FontWeight.normal,
                      color: isActive
                          ? colorScheme.onSurface
                          : colorScheme.onSurface.withValues(alpha: 0.8),
                    ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                if (sessionCount > 0)
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 6,
                      vertical: 2,
                    ),
                    decoration: BoxDecoration(
                      color: isActive
                          ? colorScheme.primary.withValues(alpha: 0.15)
                          : colorScheme.surfaceContainerHigh,
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: Text(
                      '$sessionCount',
                      style: theme.textTheme.labelSmall?.copyWith(
                        color: isActive
                            ? colorScheme.primary
                            : colorScheme.onSurface
                                .withValues(alpha: 0.5),
                        fontSize: 11,
                        fontWeight: FontWeight.w500,
                      ),
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
