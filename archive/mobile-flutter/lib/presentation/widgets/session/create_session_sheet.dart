import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:remote_dev/domain/repositories/session_repository.dart';
import 'package:remote_dev/domain/value_objects/agent_provider.dart';
import 'package:remote_dev/domain/value_objects/terminal_type.dart';
import 'package:remote_dev/domain/value_objects/worktree_type.dart';
import 'package:remote_dev/presentation/providers/providers.dart';

class CreateSessionSheet extends ConsumerStatefulWidget {
  const CreateSessionSheet({super.key, this.folderId});

  /// Optional folder ID to create the session in.
  final String? folderId;

  @override
  ConsumerState<CreateSessionSheet> createState() =>
      _CreateSessionSheetState();
}

class _CreateSessionSheetState extends ConsumerState<CreateSessionSheet> {
  final _nameController = TextEditingController(text: 'New Session');
  final _branchNameController = TextEditingController();
  TerminalType _terminalType = TerminalType.shell;
  AgentProvider _agentProvider = AgentProvider.claude;
  bool _isCreating = false;

  // Worktree state
  bool _createWorktree = false;
  WorktreeType _worktreeType = WorktreeType.feature;
  String? _baseBranch;

  /// Track the last auto-generated branch name so manual edits are preserved.
  String _lastAutoName = '';

  @override
  void initState() {
    super.initState();
    _nameController.addListener(_autoPopulateBranchName);
  }

  @override
  void dispose() {
    _nameController.removeListener(_autoPopulateBranchName);
    _nameController.dispose();
    _branchNameController.dispose();
    super.dispose();
  }

  void _autoPopulateBranchName() {
    if (!_createWorktree) return;
    final current = _branchNameController.text;
    // Only auto-populate if the field is empty or matches last auto-generated value
    if (current.isNotEmpty && current != _lastAutoName) return;
    final slug = _slugify(_nameController.text.trim());
    _lastAutoName = slug;
    _branchNameController.text = slug;
  }

  String _slugify(String input) {
    return input
        .toLowerCase()
        .replaceAll(RegExp(r'[^a-z0-9]+'), '-')
        .replaceAll(RegExp(r'-+'), '-')
        .replaceAll(RegExp(r'^-|-$'), '');
  }

  /// Select the best default branch from a list, preferring main > master.
  static String _pickDefaultBranch(List<String> branches) {
    if (branches.contains('main')) return 'main';
    if (branches.contains('master')) return 'master';
    return branches.first;
  }

  Future<void> _create() async {
    final name = _nameController.text.trim();
    if (name.isEmpty) return;
    if (_createWorktree && _branchNameController.text.trim().isEmpty) return;

    setState(() => _isCreating = true);

    try {
      final branchName = _createWorktree
          ? _branchNameController.text.trim()
          : null;

      final session =
          await ref.read(sessionListProvider.notifier).createSession(
                CreateSessionInput(
                  name: name,
                  folderId: widget.folderId,
                  terminalType: _terminalType.value,
                  agentProvider: _terminalType == TerminalType.agent
                      ? _agentProvider.value
                      : null,
                  autoLaunchAgent: _terminalType == TerminalType.agent,
                  createWorktree: _createWorktree,
                  worktreeType:
                      _createWorktree ? _worktreeType.value : null,
                  baseBranch: _createWorktree ? _baseBranch : null,
                  featureDescription: _createWorktree ? branchName : null,
                ),
              );

      if (!mounted) return;
      Navigator.of(context).pop();

      if (session != null) {
        ref.read(activeSessionIdProvider.notifier).state = session.id;
        // Refresh folders to update session counts
        ref.read(folderListProvider.notifier).refresh();
      }
    } finally {
      if (mounted) setState(() => _isCreating = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    final folderPrefs =
        ref.watch(folderPreferenceForIdProvider(widget.folderId));
    final canUseWorktree = folderPrefs?.hasGitRepo ?? false;
    final gitPath = folderPrefs?.gitPath;

    // Reset worktree toggle if folder lost its repo
    ref.listen(folderPreferenceForIdProvider(widget.folderId),
        (previous, next) {
      if (_createWorktree && !(next?.hasGitRepo ?? false)) {
        setState(() => _createWorktree = false);
      }
    });

    // Auto-select base branch when branch data loads
    if (_createWorktree && gitPath != null) {
      ref.listen(branchListProvider(gitPath), (previous, next) {
        final branches = next.valueOrNull;
        if (branches == null || branches.isEmpty) return;
        if (_baseBranch != null && branches.contains(_baseBranch)) return;
        setState(() => _baseBranch = _pickDefaultBranch(branches));
      });
    }

    return Padding(
      padding: EdgeInsets.fromLTRB(
        24,
        0,
        24,
        MediaQuery.of(context).viewInsets.bottom + 24,
      ),
      child: ConstrainedBox(
        constraints: BoxConstraints(
          maxHeight: MediaQuery.of(context).size.height * 0.85,
        ),
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                'New Session',
                style: theme.textTheme.titleMedium?.copyWith(
                  fontWeight: FontWeight.bold,
                ),
              ),
              const SizedBox(height: 20),

              TextField(
                controller: _nameController,
                decoration: const InputDecoration(
                  labelText: 'Session Name',
                  prefixIcon: Icon(Icons.label_outline),
                ),
                autofocus: true,
                textCapitalization: TextCapitalization.words,
              ),
              const SizedBox(height: 20),

              SegmentedButton<TerminalType>(
                segments: const [
                  ButtonSegment(
                    value: TerminalType.shell,
                    label: Text('Shell'),
                    icon: Icon(Icons.terminal),
                  ),
                  ButtonSegment(
                    value: TerminalType.agent,
                    label: Text('Agent'),
                    icon: Icon(Icons.smart_toy_outlined),
                  ),
                ],
                selected: {_terminalType},
                onSelectionChanged: (selected) {
                  setState(() => _terminalType = selected.first);
                },
              ),
              const SizedBox(height: 20),

              // Agent provider dropdown
              AnimatedSize(
                duration: const Duration(milliseconds: 200),
                curve: Curves.easeInOut,
                alignment: Alignment.topCenter,
                child: _terminalType == TerminalType.agent
                    ? Padding(
                        padding: const EdgeInsets.only(bottom: 20),
                        child: DropdownMenu<AgentProvider>(
                          initialSelection: _agentProvider,
                          label: const Text('Agent Provider'),
                          leadingIcon:
                              const Icon(Icons.smart_toy_outlined),
                          expandedInsets: EdgeInsets.zero,
                          onSelected: (value) {
                            if (value != null) {
                              setState(() => _agentProvider = value);
                            }
                          },
                          dropdownMenuEntries: AgentProvider.values
                              .where((p) => p.isAgent)
                              .map(
                                (provider) => DropdownMenuEntry(
                                  value: provider,
                                  label: provider.displayName,
                                ),
                              )
                              .toList(),
                        ),
                      )
                    : const SizedBox.shrink(),
              ),

              // Worktree toggle
              if (widget.folderId != null)
                SwitchListTile(
                  contentPadding: EdgeInsets.zero,
                  title: const Text('Create Worktree'),
                  subtitle: Text(
                    canUseWorktree
                        ? 'Isolated branch directory'
                        : 'Link a git repo in folder settings',
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                  ),
                  secondary: Icon(
                    Icons.account_tree_outlined,
                    color: canUseWorktree
                        ? theme.colorScheme.primary
                        : theme.colorScheme.onSurfaceVariant,
                  ),
                  value: _createWorktree,
                  onChanged: canUseWorktree
                      ? (value) {
                          setState(() => _createWorktree = value);
                          if (value) _autoPopulateBranchName();
                        }
                      : null,
                ),

              // Worktree options (expanded when toggle is on)
              AnimatedSize(
                duration: const Duration(milliseconds: 200),
                curve: Curves.easeInOut,
                alignment: Alignment.topCenter,
                child: _createWorktree
                    ? _buildWorktreeOptions(theme, gitPath)
                    : const SizedBox.shrink(),
              ),

              FilledButton(
                onPressed: _isCreating ||
                        (_createWorktree &&
                            _branchNameController.text.trim().isEmpty)
                    ? null
                    : _create,
                child: _isCreating
                    ? const SizedBox(
                        height: 20,
                        width: 20,
                        child:
                            CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Text('Create Session'),
              ),
              const SizedBox(height: 8),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildWorktreeOptions(ThemeData theme, String? gitPath) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const SizedBox(height: 8),

          // Worktree type selector
          DropdownMenu<WorktreeType>(
            initialSelection: _worktreeType,
            label: const Text('Type'),
            leadingIcon: const Icon(Icons.category_outlined),
            expandedInsets: EdgeInsets.zero,
            onSelected: (value) {
              if (value != null) {
                setState(() => _worktreeType = value);
              }
            },
            dropdownMenuEntries: WorktreeType.values
                .map(
                  (type) => DropdownMenuEntry(
                    value: type,
                    label: type.displayName,
                  ),
                )
                .toList(),
          ),
          const SizedBox(height: 16),

          // Branch name input
          TextField(
            controller: _branchNameController,
            decoration: InputDecoration(
              labelText: 'Branch Name',
              prefixIcon:
                  const Icon(Icons.account_tree_outlined),
              helperText: _branchNameController.text.trim().isNotEmpty
                  ? '${_worktreeType.value}/${_branchNameController.text.trim()}'
                  : null,
              helperStyle: TextStyle(
                fontFamily: 'monospace',
                color: theme.colorScheme.primary,
                fontSize: 12,
              ),
            ),
            onChanged: (_) => setState(() {}),
          ),
          const SizedBox(height: 16),

          // Base branch picker
          if (gitPath != null)
            _buildBaseBranchPicker(theme, gitPath)
          else
            Text(
              'Base branch: default (no local path configured)',
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
        ],
      ),
    );
  }

  Widget _buildBaseBranchPicker(ThemeData theme, String gitPath) {
    final branchesAsync = ref.watch(branchListProvider(gitPath));

    return branchesAsync.when(
      data: (branches) {
        if (branches.isEmpty) {
          return Text(
            'No branches found',
            style: theme.textTheme.bodySmall?.copyWith(
              color: theme.colorScheme.onSurfaceVariant,
            ),
          );
        }

        return DropdownMenu<String>(
          initialSelection: _baseBranch,
          label: const Text('Base Branch'),
          leadingIcon: const Icon(Icons.merge_type_outlined),
          expandedInsets: EdgeInsets.zero,
          onSelected: (value) {
            if (value != null) {
              setState(() => _baseBranch = value);
            }
          },
          dropdownMenuEntries: branches
              .map(
                (branch) => DropdownMenuEntry(
                  value: branch,
                  label: branch,
                ),
              )
              .toList(),
        );
      },
      loading: () => const Row(
        children: [
          SizedBox(
            width: 16,
            height: 16,
            child: CircularProgressIndicator(strokeWidth: 2),
          ),
          SizedBox(width: 12),
          Text('Loading branches...'),
        ],
      ),
      error: (_, __) => Text(
        'Could not load branches',
        style: theme.textTheme.bodySmall?.copyWith(
          color: theme.colorScheme.error,
        ),
      ),
    );
  }
}
