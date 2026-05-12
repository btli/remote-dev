import '../../domain/notification.dart';

abstract class NotificationsPort {
  /// Mark notifications as read. No-op when [ids] is empty.
  Future<void> markRead(List<String> ids);

  /// List notifications, optionally filtered (`'all'`, `'unread'`,
  /// `'mentions'`).
  Future<List<AppNotification>> list({String? filter});

  /// Dismiss (delete) a single notification.
  Future<void> dismiss(String id);

  /// Dismiss (delete) every notification for the current user.
  Future<void> dismissAll();

  /// Mark all notifications read.
  Future<void> markAllRead();
}
