import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../application/ports/agent_cli_port.dart';
import '../../../domain/session_summary.dart';
import 'project_tree_sheet.dart';
import 'sessions_tab_screen.dart' show sessionsApiProvider;

/// DI seam for the agent CLI status API. Overridden in `main.dart`.
final agentCliApiProvider = Provider<AgentCliPort>((ref) {
  throw UnimplementedError(
    'agentCliApiProvider must be overridden in main.dart',
  );
});

/// Installed agent CLIs reported by the active server.
final installedAgentsProvider = FutureProvider<List<InstalledAgent>>((ref) {
  return ref.watch(agentCliApiProvider).listInstalled();
});

/// Returns the created [SessionSummary] (or null if the user cancelled).
Future<SessionSummary?> showNewSessionSheet(BuildContext context) {
  return showModalBottomSheet<SessionSummary>(
    context: context,
    backgroundColor: const Color(0xFF1A1B26),
    isScrollControlled: true,
    builder: (_) => Padding(
      padding: EdgeInsets.only(
        bottom: MediaQuery.of(context).viewInsets.bottom,
      ),
      child: const NewSessionSheet(),
    ),
  );
}

class NewSessionSheet extends ConsumerStatefulWidget {
  const NewSessionSheet({super.key});

  @override
  ConsumerState<NewSessionSheet> createState() => _NewSessionSheetState();
}

class _NewSessionSheetState extends ConsumerState<NewSessionSheet> {
  final _formKey = GlobalKey<FormState>();
  final _nameCtrl = TextEditingController();
  final _commandCtrl = TextEditingController();
  String _terminalType = 'shell';
  String? _projectId;
  String? _projectLabel;
  String? _agentProvider;
  bool _saving = false;
  String? _error;

  @override
  void dispose() {
    _nameCtrl.dispose();
    _commandCtrl.dispose();
    super.dispose();
  }

  Future<void> _pickProject() async {
    final picked = await showProjectTreeSheet(context);
    if (picked != null) {
      setState(() {
        _projectId = picked.id;
        _projectLabel = picked.name;
      });
    }
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;
    if (_projectId == null) {
      setState(() => _error = 'Pick a project');
      return;
    }
    if (_terminalType == 'agent' && _agentProvider == null) {
      setState(() => _error = 'Pick an agent');
      return;
    }
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      final api = ref.read(sessionsApiProvider);
      final created = await api.create(
        name: _nameCtrl.text.trim(),
        terminalType: _terminalType,
        projectId: _projectId,
        initialCommand: _commandCtrl.text.trim().isEmpty
            ? null
            : _commandCtrl.text.trim(),
        agentProvider: _terminalType == 'agent' ? _agentProvider : null,
        autoLaunchAgent: _terminalType == 'agent' ? true : null,
      );
      if (mounted) Navigator.of(context).pop(created);
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = 'Failed to create session: $e';
          _saving = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Form(
        key: _formKey,
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Center(
                child: Container(
                  width: 36,
                  height: 4,
                  decoration: BoxDecoration(
                    color: Colors.white24,
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
              ),
              const SizedBox(height: 12),
              const Text(
                'New session',
                style: TextStyle(color: Colors.white, fontSize: 18),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 16),
              TextFormField(
                controller: _nameCtrl,
                style: const TextStyle(color: Colors.white),
                decoration: const InputDecoration(
                  labelText: 'Name',
                  labelStyle: TextStyle(color: Colors.white70),
                ),
                validator: (v) =>
                    (v == null || v.trim().isEmpty) ? 'Required' : null,
              ),
              const SizedBox(height: 12),
              DropdownButtonFormField<String>(
                initialValue: _terminalType,
                dropdownColor: const Color(0xFF24283B),
                style: const TextStyle(color: Colors.white),
                decoration: const InputDecoration(
                  labelText: 'Type',
                  labelStyle: TextStyle(color: Colors.white70),
                ),
                items: const [
                  DropdownMenuItem(value: 'shell', child: Text('Shell')),
                  DropdownMenuItem(value: 'agent', child: Text('Agent')),
                ],
                onChanged: (v) {
                  if (v != null) {
                    setState(() {
                      _terminalType = v;
                      if (v != 'agent') _agentProvider = null;
                    });
                  }
                },
              ),
              if (_terminalType == 'agent') ...[
                const SizedBox(height: 12),
                _AgentProviderField(
                  selected: _agentProvider,
                  onChanged: (provider) =>
                      setState(() => _agentProvider = provider),
                ),
              ],
              const SizedBox(height: 12),
              ListTile(
                contentPadding: EdgeInsets.zero,
                title: Text(
                  _projectLabel ?? 'Pick a project',
                  style: const TextStyle(color: Colors.white),
                ),
                trailing:
                    const Icon(Icons.chevron_right, color: Colors.white54),
                onTap: _pickProject,
              ),
              const SizedBox(height: 12),
              TextFormField(
                controller: _commandCtrl,
                style: const TextStyle(color: Colors.white),
                decoration: const InputDecoration(
                  labelText: 'Initial command (optional)',
                  labelStyle: TextStyle(color: Colors.white70),
                ),
              ),
              if (_error != null) ...[
                const SizedBox(height: 12),
                Text(
                  _error!,
                  style: const TextStyle(color: Color(0xFFF7768E)),
                ),
              ],
              const SizedBox(height: 20),
              ElevatedButton(
                onPressed: (_saving || _projectId == null) ? null : _save,
                child: _saving
                    ? const SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Text('Create'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Inline dropdown for picking an agent provider when `terminalType == 'agent'`.
///
/// Watches [installedAgentsProvider] and:
/// - loading: shows a small CircularProgressIndicator
/// - error: shows red error text
/// - empty: shows "No agents installed" (and the parent blocks save)
/// - success: renders a `DropdownButtonFormField` and defaults to the first
///   installed provider (preferring `claude`) via a post-frame callback.
class _AgentProviderField extends ConsumerWidget {
  const _AgentProviderField({
    required this.selected,
    required this.onChanged,
  });

  final String? selected;
  final ValueChanged<String?> onChanged;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final asyncAgents = ref.watch(installedAgentsProvider);
    return asyncAgents.when(
      loading: () => const Padding(
        padding: EdgeInsets.symmetric(vertical: 8),
        child: Center(
          child: SizedBox(
            width: 18,
            height: 18,
            child: CircularProgressIndicator(strokeWidth: 2),
          ),
        ),
      ),
      error: (err, _) => Text(
        'Failed to load agents: $err',
        style: const TextStyle(color: Color(0xFFF7768E)),
      ),
      data: (agents) {
        if (agents.isEmpty) {
          return const Text(
            'No agents installed',
            style: TextStyle(color: Color(0xFFF7768E)),
          );
        }
        // Default-pick the first installed agent, preferring `claude`.
        String? effectiveSelected = selected;
        if (effectiveSelected == null ||
            !agents.any((a) => a.provider == effectiveSelected)) {
          final preferred = agents.firstWhere(
            (a) => a.provider == 'claude',
            orElse: () => agents.first,
          );
          effectiveSelected = preferred.provider;
          // Defer the parent setState until the current frame finishes.
          WidgetsBinding.instance.addPostFrameCallback((_) {
            onChanged(preferred.provider);
          });
        }
        return DropdownButtonFormField<String>(
          initialValue: effectiveSelected,
          dropdownColor: const Color(0xFF24283B),
          style: const TextStyle(color: Colors.white),
          decoration: const InputDecoration(
            labelText: 'Agent',
            labelStyle: TextStyle(color: Colors.white70),
          ),
          items: [
            for (final agent in agents)
              DropdownMenuItem(
                value: agent.provider,
                child: Text(agent.label),
              ),
          ],
          onChanged: onChanged,
        );
      },
    );
  }
}
