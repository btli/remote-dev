import 'package:remote_dev/domain/entities/notification.dart';
import 'package:remote_dev/domain/errors/app_error.dart';

/// Abstract repository interface for notification operations.
abstract interface class NotificationRepository {
  Future<Result<List<NotificationEvent>>> findAll({int limit = 50});
  Future<Result<void>> markRead(List<String> ids);
  Future<Result<void>> markAllRead();
  Future<Result<void>> delete(List<String> ids);
}
