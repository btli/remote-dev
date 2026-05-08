import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uuid/uuid.dart';

import '../../../domain/server_config.dart';
import '../webview_host/session_route_host.dart' show serverConfigStoreProvider;
import 'server_picker_screen.dart' show serversListProvider;

class AddServerScreen extends ConsumerStatefulWidget {
  const AddServerScreen({required this.onSaved, super.key});

  final void Function(ServerConfig) onSaved;

  @override
  ConsumerState<AddServerScreen> createState() => _AddServerScreenState();
}

class _AddServerScreenState extends ConsumerState<AddServerScreen> {
  final _formKey = GlobalKey<FormState>();
  final _urlCtrl = TextEditingController();
  final _labelCtrl = TextEditingController();
  bool _saving = false;

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _saving = true);
    try {
      final store = ref.read(serverConfigStoreProvider);
      final config = ServerConfig(
        id: const Uuid().v4(),
        label: _labelCtrl.text.trim(),
        url: _urlCtrl.text.trim(),
        lastUsedAt: DateTime.now(),
      );
      await store.upsert(config);
      await store.setActive(config.id);
      ref.invalidate(serversListProvider);
      if (mounted) widget.onSaved(config);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  void dispose() {
    _urlCtrl.dispose();
    _labelCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF1A1B26),
      appBar: AppBar(
        backgroundColor: const Color(0xFF1A1B26),
        title: const Text('Add server', style: TextStyle(color: Colors.white)),
      ),
      body: Form(
        key: _formKey,
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            children: [
              TextFormField(
                controller: _urlCtrl,
                style: const TextStyle(color: Colors.white),
                decoration: const InputDecoration(
                  labelText: 'Server URL',
                  hintText: 'https://dev.example.com',
                ),
                validator: (v) {
                  final uri = Uri.tryParse(v ?? '');
                  if (uri == null || !uri.hasScheme || !uri.hasAuthority) {
                    return 'Enter a valid URL with scheme and host';
                  }
                  return null;
                },
              ),
              const SizedBox(height: 16),
              TextFormField(
                controller: _labelCtrl,
                style: const TextStyle(color: Colors.white),
                decoration: const InputDecoration(labelText: 'Label'),
                validator: (v) =>
                    (v == null || v.trim().isEmpty) ? 'Required' : null,
              ),
              const SizedBox(height: 32),
              ElevatedButton(
                onPressed: _saving ? null : _save,
                child: _saving
                    ? const SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Text('Save'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
