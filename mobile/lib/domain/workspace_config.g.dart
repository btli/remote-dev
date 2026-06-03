// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'workspace_config.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

_$WorkspaceConfigImpl _$$WorkspaceConfigImplFromJson(
        Map<String, dynamic> json) =>
    _$WorkspaceConfigImpl(
      id: json['id'] as String,
      hostId: json['hostId'] as String,
      slug: json['slug'] as String,
      basePath: json['basePath'] as String,
      displayName: json['displayName'] as String,
      status: json['status'] as String?,
      lastUsedAt: DateTime.parse(json['lastUsedAt'] as String),
    );

Map<String, dynamic> _$$WorkspaceConfigImplToJson(
        _$WorkspaceConfigImpl instance) =>
    <String, dynamic>{
      'id': instance.id,
      'hostId': instance.hostId,
      'slug': instance.slug,
      'basePath': instance.basePath,
      'displayName': instance.displayName,
      'status': instance.status,
      'lastUsedAt': instance.lastUsedAt.toIso8601String(),
    };
