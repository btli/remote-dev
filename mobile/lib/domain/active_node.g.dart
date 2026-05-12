// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'active_node.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

_$ActiveNodeImpl _$$ActiveNodeImplFromJson(Map<String, dynamic> json) =>
    _$ActiveNodeImpl(
      id: json['id'] as String,
      type: $enumDecode(_$ActiveNodeTypeEnumMap, json['type']),
      name: json['name'] as String?,
    );

Map<String, dynamic> _$$ActiveNodeImplToJson(_$ActiveNodeImpl instance) =>
    <String, dynamic>{
      'id': instance.id,
      'type': _$ActiveNodeTypeEnumMap[instance.type]!,
      'name': instance.name,
    };

const _$ActiveNodeTypeEnumMap = {
  ActiveNodeType.group: 'group',
  ActiveNodeType.project: 'project',
};
