import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../domain/session_summary.dart';
import 'project_tree_sheet.dart';
import 'sessions_tab_screen.dart' show sessionsApiProvider;

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
  bool _saving = false;
  String? _error;

  @override
  void dispose() {
    _nameCtrl.dispose();
    _commandCtrl.dispose();
    super.dispose();
  }

  Future<void> _pickProject() async {
    final id = await showProjectTreeSheet(context);
    if (id != null) {
      setState(() {
        _projectId = id;
        // Phase 2 doesn't fetch the project name here; P2.9 / P5 wires a
        // name lookup. For now show the id as the label.
        _projectLabel = id;
      });
    }
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;
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
                  if (v != null) setState(() => _terminalType = v);
                },
              ),
              const SizedBox(height: 12),
              ListTile(
                contentPadding: EdgeInsets.zero,
                title: Text(
                  _projectLabel == null
                      ? 'Pick a project (optional)'
                      : _projectLabel!,
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
                onPressed: _saving ? null : _save,
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
