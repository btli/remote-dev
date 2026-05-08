import 'dart:convert';

/// Messages sent from the client to the terminal server.
sealed class WsClientMessage {
  const WsClientMessage();

  String toJson();
}

final class WsInput extends WsClientMessage {
  const WsInput(this.data);
  final String data;

  @override
  String toJson() => jsonEncode({'type': 'input', 'data': data});
}

final class WsResize extends WsClientMessage {
  const WsResize(this.cols, this.rows);
  final int cols;
  final int rows;

  @override
  String toJson() =>
      jsonEncode({'type': 'resize', 'cols': cols, 'rows': rows});
}

final class WsDetach extends WsClientMessage {
  const WsDetach();

  @override
  String toJson() => jsonEncode({'type': 'detach'});
}

final class WsRestartAgent extends WsClientMessage {
  const WsRestartAgent();

  @override
  String toJson() => jsonEncode({'type': 'restart_agent'});
}

/// Messages received from the terminal server.
sealed class WsServerMessage {
  const WsServerMessage();

  /// Parse a JSON message from the server into a typed message.
  factory WsServerMessage.fromJson(String raw) {
    final Map<String, dynamic> json = jsonDecode(raw);
    final type = json['type'] as String?;

    return switch (type) {
      'output' => WsOutput(json['data'] as String? ?? ''),
      'ready' => WsReady(
          sessionId: json['sessionId'] as String? ?? '',
          tmuxSessionName: json['tmuxSessionName'] as String? ?? '',
        ),
      'session_created' => WsSessionCreated(
          sessionId: json['sessionId'] as String? ?? '',
          tmuxSessionName: json['tmuxSessionName'] as String? ?? '',
        ),
      'session_attached' => WsSessionAttached(
          sessionId: json['sessionId'] as String? ?? '',
          tmuxSessionName: json['tmuxSessionName'] as String? ?? '',
        ),
      'agent_exited' => WsAgentExited(
          sessionId: json['sessionId'] as String? ?? '',
          exitCode: json['exitCode'] as int?,
          exitedAt: json['exitedAt'] as String? ?? '',
        ),
      'agent_restarted' => WsAgentRestarted(
          sessionId: json['sessionId'] as String? ?? '',
        ),
      'agent_activity_status' => WsAgentActivityStatus(
          sessionId: json['sessionId'] as String? ?? '',
          status: json['status'] as String? ?? '',
        ),
      'notification' => WsNotification(
          json['notification'] as Map<String, dynamic>? ?? {},
        ),
      'notification_dismissed' => WsNotificationDismissed(
          ids: (json['ids'] as List?)?.cast<String>() ?? [],
          all: json['all'] as bool? ?? false,
        ),
      'exit' => WsExit(json['code'] as int?),
      'error' => WsError(json['message'] as String? ?? 'Unknown error'),
      _ => WsUnknown(type ?? 'null', json),
    };
  }
}

/// Terminal output data.
final class WsOutput extends WsServerMessage {
  const WsOutput(this.data);
  final String data;
}

/// Connection ready confirmation from server.
final class WsReady extends WsServerMessage {
  const WsReady({
    required this.sessionId,
    required this.tmuxSessionName,
  });
  final String sessionId;
  final String tmuxSessionName;
}

/// New tmux session was created.
final class WsSessionCreated extends WsServerMessage {
  const WsSessionCreated({
    required this.sessionId,
    required this.tmuxSessionName,
  });
  final String sessionId;
  final String tmuxSessionName;
}

/// Reattached to existing tmux session.
final class WsSessionAttached extends WsServerMessage {
  const WsSessionAttached({
    required this.sessionId,
    required this.tmuxSessionName,
  });
  final String sessionId;
  final String tmuxSessionName;
}

/// Agent process exited.
final class WsAgentExited extends WsServerMessage {
  const WsAgentExited({
    required this.sessionId,
    this.exitCode,
    required this.exitedAt,
  });
  final String sessionId;
  final int? exitCode;
  final String exitedAt;
}

/// Agent process was restarted.
final class WsAgentRestarted extends WsServerMessage {
  const WsAgentRestarted({required this.sessionId});
  final String sessionId;
}

/// Agent activity status update (broadcast to all clients).
final class WsAgentActivityStatus extends WsServerMessage {
  const WsAgentActivityStatus({
    required this.sessionId,
    required this.status,
  });
  final String sessionId;
  final String status;
}

/// Notification event.
final class WsNotification extends WsServerMessage {
  const WsNotification(this.data);
  final Map<String, dynamic> data;
}

/// Notifications were dismissed/read on another client.
final class WsNotificationDismissed extends WsServerMessage {
  const WsNotificationDismissed({required this.ids, required this.all});
  final List<String> ids;
  final bool all;
}

/// Terminal session ended.
final class WsExit extends WsServerMessage {
  const WsExit(this.code);
  final int? code;
}

/// Server error message.
final class WsError extends WsServerMessage {
  const WsError(this.message);
  final String message;
}

/// Unknown/unhandled message type.
final class WsUnknown extends WsServerMessage {
  const WsUnknown(this.type, this.raw);
  final String type;
  final Map<String, dynamic> raw;
}
