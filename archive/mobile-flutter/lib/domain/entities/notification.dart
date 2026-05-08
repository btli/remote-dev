/// Notification event from the terminal server.
class NotificationEvent {
  final String id;
  final String userId;
  final String? sessionId;
  final String? sessionName;
  final String type;
  final String title;
  final String? body;
  final DateTime? readAt;
  final DateTime createdAt;

  const NotificationEvent({
    required this.id,
    required this.userId,
    this.sessionId,
    this.sessionName,
    required this.type,
    required this.title,
    this.body,
    this.readAt,
    required this.createdAt,
  });

  bool get isRead => readAt != null;

  NotificationEvent markRead() => NotificationEvent(
        id: id,
        userId: userId,
        sessionId: sessionId,
        sessionName: sessionName,
        type: type,
        title: title,
        body: body,
        readAt: DateTime.now(),
        createdAt: createdAt,
      );
}
