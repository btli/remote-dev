import 'dart:async';
import 'dart:io';

import 'package:flutter/foundation.dart';

import '../../application/ports/api_client_port.dart';
import '../../application/ports/push_port.dart';
import '../../application/ports/server_config_store.dart';
import '../../domain/server_config.dart';

/// Registers the FCM token with every saved server. Subscribes to
/// onTokenRefresh and re-registers across all servers on each event.
///
/// Spec §5: the deprecated app only re-registered with the *active*
/// server, so users with multiple servers stopped receiving
/// notifications from non-active servers after a token rotation. This
/// class is the explicit fix.
class PushTokenRegistrar {
  PushTokenRegistrar({
    required this.push,
    required this.serverStore,
    required this.clientFactory,
    required this.deviceId,
  });

  final PushPort push;
  final ServerConfigStore serverStore;
  final ApiClientPort Function(ServerConfig server) clientFactory;
  final String deviceId;

  StreamSubscription<String>? _refreshSub;

  /// Initialize push, register the current token with every server, and
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

  /// POST the token to every saved server. Per-server failures don't
  /// block the others.
  Future<void> registerWithAll(String token) async {
    final servers = await serverStore.loadAll();
    final platform = Platform.isIOS ? 'ios' : 'android';
    for (final server in servers) {
      try {
        final client = clientFactory(server);
        await client.post(
          '/api/push-tokens',
          body: {
            'token': token,
            'platform': platform,
            'deviceId': deviceId,
          },
        );
      } catch (e) {
        debugPrint('[Push] register on ${server.label} failed: $e');
      }
    }
  }

  /// DELETE the token from a specific server (used on sign-out /
  /// delete-server in P3.7).
  Future<void> unregisterFromServer(String serverId) async {
    final token = await push.getToken();
    if (token == null) return;
    final servers = await serverStore.loadAll();
    ServerConfig? target;
    for (final s in servers) {
      if (s.id == serverId) {
        target = s;
        break;
      }
    }
    if (target == null) return;
    try {
      final client = clientFactory(target);
      await client.delete('/api/push-tokens/$token');
    } catch (e) {
      debugPrint('[Push] unregister on ${target.label} failed: $e');
    }
  }

  Future<void> stop() async {
    await _refreshSub?.cancel();
    _refreshSub = null;
  }
}
