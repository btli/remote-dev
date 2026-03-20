import 'dart:async';
import 'dart:math';

import 'package:web_socket_channel/web_socket_channel.dart';

import 'package:remote_dev/application/ports/terminal_gateway.dart';
import 'package:remote_dev/domain/events/terminal_event.dart';
import 'package:remote_dev/domain/value_objects/connection_status.dart';
import 'package:remote_dev/infrastructure/websocket/ws_message.dart';

/// WebSocket manager for terminal connections.
///
/// Handles connection lifecycle, token refresh, and exponential backoff
/// reconnection. Each instance manages one terminal session.
class TerminalWebSocketManager implements TerminalGateway {
  TerminalWebSocketManager({
    required Future<String> Function() tokenFactory,
  }) : _tokenFactory = tokenFactory;

  final Future<String> Function() _tokenFactory;

  WebSocketChannel? _channel;
  TerminalConnectionParams? _params;
  StreamSubscription<dynamic>? _subscription;
  Timer? _reconnectTimer;
  int _reconnectAttempt = 0;

  static const _maxReconnectAttempts = 10;
  static const _maxBackoffSeconds = 30;

  final _messageController = StreamController<WsServerMessage>.broadcast();
  final _eventController = StreamController<TerminalEvent>.broadcast();
  final _statusController =
      StreamController<ConnectionStatus>.broadcast();
  ConnectionStatus _currentStatus = ConnectionStatus.disconnected;

  /// Raw WebSocket messages (infrastructure-internal, not exposed via port).
  Stream<WsServerMessage> get messages => _messageController.stream;

  @override
  Stream<TerminalEvent> get events => _eventController.stream;

  @override
  Stream<ConnectionStatus> get connectionStatus => _statusController.stream;

  @override
  ConnectionStatus get currentStatus => _currentStatus;

  void _setStatus(ConnectionStatus status) {
    _currentStatus = status;
    _statusController.add(status);
  }

  @override
  Future<void> connect(TerminalConnectionParams params) async {
    _params = params;
    _reconnectAttempt = 0;
    await _doConnect(params);
  }

  Future<void> _doConnect(TerminalConnectionParams params) async {
    _setStatus(ConnectionStatus.connecting);
    _cleanupChannel();

    try {
      final uri = Uri.parse(params.wsUrl).replace(
        queryParameters: {
          'token': params.token,
          'tmuxSession': params.tmuxSessionName,
          'cols': params.cols.toString(),
          'rows': params.rows.toString(),
          'terminalType': params.terminalType,
        },
      );

      _channel = WebSocketChannel.connect(uri);
      await _channel!.ready;

      _subscription = _channel!.stream.listen(
        _onMessage,
        onError: _onError,
        onDone: _onDone,
      );

      _setStatus(ConnectionStatus.connected);
      _reconnectAttempt = 0;
    } on Exception catch (e) {
      _setStatus(ConnectionStatus.disconnected);
      _messageController.addError(e);
      _scheduleReconnect();
    }
  }

  void _onMessage(dynamic data) {
    if (data is! String) return;
    try {
      final message = WsServerMessage.fromJson(data);
      _messageController.add(message);
      // Map to domain event for the port interface
      final event = _toDomainEvent(message);
      if (event != null) _eventController.add(event);
    } on FormatException {
      // Ignore malformed messages
    }
  }

  TerminalEvent? _toDomainEvent(WsServerMessage message) => switch (message) {
        WsOutput(:final data) => TerminalOutput(data),
        WsReady(:final sessionId) =>
          TerminalReady(sessionId: sessionId),
        WsSessionCreated(:final sessionId) =>
          TerminalReady(sessionId: sessionId),
        WsSessionAttached(:final sessionId) =>
          TerminalReady(sessionId: sessionId),
        WsAgentExited(:final sessionId, :final exitCode, :final exitedAt) =>
          AgentExited(
            sessionId: sessionId,
            exitCode: exitCode,
            exitedAt: exitedAt,
          ),
        WsAgentActivityStatus(:final sessionId, :final status) =>
          AgentStatusChanged(sessionId: sessionId, status: status),
        WsNotification(:final data) => NotificationReceived(data),
        WsExit(:final code) => TerminalExited(code),
        WsError(:final message) => TerminalError(message),
        WsAgentRestarted() => null,
        WsUnknown() => null,
      };

  void _onError(Object error) {
    _messageController.addError(error);
    _scheduleReconnect();
  }

  void _onDone() {
    // Capture close code before _cleanupChannel can null _channel
    final closeCode = _channel?.closeCode;
    _handleClose(closeCode);
  }

  void _handleClose(int? closeCode) {
    // Auth failures should not reconnect
    if (closeCode == 4001 || closeCode == 4002 || closeCode == 4003) {
      _setStatus(ConnectionStatus.failed);
      return;
    }
    _scheduleReconnect();
  }

  void _scheduleReconnect() {
    if (_params == null) return;
    if (_reconnectAttempt >= _maxReconnectAttempts) {
      _setStatus(ConnectionStatus.failed);
      return;
    }

    _setStatus(ConnectionStatus.reconnecting);
    final delay = min(
      pow(2, _reconnectAttempt).toInt(),
      _maxBackoffSeconds,
    );
    _reconnectAttempt++;

    _reconnectTimer?.cancel();
    _reconnectTimer = Timer(Duration(seconds: delay), _reconnect);
  }

  Future<void> _reconnect() async {
    if (_params == null) return;

    // Fetch a fresh token before reconnecting (tokens expire in 5 min)
    try {
      final freshToken = await _tokenFactory();
      final updatedParams = TerminalConnectionParams(
        wsUrl: _params!.wsUrl,
        token: freshToken,
        sessionId: _params!.sessionId,
        tmuxSessionName: _params!.tmuxSessionName,
        cols: _params!.cols,
        rows: _params!.rows,
        terminalType: _params!.terminalType,
      );
      await _doConnect(updatedParams);
    } on Exception {
      _scheduleReconnect();
    }
  }

  /// Force an immediate reconnection attempt (e.g., on network change).
  Future<void> forceReconnect() async {
    _reconnectAttempt = 0;
    _reconnectTimer?.cancel();
    await _reconnect();
  }

  @override
  void sendInput(String data) {
    _channel?.sink.add(WsInput(data).toJson());
  }

  @override
  void sendResize(int cols, int rows) {
    _channel?.sink.add(WsResize(cols, rows).toJson());
    // Update stored params so reconnect uses new dimensions
    if (_params != null) {
      _params = TerminalConnectionParams(
        wsUrl: _params!.wsUrl,
        token: _params!.token,
        sessionId: _params!.sessionId,
        tmuxSessionName: _params!.tmuxSessionName,
        cols: cols,
        rows: rows,
        terminalType: _params!.terminalType,
      );
    }
  }

  @override
  void sendDetach() {
    _channel?.sink.add(const WsDetach().toJson());
  }

  @override
  void sendRestartAgent() {
    _channel?.sink.add(const WsRestartAgent().toJson());
  }

  void _cleanupChannel() {
    _subscription?.cancel();
    _subscription = null;
    _channel?.sink.close();
    _channel = null;
  }

  @override
  void dispose() {
    _reconnectTimer?.cancel();
    _cleanupChannel();
    _messageController.close();
    _eventController.close();
    _statusController.close();
  }
}
