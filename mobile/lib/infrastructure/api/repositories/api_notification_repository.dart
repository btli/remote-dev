import 'package:remote_dev/domain/entities/notification.dart';
import 'package:remote_dev/domain/errors/app_error.dart';
import 'package:remote_dev/domain/repositories/notification_repository.dart';
import 'package:remote_dev/infrastructure/api/remote_dev_client.dart';

/// API-backed implementation of [NotificationRepository].
class ApiNotificationRepository implements NotificationRepository {
  ApiNotificationRepository({required RemoteDevClient client})
      : _client = client;
  final RemoteDevClient _client;

  @override
  Future<Result<List<NotificationEvent>>> findAll({int limit = 50}) async {
    try {
      final data = await _client.listNotifications(limit: limit);
      final items = data['notifications'] as List? ??
          data['items'] as List? ??
          [];
      return Success(
        items
            .cast<Map<String, dynamic>>()
            .map(_mapNotification)
            .toList(),
      );
    } on AppError catch (e) {
      return Failure(e);
    } on Object catch (e) {
      return Failure(
        ApiError(
          'Failed to parse notifications: $e',
          code: 'PARSE_ERROR',
          statusCode: 0,
        ),
      );
    }
  }

  @override
  Future<Result<void>> markRead(List<String> ids) async {
    try {
      await _client.markNotificationsRead(ids);
      return const Success(null);
    } on AppError catch (e) {
      return Failure(e);
    }
  }

  @override
  Future<Result<void>> markAllRead() async {
    try {
      await _client.markAllNotificationsRead();
      return const Success(null);
    } on AppError catch (e) {
      return Failure(e);
    }
  }

  @override
  Future<Result<void>> delete(List<String> ids) async {
    try {
      await _client.deleteNotifications(ids);
      return const Success(null);
    } on AppError catch (e) {
      return Failure(e);
    }
  }

  NotificationEvent _mapNotification(Map<String, dynamic> json) {
    return NotificationEvent(
      id: json['id'] as String,
      userId: json['userId'] as String,
      sessionId: json['sessionId'] as String?,
      sessionName: json['sessionName'] as String?,
      type: json['type'] as String? ?? 'info',
      title: json['title'] as String? ?? '',
      body: json['body'] as String?,
      readAt: json['readAt'] != null
          ? DateTime.tryParse(json['readAt'] as String)
          : null,
      createdAt: DateTime.tryParse(json['createdAt'] as String? ?? '') ??
          DateTime.now(),
    );
  }
}
