// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'channel.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

_$ChannelImpl _$$ChannelImplFromJson(Map<String, dynamic> json) =>
    _$ChannelImpl(
      id: json['id'] as String,
      name: json['name'] as String,
      unreadCount: (json['unreadCount'] as num?)?.toInt() ?? 0,
      projectId: json['projectId'] as String?,
    );

Map<String, dynamic> _$$ChannelImplToJson(_$ChannelImpl instance) =>
    <String, dynamic>{
      'id': instance.id,
      'name': instance.name,
      'unreadCount': instance.unreadCount,
      'projectId': instance.projectId,
    };
