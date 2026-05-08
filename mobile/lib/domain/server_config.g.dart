// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'server_config.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

_$ServerConfigImpl _$$ServerConfigImplFromJson(Map<String, dynamic> json) =>
    _$ServerConfigImpl(
      id: json['id'] as String,
      label: json['label'] as String,
      url: json['url'] as String,
      lastUsedAt: DateTime.parse(json['lastUsedAt'] as String),
    );

Map<String, dynamic> _$$ServerConfigImplToJson(_$ServerConfigImpl instance) =>
    <String, dynamic>{
      'id': instance.id,
      'label': instance.label,
      'url': instance.url,
      'lastUsedAt': instance.lastUsedAt.toIso8601String(),
    };
