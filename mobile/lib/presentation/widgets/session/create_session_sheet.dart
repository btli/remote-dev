import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:remote_dev/domain/repositories/session_repository.dart';
import 'package:remote_dev/domain/value_objects/agent_provider.dart';
import 'package:remote_dev/domain/value_objects/terminal_type.dart';
import 'package:remote_dev/presentation/providers/providers.dart';

/// Bottom sheet for creating a new terminal session.
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

    final session = await ref.read(sessionListProvider.notifier).createSession(
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
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Padding(
      padding: EdgeInsets.fromLTRB(
        24,
        16,
        24,
        MediaQuery.of(context).viewInsets.bottom + 24,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // Handle
          Center(
            child: Container(
              width: 32,
              height: 4,
              decoration: BoxDecoration(
                color: theme.colorScheme.onSurface.withValues(alpha: 0.2),
                borderRadius: BorderRadius.circular(2),
              ),
            ),
          ),
          const SizedBox(height: 16),

          Text(
            'New Session',
            style: theme.textTheme.titleMedium?.copyWith(
              fontWeight: FontWeight.bold,
            ),
          ),
          const SizedBox(height: 16),

          // Name field
          TextField(
            controller: _nameController,
            decoration: const InputDecoration(
              labelText: 'Session Name',
              border: OutlineInputBorder(),
              prefixIcon: Icon(Icons.label_outline),
            ),
            autofocus: true,
            textCapitalization: TextCapitalization.words,
          ),
          const SizedBox(height: 16),

          // Terminal type
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
          const SizedBox(height: 16),

          // Agent provider (conditional)
          if (_terminalType == TerminalType.agent) ...[
            DropdownButtonFormField<AgentProvider>(
              initialValue: _agentProvider,
              decoration: const InputDecoration(
                labelText: 'Agent Provider',
                border: OutlineInputBorder(),
                prefixIcon: Icon(Icons.smart_toy_outlined),
              ),
              items: AgentProvider.values
                  .where((p) => p.isAgent)
                  .map(
                    (provider) => DropdownMenuItem(
                      value: provider,
                      child: Text(provider.displayName),
                    ),
                  )
                  .toList(),
              onChanged: (value) {
                if (value != null) {
                  setState(() => _agentProvider = value);
                }
              },
            ),
            const SizedBox(height: 16),
          ],

          // Create button
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
        ],
      ),
    );
  }
}
