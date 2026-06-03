import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../domain/host_config.dart';
import '../../../domain/workspace_config.dart';
import '../webview_host/session_route_host.dart'
    show activeWorkspaceProvider, hostWorkspaceStoreProvider;
import 'server_picker_screen.dart' show serverPickerDataProvider;

/// `go_router` `extra` payload for the `/servers/edit` route: the host being
/// edited plus, optionally, a specific workspace whose display name to edit.
///
/// - For a single-workspace host, both are supplied so the user can rename the
///   host AND its workspace in one screen.
/// - For a workspace under a multi-workspace host, [host] is the owner and
///   [workspace] is the one whose display name to edit (the host label field is
///   still shown for convenience).
@immutable
class EditHostArgs {
  const EditHostArgs({required this.host, this.workspace});

  final HostConfig host;
  final WorkspaceConfig? workspace;
}

/// Edits a [HostConfig] label and, when supplied, a [WorkspaceConfig] display
/// name. Persists via [HostWorkspaceStore.upsertHost] / `upsertWorkspace`
/// (preserving ids and bumping `lastUsedAt` so the most-recently-touched row
/// sorts first), then invalidates [activeWorkspaceProvider] so the
/// display-only shim re-derives the (possibly renamed) active label.
///
/// Unlike the add-host flow this runs no health-check probe — the user already
/// proved the host worked when they added it; a transient network hiccup
/// shouldn't block fixing a typo in a label.
class EditHostScreen extends ConsumerStatefulWidget {
  const EditHostScreen({
    required this.args,
    required this.onSaved,
    super.key,
  });

  final EditHostArgs args;
  final VoidCallback onSaved;

  @override
  ConsumerState<EditHostScreen> createState() => _EditHostScreenState();
}

class _EditHostScreenState extends ConsumerState<EditHostScreen> {
  final _formKey = GlobalKey<FormState>();
  late final TextEditingController _labelCtrl;
  TextEditingController? _workspaceNameCtrl;
  bool _saving = false;

  bool get _hasWorkspace => widget.args.workspace != null;

  @override
  void initState() {
    super.initState();
    _labelCtrl = TextEditingController(text: widget.args.host.label);
    final ws = widget.args.workspace;
    if (ws != null) {
      _workspaceNameCtrl = TextEditingController(text: ws.displayName);
    }
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _saving = true);
    try {
      final store = ref.read(hostWorkspaceStoreProvider);
      final now = DateTime.now();

      final host = widget.args.host;
      final newLabel = _labelCtrl.text.trim();
      if (newLabel != host.label) {
        await store.upsertHost(
          HostConfig(
            id: host.id,
            label: newLabel,
            origin: host.origin,
            kind: host.kind,
            createdAt: host.createdAt,
            lastUsedAt: now,
          ),
        );
      }

      final ws = widget.args.workspace;
      if (ws != null) {
        final newName = _workspaceNameCtrl!.text.trim();
        if (newName != ws.displayName) {
          await store.upsertWorkspace(
            WorkspaceConfig(
              id: ws.id,
              hostId: ws.hostId,
              slug: ws.slug,
              basePath: ws.basePath,
              displayName: newName,
              status: ws.status,
              lastUsedAt: now,
            ),
          );
        }
      }

      // Refresh both the picker list and the active-connection shim (the active
      // workspace's display name may have just changed).
      ref.invalidate(serverPickerDataProvider);
      ref.invalidate(activeWorkspaceProvider);
      if (mounted) widget.onSaved();
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  void dispose() {
    _labelCtrl.dispose();
    _workspaceNameCtrl?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF1A1B26),
      appBar: AppBar(
        backgroundColor: const Color(0xFF1A1B26),
        title: const Text('Edit host', style: TextStyle(color: Colors.white)),
        iconTheme: const IconThemeData(color: Colors.white),
      ),
      body: Form(
        key: _formKey,
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // Origin is read-only here — changing it would invalidate the
              // host-wide CF credentials. Re-add the host to point elsewhere.
              Text(
                widget.args.host.origin,
                style: const TextStyle(color: Colors.white54, fontSize: 13),
              ),
              const SizedBox(height: 16),
              TextFormField(
                controller: _labelCtrl,
                style: const TextStyle(color: Colors.white),
                decoration: const InputDecoration(labelText: 'Host label'),
                validator: (v) =>
                    (v == null || v.trim().isEmpty) ? 'Required' : null,
              ),
              if (_hasWorkspace) ...[
                const SizedBox(height: 16),
                TextFormField(
                  controller: _workspaceNameCtrl,
                  style: const TextStyle(color: Colors.white),
                  decoration: const InputDecoration(
                    labelText: 'Workspace name',
                  ),
                  validator: (v) =>
                      (v == null || v.trim().isEmpty) ? 'Required' : null,
                ),
              ],
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
