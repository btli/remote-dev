abstract class NotificationsPort {
  /// Mark notifications as read. No-op when [ids] is empty.
  Future<void> markRead(List<String> ids);
}
