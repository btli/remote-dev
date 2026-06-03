import 'dart:async';
import 'dart:io';

import 'package:flutter/foundation.dart';

import '../../application/ports/api_client_port.dart';
import '../../application/ports/host_workspace_store.dart';
import '../../application/ports/push_port.dart';
import '../../domain/host_config.dart';
import '../../domain/workspace_config.dart';
import '../auth/mobile_credentials.dart';

/// Registers the FCM token with every saved WORKSPACE. Subscribes to
/// onTokenRefresh and re-registers across all workspaces on each event.
///
/// Spec §5: the deprecated app only re-registered with the *active* server, so
/// users with multiple servers stopped receiving notifications from non-active
/// servers after a token rotation. This class is the explicit fix.
///
/// Multi-workspace migration (Task D3): the registrar now iterates the
/// Host/Workspace store rather than the legacy per-server store. For each
/// workspace it builds a [RemoteDevClient.forWorkspace] (origin + basePath +
/// per-workspace API key + host-wide CF cookie) and POSTs the token to
/// `/api/notifications/push-token`. Workspaces with no stored API key are
/// skipped (they were never signed into).
///
/// Background-POST constraint: the workspace clients are constructed with NO
/// interactive refresh, so a token POST against a workspace with a stale CF
/// cookie fails-and-logs rather than popping a system browser (no UI is mounted
/// to drive it). [clientFactory] is expected to wire only a non-interactive
/// (no-op) refresh.
class PushTokenRegistrar {
  PushTokenRegistrar({
    required this.push,
    required this.store,
    required this.credentials,
    required this.clientFactory,
    required this.deviceId,
  });

  final PushPort push;

  /// Source of truth for hosts + workspaces. Replaces the legacy per-server
  /// store the registrar used pre-migration.
  final HostWorkspaceStore store;

  /// Reads the per-workspace API key (to decide whether a workspace was ever
  /// signed into) before building a client for it.
  final MobileCredentialsStore credentials;

  /// Builds an [ApiClientPort] for a (host, workspace) pair. Production wires
  /// [RemoteDevClient.forWorkspace]; tests substitute a fake. MUST NOT carry an
  /// interactive refresh — see the class doc.
  final ApiClientPort Function(HostConfig host, WorkspaceConfig workspace)
      clientFactory;

  final String deviceId;

  StreamSubscription<String>? _refreshSub;

  /// Initialize push, register the current token with every workspace, and
  /// subscribe to refresh. Returns true on success.
  Future<bool> start() async {
    final ok = await push.initialize();
    if (!ok) {
      debugPrint('[Push] registrar.start: init failed; skipping registration');
      return false;
    }
    final token = await push.getToken();
    if (token != null) {
      await registerWithAll(token);
    }
    _refreshSub = push.onTokenRefresh.listen(registerWithAll);
    return true;
  }

  /// POST the token to every saved workspace that has a stored API key.
  /// Per-workspace failures (and unresolvable hosts) don't block the others.
  Future<void> registerWithAll(String token) async {
    final workspaces = await store.loadWorkspaces();
    final platform = Platform.isIOS ? 'ios' : 'android';
    for (final ws in workspaces) {
      try {
        // Never signed into this workspace → nothing to register against.
        final apiKey = await credentials.getWorkspaceApiKey(ws.id);
        if (apiKey == null || apiKey.isEmpty) continue;

        final host = await store.loadHost(ws.hostId);
        if (host == null) continue;

        final client = clientFactory(host, ws);
        await client.post(
          '/api/notifications/push-token',
          body: {
            'token': token,
            'platform': platform,
            'deviceId': deviceId,
          },
        );
      } catch (e) {
        debugPrint('[Push] register on workspace ${ws.id} failed: $e');
      }
    }
  }

  /// DELETE the token from a single workspace (used on sign-out /
  /// delete-workspace). Best-effort: a missing workspace, missing API key, or
  /// network failure is swallowed (logged) so the caller's delete/sign-out is
  /// never blocked.
  Future<void> unregisterWorkspace(String workspaceId) async {
    final token = await push.getToken();
    if (token == null) return;

    // Resolve the workspace + its host so we can build a base-path-aware,
    // authenticated client. If either is already gone (e.g. the row was cleared
    // before us) there is nothing to unregister.
    final workspaces = await store.loadWorkspaces();
    WorkspaceConfig? target;
    for (final ws in workspaces) {
      if (ws.id == workspaceId) {
        target = ws;
        break;
      }
    }
    if (target == null) return;

    final apiKey = await credentials.getWorkspaceApiKey(target.id);
    if (apiKey == null || apiKey.isEmpty) return;

    final host = await store.loadHost(target.hostId);
    if (host == null) return;

    try {
      final client = clientFactory(host, target);
      await client.delete(
        '/api/notifications/push-token',
        body: {'token': token},
      );
    } catch (e) {
      debugPrint('[Push] unregister on workspace $workspaceId failed: $e');
    }
  }

  Future<void> stop() async {
    await _refreshSub?.cancel();
    _refreshSub = null;
  }
}
