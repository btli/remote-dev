// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'auth_cookie.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

_$AuthCookieImpl _$$AuthCookieImplFromJson(Map<String, dynamic> json) =>
    _$AuthCookieImpl(
      name: json['name'] as String,
      value: json['value'] as String,
      path: json['path'] as String,
    );

Map<String, dynamic> _$$AuthCookieImplToJson(_$AuthCookieImpl instance) =>
    <String, dynamic>{
      'name': instance.name,
      'value': instance.value,
      'path': instance.path,
    };
