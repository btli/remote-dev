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
/// the CF Access session).
///
/// The secret is **write-only**: only the (non-secret) Client ID is prefilled
/// when a token is already stored; the secret field is left blank with a
/// "secret saved" indicator. This avoids rendering a permanent credential back
/// into a text field, and it makes the save semantics safe against the
/// load-before-save race:
///   - Secret entered → replace the pair (Client ID required too).
///   - Secret left blank while a token exists → KEEP the stored pair (a blank
///     secret never means "clear" — otherwise an early Save before the async
///     prefill resolved could silently wipe a saved token).
///   - Removing the token happens ONLY via the explicit "Clear service token"
///     button, which is disabled until the async load has resolved (so it can
///     never fire against unknown state).
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

  /// CF Access service-token fields. The Client ID is prefilled from secure
  /// storage once [_loadServiceToken] resolves; the secret is **never**
  /// prefilled (write-only — see the class doc).
  final _serviceIdCtrl = TextEditingController();
  final _serviceSecretCtrl = TextEditingController();

  /// Whether the secret field renders its (newly-typed) value. Default
  /// obscured; the user's own device/storage, so revealing what they type is
  /// acceptable.
  bool _secretVisible = false;

  /// True once the async [_loadServiceToken] read has resolved. Until then the
  /// "Clear service token" button is disabled so it can never fire against
  /// unknown state (closes the load-before-act race).
  bool _serviceTokenLoaded = false;

  /// Whether a service token is currently persisted for this host. Drives the
  /// "secret saved" indicator + the visibility of the Clear button, and gates
  /// the "blank secret keeps the stored pair" save branch.
  bool _hasStoredToken = false;

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

  /// Prefill the service-token Client ID from secure storage and record whether
  /// a token exists. Best-effort: a missing token (or a read failure) just
  /// leaves the fields empty. The SECRET is intentionally never written into
  /// the field. Guards on [mounted] because the read is async and the screen
  /// may have been popped. Always flips [_serviceTokenLoaded] so the Clear
  /// button enables even when no token is present.
  Future<void> _loadServiceToken() async {
    final creds = ref.read(mobileCredentialsStoreProvider);
    final token = await creds.getHostServiceToken(widget.args.host.id);
    if (!mounted) return;
    setState(() {
      _serviceTokenLoaded = true;
      _hasStoredToken = token != null;
      if (token != null) {
        _serviceIdCtrl.text = token.clientId;
      }
    });
  }

  /// Explicitly remove the stored service token. Only reachable once
  /// [_serviceTokenLoaded] is true. Clears storage + both fields and updates
  /// the indicator.
  Future<void> _clearServiceToken() async {
    final creds = ref.read(mobileCredentialsStoreProvider);
    await creds.clearHostServiceToken(widget.args.host.id);
    if (!mounted) return;
    setState(() {
      _hasStoredToken = false;
      _serviceIdCtrl.clear();
      _serviceSecretCtrl.clear();
    });
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Cloudflare service token removed')),
    );
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

      // Persist the CF Access service token (write-only secret model):
      //   - A secret was entered → replace the pair (the validators guarantee
      //     the Client ID is present too).
      //   - The secret field is blank → DO NOT write: keep whatever is stored.
      //     A blank secret never clears — removal is the Clear button's job —
      //     so an early Save before the async prefill resolved can't wipe a
      //     saved token (finding 2). When nothing is stored and both fields are
      //     blank this is simply a no-op.
      final clientSecret = _serviceSecretCtrl.text.trim();
      if (clientSecret.isNotEmpty) {
        final creds = ref.read(mobileCredentialsStoreProvider);
        await creds.setHostServiceToken(
          host.id,
          clientId: _serviceIdCtrl.text.trim(),
          clientSecret: clientSecret,
        );
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
              Text(
                _hasStoredToken
                    ? 'A service token is saved. Leave the secret blank to keep '
                        'it, or enter a new Client ID + Secret to replace it.'
                    : 'For hosts behind Cloudflare Access. Create under '
                        'Zero Trust → Access → Service Tokens.',
                style: const TextStyle(color: Colors.white54, fontSize: 12),
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
                // A NEW token needs both halves. When a token is already stored
                // the Client ID is prefilled and the secret may be left blank
                // (= keep), so the both-or-neither rule only applies when no
                // token is stored yet.
                validator: (v) {
                  final id = (v ?? '').trim();
                  final secret = _serviceSecretCtrl.text.trim();
                  if (!_hasStoredToken && id.isNotEmpty && secret.isEmpty) {
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
                  // Write-only: never prefilled. Tell the user a secret is
                  // saved without revealing it.
                  helperText: _hasStoredToken ? 'Secret saved' : null,
                  helperStyle: const TextStyle(color: Colors.white38),
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
                // Entering a secret requires a Client ID too (a usable token is
                // a complete pair). A blank secret is always valid — it means
                // "keep the stored token" (or "no token") per the write-only
                // model — so removal goes through the Clear button instead.
                validator: (v) {
                  final secret = (v ?? '').trim();
                  final id = _serviceIdCtrl.text.trim();
                  if (secret.isNotEmpty && id.isEmpty) {
                    return 'Enter the client ID too';
                  }
                  return null;
                },
              ),
              // Explicit removal. Disabled until the async load resolves (so it
              // can't act on unknown state) and only shown when a token exists.
              if (_hasStoredToken) ...[
                const SizedBox(height: 4),
                Align(
                  alignment: Alignment.centerLeft,
                  child: TextButton.icon(
                    onPressed: (_serviceTokenLoaded && !_saving)
                        ? _clearServiceToken
                        : null,
                    icon: const Icon(Icons.delete_outline, size: 18),
                    label: const Text('Clear service token'),
                    style: TextButton.styleFrom(
                      foregroundColor: Colors.redAccent,
                    ),
                  ),
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
