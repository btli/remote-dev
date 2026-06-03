// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'host_config.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

_$HostConfigImpl _$$HostConfigImplFromJson(Map<String, dynamic> json) =>
    _$HostConfigImpl(
      id: json['id'] as String,
      label: json['label'] as String,
      origin: json['origin'] as String,
      kind: $enumDecode(_$HostKindEnumMap, json['kind']),
      createdAt: DateTime.parse(json['createdAt'] as String),
      lastUsedAt: DateTime.parse(json['lastUsedAt'] as String),
    );

Map<String, dynamic> _$$HostConfigImplToJson(_$HostConfigImpl instance) =>
    <String, dynamic>{
      'id': instance.id,
      'label': instance.label,
      'origin': instance.origin,
      'kind': _$HostKindEnumMap[instance.kind]!,
      'createdAt': instance.createdAt.toIso8601String(),
      'lastUsedAt': instance.lastUsedAt.toIso8601String(),
    };

const _$HostKindEnumMap = {
  HostKind.singleWorkspace: 'singleWorkspace',
  HostKind.multiWorkspace: 'multiWorkspace',
};
