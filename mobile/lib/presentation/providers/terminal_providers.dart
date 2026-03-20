import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:remote_dev/infrastructure/websocket/terminal_websocket_manager.dart';
import 'package:remote_dev/presentation/providers/server_config_providers.dart';

/// Per-session WebSocket manager. Auto-disposed when the session screen
/// is no longer in the widget tree.
final terminalManagerProvider =
    Provider.autoDispose.family<TerminalWebSocketManager?, String>(
  (ref, sessionId) {
    final client = ref.watch(remoteDevClientProvider);
    if (client == null) return null;

    final manager = TerminalWebSocketManager(
      tokenFactory: () async {
        final tokenData = await client.getSessionToken(sessionId);
        return tokenData['token'] as String;
      },
    );

    ref.onDispose(() => manager.dispose());

    return manager;
  },
);
