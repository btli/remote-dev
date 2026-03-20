import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:remote_dev/domain/repositories/session_repository.dart';
import 'package:remote_dev/domain/value_objects/agent_provider.dart';
import 'package:remote_dev/domain/value_objects/terminal_type.dart';
import 'package:remote_dev/presentation/providers/providers.dart';

class CreateSessionSheet extends ConsumerStatefulWidget {
  const CreateSessionSheet({super.key});

  @override
  ConsumerState<CreateSessionSheet> createState() =>
      _CreateSessionSheetState();
}

class _CreateSessionSheetState extends ConsumerState<CreateSessionSheet> {
  final _nameController = TextEditingController(text: 'New Session');
  TerminalType _terminalType = TerminalType.shell;
  AgentProvider _agentProvider = AgentProvider.claude;
  bool _isCreating = false;

  @override
  void dispose() {
    _nameController.dispose();
    super.dispose();
  }

  Future<void> _create() async {
    final name = _nameController.text.trim();
    if (name.isEmpty) return;

    setState(() => _isCreating = true);

    try {
      final session =
          await ref.read(sessionListProvider.notifier).createSession(
                CreateSessionInput(
                  name: name,
                  terminalType: _terminalType.value,
                  agentProvider: _terminalType == TerminalType.agent
                      ? _agentProvider.value
                      : null,
                  autoLaunchAgent: _terminalType == TerminalType.agent,
                ),
              );

      if (!mounted) return;
      Navigator.of(context).pop();

      if (session != null) {
        ref.read(activeSessionIdProvider.notifier).state = session.id;
      }
    } finally {
      if (mounted) setState(() => _isCreating = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Padding(
      padding: EdgeInsets.fromLTRB(
        24,
        0,
        24,
        MediaQuery.of(context).viewInsets.bottom + 24,
      ),
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
                      leadingIcon: const Icon(Icons.smart_toy_outlined),
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

          FilledButton(
            onPressed: _isCreating ? null : _create,
            child: _isCreating
                ? const SizedBox(
                    height: 20,
                    width: 20,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Text('Create Session'),
          ),
          const SizedBox(height: 8),
        ],
      ),
    );
  }
}
