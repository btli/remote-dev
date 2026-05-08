/// Domain-level terminal events.
///
/// These are the events the application layer cares about, decoupled
/// from the WebSocket wire format in the infrastructure layer.
sealed class TerminalEvent {
  const TerminalEvent();
}

/// Terminal output data to be written to the emulator.
final class TerminalOutput extends TerminalEvent {
  const TerminalOutput(this.data);
  final String data;
}

/// Terminal session was created or reattached.
final class TerminalReady extends TerminalEvent {
  const TerminalReady({required this.sessionId});
  final String sessionId;
}

/// Agent process exited.
final class AgentExited extends TerminalEvent {
  const AgentExited({
    required this.sessionId,
    this.exitCode,
    required this.exitedAt,
  });
  final String sessionId;
  final int? exitCode;
  final String exitedAt;
}

/// Agent activity status changed.
final class AgentStatusChanged extends TerminalEvent {
  const AgentStatusChanged({
    required this.sessionId,
    required this.status,
  });
  final String sessionId;
  final String status;
}

/// Notification received.
final class NotificationReceived extends TerminalEvent {
  const NotificationReceived(this.data);
  final Map<String, dynamic> data;
}

/// Notifications were dismissed/read on another client.
final class NotificationDismissed extends TerminalEvent {
  const NotificationDismissed({required this.ids, required this.all});
  final List<String> ids;
  final bool all;
}

/// Terminal session ended.
final class TerminalExited extends TerminalEvent {
  const TerminalExited(this.code);
  final int? code;
}

/// Server reported an error.
final class TerminalError extends TerminalEvent {
  const TerminalError(this.message);
  final String message;
}
