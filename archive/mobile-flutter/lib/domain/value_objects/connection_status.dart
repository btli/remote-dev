/// WebSocket terminal connection state machine.
enum ConnectionStatus {
  /// Not connected, no reconnection in progress.
  disconnected,

  /// Establishing initial connection.
  connecting,

  /// Connected and receiving terminal output.
  connected,

  /// Connection lost, attempting to reconnect with backoff.
  reconnecting,

  /// All reconnection attempts exhausted.
  failed,
}
