import 'package:flutter/foundation.dart' show debugPrint;
import 'package:uuid/uuid.dart';

import '../domain/host_config.dart';
import '../domain/instance_summary.dart';
import '../domain/workspace_config.dart';
import '../infrastructure/api/instances_api.dart';
import '../infrastructure/auth/mobile_callback_login_launcher.dart';
import '../infrastructure/auth/mobile_credentials.dart';
import 'ports/host_workspace_store.dart';

/// The outcome of completing an interactive add-host login. Navigation +
/// provider invalidation are the CALLER's job (so this controller stays free of
/// UI / router / Riverpod concerns and is unit-testable in isolation).
sealed class AddHostOutcome {
  const AddHostOutcome();
}

/// A plain single instance (`GET /api/instances` → 404 / NotASupervisor): the
/// host's sole workspace has been persisted + activated. Caller invalidates the
/// active-connection provider and navigates to `/home` (session).
class AddHostSingleWorkspaceActivated extends AddHostOutcome {
  const AddHostSingleWorkspaceActivated({
    required this.host,
    required this.workspace,
  });
  final HostConfig host;
  final WorkspaceConfig workspace;
}

/// A Supervisor (`GET /api/instances` → 200): the host is marked
/// `multiWorkspace`. Caller pushes the workspace picker with [instances].
class AddHostSupervisorDetected extends AddHostOutcome {
  const AddHostSupervisorDetected({
    required this.host,
    required this.instances,
  });
  final HostConfig host;
  final List<InstanceSummary> instances;
}

/// Detection failed with a transient error (network / timeout / 401). The host
/// row + host-wide credentials are kept so the user can retry; nothing was
/// activated.
class AddHostDetectFailed extends AddHostOutcome {
  const AddHostDetectFailed({required this.host, required this.error});
  final HostConfig host;
  final Object error;
}

/// State-INDEPENDENT completion of the add-host flow.
///
/// Extracted out of `AddHostScreen.State` so it can run from the app-global
/// `AddHostLoginCompleter` and complete even though the triggering screen has
/// been rebuilt/disposed by the `remotedev://auth/callback` return (the
/// confirmed on-device failure). Given a parsed [MobileCallbackResult] it:
///   1. persists the [HostConfig] + host-wide auth cookies / CF token (from
///      EITHER a HostCallback or an InstanceCallback shape),
///   2. probes `GET /api/instances` to classify single-vs-supervisor,
///   3. for a single instance, activates the sole workspace (reusing the
///      callback's per-workspace apiKey + authCookies) and sets it active,
/// then returns an [AddHostOutcome] describing what the caller should navigate
/// to. All steps emit `[AddHostFlow]` breadcrumbs for on-device `adb logcat`.
class AddHostFlowController {
  AddHostFlowController({
    required HostWorkspaceStore store,
    required MobileCredentialsStore credentials,
    required InstancesApi Function(HostConfig host) instancesApiFactory,
    String Function()? idGenerator,
    DateTime Function()? clock,
  })  : _store = store,
        _credentials = credentials,
        _instancesApiFactory = instancesApiFactory,
        _idGenerator = idGenerator ?? (() => const Uuid().v4()),
        _clock = clock ?? DateTime.now;

  final HostWorkspaceStore _store;
  final MobileCredentialsStore _credentials;
  final InstancesApi Function(HostConfig host) _instancesApiFactory;
  final String Function() _idGenerator;
  final DateTime Function() _clock;

  Future<AddHostOutcome> completeFromCallback({
    required String origin,
    required String label,
    required MobileCallbackResult callback,
  }) async {
    // Host-wide credentials are present on BOTH callback shapes.
    final (authCookies, cfToken) = switch (callback) {
      HostCallback(:final authCookies, :final cfToken) => (authCookies, cfToken),
      InstanceCallback(:final authCookies, :final cfToken) => (
          authCookies,
          cfToken,
        ),
    };

    final now = _clock();
    final host = HostConfig(
      id: _idGenerator(),
      label: label,
      origin: origin,
      kind: HostKind.singleWorkspace,
      createdAt: now,
      lastUsedAt: now,
    );
    await _store.upsertHost(host);
    await _credentials.setHostAuthCookies(host.id, authCookies);
    if (cfToken.isNotEmpty) {
      await _credentials.setHostCfToken(host.id, cfToken);
    }
    debugPrint('[AddHostFlow] host persisted origin=$origin id=${host.id}');

    final List<InstanceSummary> instances;
    try {
      instances = await _instancesApiFactory(host).list();
    } on NotASupervisorException {
      debugPrint('[AddHostFlow] /api/instances 404 (NotASupervisor) → single');
      final ws = await _activateSingleWorkspace(host, callback);
      return AddHostSingleWorkspaceActivated(host: host, workspace: ws);
    } catch (e) {
      debugPrint('[AddHostFlow] /api/instances error: $e (host kept)');
      return AddHostDetectFailed(host: host, error: e);
    }

    debugPrint(
      '[AddHostFlow] /api/instances 200 (${instances.length} instances) → '
      'supervisor',
    );
    final upgraded = host.copyWith(kind: HostKind.multiWorkspace);
    await _store.upsertHost(upgraded);
    return AddHostSupervisorDetected(host: upgraded, instances: instances);
  }

  Future<WorkspaceConfig> _activateSingleWorkspace(
    HostConfig host,
    MobileCallbackResult callback,
  ) async {
    final ws = WorkspaceConfig(
      id: _idGenerator(),
      hostId: host.id,
      slug: '',
      basePath: '',
      displayName: host.label,
      status: null,
      lastUsedAt: _clock(),
    );

    final (authCookies, cfToken, apiKey) = switch (callback) {
      InstanceCallback(:final authCookies, :final cfToken, :final apiKey) => (
          authCookies,
          cfToken,
          apiKey,
        ),
      HostCallback(:final authCookies, :final cfToken) => (
          authCookies,
          cfToken,
          null,
        ),
    };

    // authCookies is always persisted (OIDC session-token or CF JWT).
    await _credentials.setWorkspaceAuthCookies(ws.id, authCookies);
    if (apiKey != null && apiKey.isNotEmpty) {
      await _credentials.setWorkspaceApiKey(ws.id, apiKey);
    }
    // Legacy compat: refresh the host CF token when the callback carried one.
    if (cfToken.isNotEmpty) {
      await _credentials.setHostCfToken(host.id, cfToken);
    }
    await _store.upsertWorkspace(ws);
    await _store.setActiveWorkspace(ws.id);
    debugPrint('[AddHostFlow] single workspace activated id=${ws.id}');
    return ws;
  }
}
