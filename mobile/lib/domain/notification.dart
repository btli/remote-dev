import 'package:freezed_annotation/freezed_annotation.dart';

part 'notification.freezed.dart';
part 'notification.g.dart';

@freezed
class AppNotification with _$AppNotification {
  const factory AppNotification({
    required String id,
    required String title,
    required String body,
    required DateTime createdAt,
    @Default(false) bool read,
    String? sessionId,
    String? channelId,
    @Default('default') String kind,
    // Server-side notification type (e.g. `agent_waiting`, `agent_error`,
    // `agent_complete`, `agent_exited`, `info`, …). Sourced from the
    // `type` field on `notification_event` records. Nullable for
    // forward-compat with payloads that omit it.
    String? type,
  }) = _AppNotification;

  factory AppNotification.fromJson(Map<String, dynamic> json) =>
      _$AppNotificationFromJson(json);
}
