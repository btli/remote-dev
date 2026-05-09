import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../application/ports/project_tree_port.dart';
import '../../../domain/group.dart';
import '../../../domain/project.dart';

final projectTreeApiProvider = Provider<ProjectTreePort>((ref) {
  throw UnimplementedError(
    'projectTreeApiProvider must be overridden once RemoteDevClient is wired',
  );
});

final groupsProvider = FutureProvider<List<Group>>((ref) async {
  return ref.watch(projectTreeApiProvider).listGroups();
});

final projectsProvider = FutureProvider<List<Project>>((ref) async {
  return ref.watch(projectTreeApiProvider).listProjects();
});

/// Returns the selected project id (null if dismissed).
Future<String?> showProjectTreeSheet(BuildContext context) {
  return showModalBottomSheet<String>(
    context: context,
    backgroundColor: const Color(0xFF1A1B26),
    isScrollControlled: true,
    builder: (_) => const ProjectTreeSheet(),
  );
}

class ProjectTreeSheet extends ConsumerWidget {
  const ProjectTreeSheet({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final asyncGroups = ref.watch(groupsProvider);
    final asyncProjects = ref.watch(projectsProvider);
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.all(8),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 36,
              height: 4,
              decoration: BoxDecoration(
                color: Colors.white24,
                borderRadius: BorderRadius.circular(2),
              ),
            ),
            const SizedBox(height: 8),
            const Text(
              'Pick a project',
              style: TextStyle(color: Colors.white, fontSize: 16),
            ),
            const SizedBox(height: 8),
            Flexible(
              child: () {
                if (asyncGroups.isLoading || asyncProjects.isLoading) {
                  return const Center(child: CircularProgressIndicator());
                }
                if (asyncGroups.hasError || asyncProjects.hasError) {
                  return Padding(
                    padding: const EdgeInsets.all(16),
                    child: Text(
                      'Failed to load: ${asyncGroups.error ?? asyncProjects.error}',
                      style: const TextStyle(color: Colors.white70),
                    ),
                  );
                }
                final groups = asyncGroups.value ?? const [];
                final projects = asyncProjects.value ?? const [];
                if (projects.isEmpty) {
                  return const Padding(
                    padding: EdgeInsets.all(16),
                    child: Text(
                      'No projects yet.',
                      style: TextStyle(color: Colors.white70),
                    ),
                  );
                }
                return _Tree(groups: groups, projects: projects);
              }(),
            ),
          ],
        ),
      ),
    );
  }
}

class _Tree extends StatelessWidget {
  const _Tree({required this.groups, required this.projects});
  final List<Group> groups;
  final List<Project> projects;

  @override
  Widget build(BuildContext context) {
    final byGroup = <String, List<Project>>{};
    for (final p in projects) {
      byGroup.putIfAbsent(p.groupId, () => []).add(p);
    }
    final sortedGroups = [...groups]
      ..sort((a, b) => a.sortOrder.compareTo(b.sortOrder));

    return ListView(
      shrinkWrap: true,
      children: [
        for (final g in sortedGroups)
          ExpansionTile(
            iconColor: Colors.white70,
            collapsedIconColor: Colors.white70,
            title: Text(
              g.name,
              style: const TextStyle(color: Colors.white, fontSize: 14),
            ),
            initiallyExpanded: true,
            children: [
              for (final p in (byGroup[g.id] ?? <Project>[])
                ..sort((a, b) => a.sortOrder.compareTo(b.sortOrder)))
                ListTile(
                  dense: true,
                  contentPadding: const EdgeInsets.only(left: 32, right: 16),
                  title: Text(
                    p.name,
                    style: const TextStyle(color: Colors.white),
                  ),
                  onTap: () => Navigator.of(context).pop(p.id),
                ),
            ],
          ),
      ],
    );
  }
}
