// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'session_summary.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

_$SessionSummaryImpl _$$SessionSummaryImplFromJson(Map<String, dynamic> json) =>
    _$SessionSummaryImpl(
      id: json['id'] as String,
      name: json['name'] as String,
      tmuxSessionName: json['tmuxSessionName'] as String,
      status: $enumDecode(_$SessionStatusEnumMap, json['status']),
      projectId: json['projectId'] as String?,
      activity: $enumDecodeNullable(
              _$AgentActivityStatusEnumMap, json['agentActivityStatus'],
              unknownValue: AgentActivityStatus.none) ??
          AgentActivityStatus.none,
    );

Map<String, dynamic> _$$SessionSummaryImplToJson(
        _$SessionSummaryImpl instance) =>
    <String, dynamic>{
      'id': instance.id,
      'name': instance.name,
      'tmuxSessionName': instance.tmuxSessionName,
      'status': _$SessionStatusEnumMap[instance.status]!,
      'projectId': instance.projectId,
      'agentActivityStatus': _$AgentActivityStatusEnumMap[instance.activity]!,
    };

const _$SessionStatusEnumMap = {
  SessionStatus.active: 'active',
  SessionStatus.suspended: 'suspended',
  SessionStatus.closed: 'closed',
};

const _$AgentActivityStatusEnumMap = {
  AgentActivityStatus.running: 'running',
  AgentActivityStatus.waiting: 'waiting',
  AgentActivityStatus.idle: 'idle',
  AgentActivityStatus.error: 'error',
  AgentActivityStatus.none: 'none',
};
