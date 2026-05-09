// ignore_for_file: invalid_annotation_target

import 'package:freezed_annotation/freezed_annotation.dart';

part 'session_summary.freezed.dart';
part 'session_summary.g.dart';

enum SessionStatus {
  @JsonValue('active')
  active,
  @JsonValue('suspended')
  suspended,
  @JsonValue('closed')
  closed,
}

enum AgentActivityStatus {
  @JsonValue('running')
  running,
  @JsonValue('waiting')
  waiting,
  @JsonValue('idle')
  idle,
  @JsonValue('error')
  error,
  none,
}

@freezed
class SessionSummary with _$SessionSummary {
  const factory SessionSummary({
    required String id,
    required String name,
    required String tmuxSessionName,
    required SessionStatus status,
    String? projectId,
    @JsonKey(name: 'agentActivityStatus', unknownEnumValue: AgentActivityStatus.none)
    @Default(AgentActivityStatus.none)
    AgentActivityStatus activity,
  }) = _SessionSummary;

  factory SessionSummary.fromJson(Map<String, dynamic> json) =>
      _$SessionSummaryFromJson(json);
}
