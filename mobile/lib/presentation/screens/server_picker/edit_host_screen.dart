import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../domain/host_config.dart';
import '../../../domain/workspace_config.dart';
import '../webview_host/session_route_host.dart'
    show
        activeWorkspaceProvider,
        hostWorkspaceStoreProvider,
        mobileCredentialsStoreProvider;
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
/// Also edits the host's optional **Cloudflare Access service token** (the
/// `CF-Access-Client-Id` / `CF-Access-Client-Secret` pair). This is the
/// permanent off-LAN edge credential: when set, [MobileCredentialsStore]
/// persists it host-wide and [CfAuthInterceptor] attaches both headers on every
/// request so Cloudflare admits it at the edge with no session and no expiry
/// (complementing the harvested `CF_Authorization` cookie, which expires with
/// the CF Access session). The fields are prefilled from secure storage when
/// editing a host that already has one; saving both blank clears the token.
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

  /// CF Access service-token fields. Prefilled asynchronously from secure
  /// storage in [initState] (the read is async, so the controllers start empty
  /// and are populated once [_loadServiceToken] resolves).
  final _serviceIdCtrl = TextEditingController();
  final _serviceSecretCtrl = TextEditingController();

  /// Whether the secret field renders its value (false → obscured). The user's
  /// own device/storage, so revealing is acceptable; default obscured.
  bool _secretVisible = false;

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
    _loadServiceToken();
  }

  /// Prefill the service-token fields from secure storage. Best-effort: if the
  /// host has no token (or the read fails) the fields simply stay empty. Guards
  /// on [mounted] because the read is async and the screen may have been popped.
  Future<void> _loadServiceToken() async {
    final creds = ref.read(mobileCredentialsStoreProvider);
    final token = await creds.getHostServiceToken(widget.args.host.id);
    if (!mounted || token == null) return;
    setState(() {
      _serviceIdCtrl.text = token.clientId;
      _serviceSecretCtrl.text = token.clientSecret;
    });
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

      // Persist the CF Access service token. Both fields filled → save the
      // pair; both blank → clear any existing token. A half-filled pair is
      // rejected by the form validator below, so it never reaches here.
      final creds = ref.read(mobileCredentialsStoreProvider);
      final clientId = _serviceIdCtrl.text.trim();
      final clientSecret = _serviceSecretCtrl.text.trim();
      if (clientId.isNotEmpty && clientSecret.isNotEmpty) {
        await creds.setHostServiceToken(
          host.id,
          clientId: clientId,
          clientSecret: clientSecret,
        );
      } else {
        await creds.clearHostServiceToken(host.id);
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
    _serviceIdCtrl.dispose();
    _serviceSecretCtrl.dispose();
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

              // --- Cloudflare Access service token (optional) ----------------
              const SizedBox(height: 24),
              const Text(
                'Cloudflare service token',
                style: TextStyle(
                  color: Colors.white,
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                ),
              ),
              const SizedBox(height: 4),
              const Text(
                'For hosts behind Cloudflare Access. Create under '
                'Zero Trust → Access → Service Tokens.',
                style: TextStyle(color: Colors.white54, fontSize: 12),
              ),
              const SizedBox(height: 12),
              TextFormField(
                controller: _serviceIdCtrl,
                style: const TextStyle(color: Colors.white),
                autocorrect: false,
                enableSuggestions: false,
                decoration: const InputDecoration(
                  labelText: 'Client ID',
                ),
                // Both-or-neither: a service token is only usable as a complete
                // pair, so require the secret too when an id is given.
                validator: (v) {
                  final id = (v ?? '').trim();
                  final secret = _serviceSecretCtrl.text.trim();
                  if (id.isNotEmpty && secret.isEmpty) {
                    return 'Enter the client secret too';
                  }
                  return null;
                },
              ),
              const SizedBox(height: 16),
              TextFormField(
                controller: _serviceSecretCtrl,
                style: const TextStyle(color: Colors.white),
                autocorrect: false,
                enableSuggestions: false,
                obscureText: !_secretVisible,
                decoration: InputDecoration(
                  labelText: 'Client Secret',
                  suffixIcon: IconButton(
                    icon: Icon(
                      _secretVisible
                          ? Icons.visibility_off
                          : Icons.visibility,
                      color: Colors.white54,
                    ),
                    onPressed: () =>
                        setState(() => _secretVisible = !_secretVisible),
                    tooltip: _secretVisible ? 'Hide secret' : 'Show secret',
                  ),
                ),
                // Both-or-neither mirror of the Client ID validator.
                validator: (v) {
                  final secret = (v ?? '').trim();
                  final id = _serviceIdCtrl.text.trim();
                  if (secret.isNotEmpty && id.isEmpty) {
                    return 'Enter the client ID too';
                  }
                  return null;
                },
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
