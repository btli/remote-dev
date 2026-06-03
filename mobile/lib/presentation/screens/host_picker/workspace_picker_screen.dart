import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

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

/// Test seam — replaces the system-browser instance login (`launcher.login`)
/// when supplied. Returns the minted [MobileCredentials], or `null` if the
/// user cancelled the CF Access flow.
typedef WorkspaceLoginLauncher = Future<MobileCredentials?> Function(
  Uri serverUrl,
);

/// Test seam — builds an [InstancesApi] for the given host. In production this
/// wires the shared [secureStorageProvider]; widget tests override it with a
/// fake that returns canned instances (or throws) without real network.
typedef InstancesApiFactory = InstancesApi Function(HostConfig host);

/// `go_router` `extra` payload for the `/hosts/workspaces` route: the host plus
/// the instances [AddHostScreen] already discovered.
class WorkspacePickerArgs {
  const WorkspacePickerArgs({required this.host, required this.instances});

  final HostConfig host;
  final List<InstanceSummary> instances;
}

/// Lists the workspaces (instances) discovered on a multi-workspace
/// (Supervisor) [host] and lets the user pick a READY one to sign into.
///
/// On selection of a ready instance: mint its per-workspace API key via the
/// system-browser login, upsert a [WorkspaceConfig] (basePath `/<slug>`),
/// refresh the host CF token if the callback carried a fresher one, activate
/// the workspace, invalidate [activeWorkspaceProvider], and navigate `/home`.
class WorkspacePickerScreen extends ConsumerStatefulWidget {
  const WorkspacePickerScreen({
    required this.host,
    required this.instances,
    required this.onActivated,
    this.workspaceLoginLauncher,
    this.instancesApiFactory,
    super.key,
  });

  final HostConfig host;

  /// The instances already discovered by [AddHostScreen]'s detect step. The
  /// initial render uses these; pull-to-refresh re-queries the host.
  final List<InstanceSummary> instances;

  /// Invoked after a workspace is successfully minted, persisted, and
  /// activated. The router supplies a handler that navigates to `/home`.
  final void Function(WorkspaceConfig) onActivated;

  /// Test seam — replaces the system-browser instance login.
  final WorkspaceLoginLauncher? workspaceLoginLauncher;

  /// Test seam — replaces the [InstancesApi] construction for refresh.
  final InstancesApiFactory? instancesApiFactory;

  @override
  ConsumerState<WorkspacePickerScreen> createState() =>
      _WorkspacePickerScreenState();
}

class _WorkspacePickerScreenState
    extends ConsumerState<WorkspacePickerScreen> {
  late List<InstanceSummary> _instances = widget.instances;
  bool _busy = false;
  String? _error;

  InstancesApi _buildApi() {
    final override = widget.instancesApiFactory;
    if (override != null) return override(widget.host);
    return InstancesApi(
      origin: widget.host.origin,
      hostId: widget.host.id,
      storage: ref.read(secureStorageProvider),
    );
  }

  Future<MobileCredentials?> _runLogin(Uri serverUrl) async {
    final override = widget.workspaceLoginLauncher;
    if (override != null) return override(serverUrl);
    final launcher = MobileCallbackLoginLauncher(
      deepLinkStream: ref.read(deepLinkStreamProvider),
    );
    return launcher.login(serverUrl: serverUrl);
  }

  Future<void> _refresh() async {
    try {
      final refreshed = await _buildApi().list();
      if (!mounted) return;
      setState(() {
        _instances = refreshed;
        _error = null;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = 'Failed to refresh workspaces: $e');
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Failed to refresh workspaces: $e')),
      );
    }
  }

  Future<void> _select(InstanceSummary instance) async {
    if (_busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final host = widget.host;
      // Mint the per-workspace API key against `<origin>/<slug>`.
      final creds = await _runLogin(
        Uri.parse('${host.origin}/${instance.slug}'),
      );
      if (!mounted) return;
      if (creds == null) {
        setState(() => _error = 'Sign-in cancelled.');
        return;
      }

      final ws = WorkspaceConfig(
        id: 'w_${host.id}_${instance.slug}',
        hostId: host.id,
        slug: instance.slug,
        basePath: '/${instance.slug}',
        displayName: instance.displayName,
        status: instance.status,
        lastUsedAt: DateTime.now(),
      );

      final credentials = ref.read(mobileCredentialsStoreProvider);
      // Persist credentials BEFORE the workspace row + active pointer so any
      // listener reacting to the new active workspace finds the key in place.
      await credentials.setWorkspaceApiKey(ws.id, creds.apiKey);
      // The instance callback can carry a fresher host CF token (the browser
      // session may have re-challenged); refresh it so discovery + API calls
      // keep working.
      final cf = creds.cfToken;
      if (cf != null && cf.isNotEmpty) {
        await credentials.setHostCfToken(host.id, cf);
      }

      final store = ref.read(hostWorkspaceStoreProvider);
      await store.upsertWorkspace(ws);
      await store.setActiveWorkspace(ws.id);
      ref.invalidate(activeWorkspaceProvider);
      if (mounted) widget.onActivated(ws);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF1A1B26),
      appBar: AppBar(
        backgroundColor: const Color(0xFF1A1B26),
        title: Text(
          widget.host.label,
          style: const TextStyle(color: Colors.white),
        ),
        iconTheme: const IconThemeData(color: Colors.white),
      ),
      body: Stack(
        children: [
          RefreshIndicator(
            onRefresh: _refresh,
            child: _instances.isEmpty
                ? _buildEmptyState()
                : ListView.builder(
                    // Always scrollable so pull-to-refresh works even with a
                    // short list.
                    physics: const AlwaysScrollableScrollPhysics(),
                    itemCount: _instances.length,
                    itemBuilder: (context, i) {
                      final inst = _instances[i];
                      final ready = inst.status == 'ready';
                      return ListTile(
                        enabled: ready && !_busy,
                        title: Text(
                          inst.displayName,
                          style: const TextStyle(color: Colors.white),
                        ),
                        subtitle: Text(
                          inst.slug,
                          style: const TextStyle(color: Colors.white70),
                        ),
                        trailing: _StatusChip(status: inst.status),
                        onTap: ready && !_busy ? () => _select(inst) : null,
                      );
                    },
                  ),
          ),
          if (_error != null)
            Positioned(
              left: 0,
              right: 0,
              bottom: 0,
              child: Container(
                color: const Color(0xFF24283B),
                padding: const EdgeInsets.all(16),
                child: Text(
                  _error!,
                  style: const TextStyle(color: Colors.redAccent),
                ),
              ),
            ),
          if (_busy)
            const Positioned.fill(
              child: ColoredBox(
                color: Color(0x88000000),
                child: Center(child: CircularProgressIndicator()),
              ),
            ),
        ],
      ),
    );
  }

  Widget _buildEmptyState() {
    return ListView(
      // Scrollable so the RefreshIndicator can be pulled even when empty.
      physics: const AlwaysScrollableScrollPhysics(),
      children: [
        SizedBox(
          height: MediaQuery.of(context).size.height * 0.6,
          child: const Center(
            child: Padding(
              padding: EdgeInsets.all(32),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Text(
                    'No ready workspaces yet.',
                    style: TextStyle(color: Colors.white, fontSize: 18),
                  ),
                  SizedBox(height: 12),
                  Text(
                    'Pull down to refresh once an instance is provisioned.',
                    textAlign: TextAlign.center,
                    style: TextStyle(color: Colors.white70),
                  ),
                ],
              ),
            ),
          ),
        ),
      ],
    );
  }
}

/// Small status pill. `ready` is green/selectable; everything else is muted to
/// signal the row is disabled.
class _StatusChip extends StatelessWidget {
  const _StatusChip({required this.status});

  final String status;

  @override
  Widget build(BuildContext context) {
    final ready = status == 'ready';
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: ready ? const Color(0xFF1F3D2B) : const Color(0xFF3A2A1B),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Text(
        status,
        style: TextStyle(
          color: ready ? Colors.greenAccent : Colors.orangeAccent,
          fontSize: 12,
        ),
      ),
    );
  }
}
