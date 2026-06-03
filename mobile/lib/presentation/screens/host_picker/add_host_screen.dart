import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uuid/uuid.dart';

import '../../../domain/host_config.dart';
import '../../../domain/instance_summary.dart';
import '../../../domain/workspace_config.dart';
import '../../../infrastructure/api/instances_api.dart';
import '../../../infrastructure/auth/mobile_callback_login_launcher.dart';
import '../../../infrastructure/auth/mobile_credentials.dart';
import '../../../infrastructure/deep_link/deep_link_stream_provider.dart';
import '../webview_host/session_route_host.dart'
    show
        activeWorkspaceProvider,
        hostWorkspaceStoreProvider,
        mobileCredentialsStoreProvider,
        secureStorageProvider;

/// Test seam — replaces the host (Supervisor) system-browser login
/// (`launcher.loginHost`). Returns the [HostCallback] (host-wide CF token), or
/// throws on launch/timeout/shape failure (mirroring the real launcher).
typedef HostLoginLauncher = Future<HostCallback> Function(Uri origin);

/// Test seam — replaces the per-workspace system-browser login
/// (`launcher.login`) used on the single-workspace branch. Returns the minted
/// [MobileCredentials], or `null` if the user cancelled.
typedef InstanceLoginLauncher = Future<MobileCredentials?> Function(
  Uri serverUrl,
);

/// Test seam — builds an [InstancesApi] for the freshly-bootstrapped host so
/// the kind-detection `list()` call can be faked in widget tests.
typedef InstancesApiFactory = InstancesApi Function(HostConfig host);

/// Adds a connection target by ORIGIN + label, then detects whether it is a
/// single-workspace Remote Dev server or a multi-workspace Supervisor:
///
/// 1. Bootstrap the host CF token via the system browser (`loginHost`),
///    persist the [HostConfig] + token.
/// 2. Probe `GET /api/instances`:
///    - 200 (Supervisor) → mark the host `multiWorkspace` and push the
///      [WorkspacePickerScreen] with the discovered instances.
///    - 404 ([NotASupervisorException]) → mark the host `singleWorkspace`,
///      mint its API key (`login`), persist + activate a single
///      [WorkspaceConfig] (empty slug/basePath), and navigate `/home`.
///    - other errors → inline error + retry (the detect step alone re-runs;
///      the harmless host row + CF token are kept).
class AddHostScreen extends ConsumerStatefulWidget {
  const AddHostScreen({
    required this.onSingleWorkspaceActivated,
    required this.onSupervisorDetected,
    this.hostLoginLauncher,
    this.instanceLoginLauncher,
    this.instancesApiFactory,
    super.key,
  });

  /// Invoked after a single-workspace host's workspace is minted, persisted,
  /// and activated. The router navigates to `/home`.
  final void Function(WorkspaceConfig) onSingleWorkspaceActivated;

  /// Invoked once a Supervisor host is detected, carrying the host and the
  /// instances discovered. The router pushes [WorkspacePickerScreen].
  final void Function(HostConfig host, List<InstanceSummary> instances)
      onSupervisorDetected;

  /// Test seam — replaces the host system-browser login.
  final HostLoginLauncher? hostLoginLauncher;

  /// Test seam — replaces the single-workspace system-browser login.
  final InstanceLoginLauncher? instanceLoginLauncher;

  /// Test seam — replaces the [InstancesApi] construction.
  final InstancesApiFactory? instancesApiFactory;

  @override
  ConsumerState<AddHostScreen> createState() => _AddHostScreenState();
}

class _AddHostScreenState extends ConsumerState<AddHostScreen> {
  final _formKey = GlobalKey<FormState>();
  final _originCtrl = TextEditingController();
  final _labelCtrl = TextEditingController();
  bool _busy = false;
  String? _error;

  /// Set once [_bootstrapHost] succeeds. When present, the failed-detect path
  /// surfaces a "Retry" button that re-runs ONLY the detect step against this
  /// already-persisted host (no second browser round-trip).
  HostConfig? _bootstrappedHost;

  Future<HostCallback> _runHostLogin(Uri origin) {
    final override = widget.hostLoginLauncher;
    if (override != null) return override(origin);
    final launcher = MobileCallbackLoginLauncher(
      deepLinkStream: ref.read(deepLinkStreamProvider),
    );
    return launcher.loginHost(origin: origin);
  }

  Future<MobileCredentials?> _runInstanceLogin(Uri serverUrl) {
    final override = widget.instanceLoginLauncher;
    if (override != null) return override(serverUrl);
    final launcher = MobileCallbackLoginLauncher(
      deepLinkStream: ref.read(deepLinkStreamProvider),
    );
    return launcher.login(serverUrl: serverUrl);
  }

  InstancesApi _buildApi(HostConfig host) {
    final override = widget.instancesApiFactory;
    if (override != null) return override(host);
    return InstancesApi(
      origin: host.origin,
      hostId: host.id,
      storage: ref.read(secureStorageProvider),
    );
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final host = await _bootstrapHost();
      if (host == null) return; // error already surfaced
      await _detect(host);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  /// Retry path: skip the browser bootstrap and re-run detection against the
  /// host we already persisted.
  Future<void> _retryDetect() async {
    final host = _bootstrappedHost;
    if (host == null) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await _detect(host);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  /// Step 1: normalise the origin, run the host CF-token browser bootstrap,
  /// persist the [HostConfig] + token. Returns the host on success; on launch/
  /// timeout/shape failure surfaces an inline error and returns null.
  Future<HostConfig?> _bootstrapHost() async {
    final origin = HostConfig.normalizeOrigin(_originCtrl.text.trim());
    final label = _labelCtrl.text.trim();
    final HostCallback hostCb;
    try {
      hostCb = await _runHostLogin(Uri.parse(origin));
    } on MobileCallbackException catch (e) {
      if (mounted) setState(() => _error = e.message);
      return null;
    } catch (e) {
      if (mounted) setState(() => _error = 'Sign-in failed: $e');
      return null;
    }
    if (!mounted) return null;

    final now = DateTime.now();
    // Default kind is single; the detect step upgrades it to multi if the host
    // answers /api/instances. Either way it is overwritten by an upsert.
    final host = HostConfig(
      id: const Uuid().v4(),
      label: label,
      origin: origin,
      kind: HostKind.singleWorkspace,
      createdAt: now,
      lastUsedAt: now,
    );

    final store = ref.read(hostWorkspaceStoreProvider);
    final credentials = ref.read(mobileCredentialsStoreProvider);
    await store.upsertHost(host);
    await credentials.setHostCfToken(host.id, hostCb.cfToken);
    _bootstrappedHost = host;
    return host;
  }

  /// Step 2: probe `/api/instances` to branch single vs multi.
  Future<void> _detect(HostConfig host) async {
    final List<InstanceSummary> instances;
    try {
      instances = await _buildApi(host).list();
    } on NotASupervisorException {
      // Single-workspace server.
      await _activateSingleWorkspace(host);
      return;
    } catch (e) {
      // Transient (network/timeout/401). Keep the host row + CF token; offer a
      // retry of just the detect step.
      if (mounted) {
        setState(
          () => _error = "Couldn't reach this host's workspaces: $e",
        );
      }
      return;
    }

    // Multi-workspace (Supervisor): persist the upgraded kind, hand off to the
    // workspace picker.
    final store = ref.read(hostWorkspaceStoreProvider);
    final upgraded = HostConfig(
      id: host.id,
      label: host.label,
      origin: host.origin,
      kind: HostKind.multiWorkspace,
      createdAt: host.createdAt,
      lastUsedAt: host.lastUsedAt,
    );
    await store.upsertHost(upgraded);
    _bootstrappedHost = upgraded;
    if (mounted) widget.onSupervisorDetected(upgraded, instances);
  }

  /// Single-workspace branch: mint the API key, persist + activate a single
  /// [WorkspaceConfig] with empty slug/basePath, navigate `/home`.
  Future<void> _activateSingleWorkspace(HostConfig host) async {
    final store = ref.read(hostWorkspaceStoreProvider);
    // Mark the kind explicitly (it bootstrapped as single, but be defensive in
    // case a prior detect upgraded it).
    if (host.kind != HostKind.singleWorkspace) {
      host = HostConfig(
        id: host.id,
        label: host.label,
        origin: host.origin,
        kind: HostKind.singleWorkspace,
        createdAt: host.createdAt,
        lastUsedAt: host.lastUsedAt,
      );
      await store.upsertHost(host);
      _bootstrappedHost = host;
    }

    final creds = await _runInstanceLogin(Uri.parse(host.origin));
    if (!mounted) return;
    if (creds == null) {
      setState(() => _error = 'Sign-in cancelled.');
      return;
    }

    final ws = WorkspaceConfig(
      id: const Uuid().v4(),
      hostId: host.id,
      slug: '',
      basePath: '',
      displayName: host.label,
      status: null,
      lastUsedAt: DateTime.now(),
    );

    final credentials = ref.read(mobileCredentialsStoreProvider);
    // Persist credentials BEFORE the workspace row + active pointer.
    await credentials.setWorkspaceApiKey(ws.id, creds.apiKey);
    final cf = creds.cfToken;
    if (cf != null && cf.isNotEmpty) {
      await credentials.setHostCfToken(host.id, cf);
    }
    await store.upsertWorkspace(ws);
    await store.setActiveWorkspace(ws.id);
    ref.invalidate(activeWorkspaceProvider);
    if (mounted) widget.onSingleWorkspaceActivated(ws);
  }

  @override
  void dispose() {
    _originCtrl.dispose();
    _labelCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final canRetry = _bootstrappedHost != null && !_busy;
    return Scaffold(
      backgroundColor: const Color(0xFF1A1B26),
      appBar: AppBar(
        backgroundColor: const Color(0xFF1A1B26),
        title: const Text('Add host', style: TextStyle(color: Colors.white)),
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
                controller: _originCtrl,
                style: const TextStyle(color: Colors.white),
                decoration: const InputDecoration(
                  labelText: 'Host URL',
                  hintText: 'https://dev.example.com',
                ),
                validator: (v) {
                  final uri = Uri.tryParse((v ?? '').trim());
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
              if (_error != null) ...[
                const SizedBox(height: 16),
                Text(
                  _error!,
                  style: const TextStyle(color: Colors.redAccent),
                ),
              ],
              const SizedBox(height: 32),
              ElevatedButton(
                onPressed: _busy ? null : _submit,
                child: _busy
                    ? const SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Text('Add'),
              ),
              if (canRetry) ...[
                const SizedBox(height: 12),
                OutlinedButton(
                  onPressed: _retryDetect,
                  child: const Text('Retry'),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
