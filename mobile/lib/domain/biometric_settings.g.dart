// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'biometric_settings.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

_$BiometricSettingsImpl _$$BiometricSettingsImplFromJson(
        Map<String, dynamic> json) =>
    _$BiometricSettingsImpl(
      enabled: json['enabled'] as bool? ?? false,
      gracePeriodSeconds: (json['gracePeriodSeconds'] as num?)?.toInt() ?? 60,
      requireOnColdStart: json['requireOnColdStart'] as bool? ?? true,
    );

Map<String, dynamic> _$$BiometricSettingsImplToJson(
        _$BiometricSettingsImpl instance) =>
    <String, dynamic>{
      'enabled': instance.enabled,
      'gracePeriodSeconds': instance.gracePeriodSeconds,
      'requireOnColdStart': instance.requireOnColdStart,
    };
