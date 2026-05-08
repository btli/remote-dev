import 'package:remote_dev/domain/events/terminal_event.dart';
import 'package:remote_dev/domain/value_objects/connection_status.dart';

/// Parameters needed to establish a terminal WebSocket connection.
class TerminalConnectionParams {
  final String wsUrl;
  final String token;
  final String sessionId;
  final String tmuxSessionName;
  final int cols;
  final int rows;
  final String terminalType;
  final String? cfToken;

  const TerminalConnectionParams({
    required this.wsUrl,
    required this.token,
    required this.sessionId,
    required this.tmuxSessionName,
    this.cols = 80,
    this.rows = 24,
    this.terminalType = 'shell',
    this.cfToken,
  });

  TerminalConnectionParams copyWith({
    String? wsUrl,
    String? token,
    String? sessionId,
    String? tmuxSessionName,
    int? cols,
    int? rows,
    String? terminalType,
    String? cfToken,
  }) {
    return TerminalConnectionParams(
      wsUrl: wsUrl ?? this.wsUrl,
      token: token ?? this.token,
      sessionId: sessionId ?? this.sessionId,
      tmuxSessionName: tmuxSessionName ?? this.tmuxSessionName,
      cols: cols ?? this.cols,
      rows: rows ?? this.rows,
      terminalType: terminalType ?? this.terminalType,
      cfToken: cfToken ?? this.cfToken,
    );
  }
}

/// Abstract gateway for terminal WebSocket communication.
/// Implemented by [TerminalWebSocketManager] in the infrastructure layer.
abstract interface class TerminalGateway {
  /// Stream of domain-level terminal events.
  Stream<TerminalEvent> get events;

  /// Stream of connection status changes.
  Stream<ConnectionStatus> get connectionStatus;

  /// Current connection status.
  ConnectionStatus get currentStatus;

  /// Connect to the terminal server.
  Future<void> connect(TerminalConnectionParams params);

  /// Force an immediate reconnection attempt (e.g., on network change).
  Future<void> forceReconnect();

  /// Send terminal input data.
  void sendInput(String data);

  /// Notify server of terminal resize.
  void sendResize(int cols, int rows);

  /// Detach from the tmux session (session stays alive).
  void sendDetach();

  /// Request agent restart (agent sessions only).
  void sendRestartAgent();

  /// Close the connection and release resources.
  void dispose();
}
