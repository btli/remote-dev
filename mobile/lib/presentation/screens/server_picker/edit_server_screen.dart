import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../domain/server_config.dart';
import '../webview_host/session_route_host.dart' show serverConfigStoreProvider;
import 'server_picker_screen.dart' show serversListProvider;

/// Edits an existing [ServerConfig]. Pre-fills with the current label/url and
/// saves via [ServerConfigStore.upsert] (preserving the id and bumping
/// `lastUsedAt` to now so the sort order reflects recent activity).
///
/// Unlike [AddServerScreen] this does not run a health-check probe — the user
/// already proved this server worked when they added it; a transient network
/// hiccup shouldn't block them from fixing a typo in the label.
class EditServerScreen extends ConsumerStatefulWidget {
  const EditServerScreen({
    required this.initial,
    required this.onSaved,
    super.key,
  });

  final ServerConfig initial;
  final void Function(ServerConfig) onSaved;

  @override
  ConsumerState<EditServerScreen> createState() => _EditServerScreenState();
}

class _EditServerScreenState extends ConsumerState<EditServerScreen> {
  final _formKey = GlobalKey<FormState>();
  late final TextEditingController _urlCtrl;
  late final TextEditingController _labelCtrl;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    _urlCtrl = TextEditingController(text: widget.initial.url);
    _labelCtrl = TextEditingController(text: widget.initial.label);
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _saving = true);
    try {
      final store = ref.read(serverConfigStoreProvider);
      final updated = widget.initial.copyWith(
        label: _labelCtrl.text.trim(),
        url: _urlCtrl.text.trim(),
        lastUsedAt: DateTime.now(),
      );
      await store.upsert(updated);
      ref.invalidate(serversListProvider);
      if (mounted) widget.onSaved(updated);
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
        title: const Text('Edit server', style: TextStyle(color: Colors.white)),
        iconTheme: const IconThemeData(color: Colors.white),
      ),
      body: Form(
        key: _formKey,
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
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
