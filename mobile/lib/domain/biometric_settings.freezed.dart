// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint
// ignore_for_file: unused_element, deprecated_member_use, deprecated_member_use_from_same_package, use_function_type_syntax_for_parameters, unnecessary_const, avoid_init_to_null, invalid_override_different_default_values_named, prefer_expression_function_bodies, annotate_overrides, invalid_annotation_target, unnecessary_question_mark

part of 'biometric_settings.dart';

// **************************************************************************
// FreezedGenerator
// **************************************************************************

T _$identity<T>(T value) => value;

final _privateConstructorUsedError = UnsupportedError(
    'It seems like you constructed your class using `MyClass._()`. This constructor is only meant to be used by freezed and you are not supposed to need it nor use it.\nPlease check the documentation here for more information: https://github.com/rrousselGit/freezed#adding-getters-and-methods-to-our-models');

BiometricSettings _$BiometricSettingsFromJson(Map<String, dynamic> json) {
  return _BiometricSettings.fromJson(json);
}

/// @nodoc
mixin _$BiometricSettings {
  bool get enabled => throw _privateConstructorUsedError;
  int get gracePeriodSeconds => throw _privateConstructorUsedError;
  bool get requireOnColdStart => throw _privateConstructorUsedError;

  /// Serializes this BiometricSettings to a JSON map.
  Map<String, dynamic> toJson() => throw _privateConstructorUsedError;

  /// Create a copy of BiometricSettings
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  $BiometricSettingsCopyWith<BiometricSettings> get copyWith =>
      throw _privateConstructorUsedError;
}

/// @nodoc
abstract class $BiometricSettingsCopyWith<$Res> {
  factory $BiometricSettingsCopyWith(
          BiometricSettings value, $Res Function(BiometricSettings) then) =
      _$BiometricSettingsCopyWithImpl<$Res, BiometricSettings>;
  @useResult
  $Res call({bool enabled, int gracePeriodSeconds, bool requireOnColdStart});
}

/// @nodoc
class _$BiometricSettingsCopyWithImpl<$Res, $Val extends BiometricSettings>
    implements $BiometricSettingsCopyWith<$Res> {
  _$BiometricSettingsCopyWithImpl(this._value, this._then);

  // ignore: unused_field
  final $Val _value;
  // ignore: unused_field
  final $Res Function($Val) _then;

  /// Create a copy of BiometricSettings
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? enabled = null,
    Object? gracePeriodSeconds = null,
    Object? requireOnColdStart = null,
  }) {
    return _then(_value.copyWith(
      enabled: null == enabled
          ? _value.enabled
          : enabled // ignore: cast_nullable_to_non_nullable
              as bool,
      gracePeriodSeconds: null == gracePeriodSeconds
          ? _value.gracePeriodSeconds
          : gracePeriodSeconds // ignore: cast_nullable_to_non_nullable
              as int,
      requireOnColdStart: null == requireOnColdStart
          ? _value.requireOnColdStart
          : requireOnColdStart // ignore: cast_nullable_to_non_nullable
              as bool,
    ) as $Val);
  }
}

/// @nodoc
abstract class _$$BiometricSettingsImplCopyWith<$Res>
    implements $BiometricSettingsCopyWith<$Res> {
  factory _$$BiometricSettingsImplCopyWith(_$BiometricSettingsImpl value,
          $Res Function(_$BiometricSettingsImpl) then) =
      __$$BiometricSettingsImplCopyWithImpl<$Res>;
  @override
  @useResult
  $Res call({bool enabled, int gracePeriodSeconds, bool requireOnColdStart});
}

/// @nodoc
class __$$BiometricSettingsImplCopyWithImpl<$Res>
    extends _$BiometricSettingsCopyWithImpl<$Res, _$BiometricSettingsImpl>
    implements _$$BiometricSettingsImplCopyWith<$Res> {
  __$$BiometricSettingsImplCopyWithImpl(_$BiometricSettingsImpl _value,
      $Res Function(_$BiometricSettingsImpl) _then)
      : super(_value, _then);

  /// Create a copy of BiometricSettings
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? enabled = null,
    Object? gracePeriodSeconds = null,
    Object? requireOnColdStart = null,
  }) {
    return _then(_$BiometricSettingsImpl(
      enabled: null == enabled
          ? _value.enabled
          : enabled // ignore: cast_nullable_to_non_nullable
              as bool,
      gracePeriodSeconds: null == gracePeriodSeconds
          ? _value.gracePeriodSeconds
          : gracePeriodSeconds // ignore: cast_nullable_to_non_nullable
              as int,
      requireOnColdStart: null == requireOnColdStart
          ? _value.requireOnColdStart
          : requireOnColdStart // ignore: cast_nullable_to_non_nullable
              as bool,
    ));
  }
}

/// @nodoc
@JsonSerializable()
class _$BiometricSettingsImpl implements _BiometricSettings {
  const _$BiometricSettingsImpl(
      {this.enabled = false,
      this.gracePeriodSeconds = 60,
      this.requireOnColdStart = true});

  factory _$BiometricSettingsImpl.fromJson(Map<String, dynamic> json) =>
      _$$BiometricSettingsImplFromJson(json);

  @override
  @JsonKey()
  final bool enabled;
  @override
  @JsonKey()
  final int gracePeriodSeconds;
  @override
  @JsonKey()
  final bool requireOnColdStart;

  @override
  String toString() {
    return 'BiometricSettings(enabled: $enabled, gracePeriodSeconds: $gracePeriodSeconds, requireOnColdStart: $requireOnColdStart)';
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _$BiometricSettingsImpl &&
            (identical(other.enabled, enabled) || other.enabled == enabled) &&
            (identical(other.gracePeriodSeconds, gracePeriodSeconds) ||
                other.gracePeriodSeconds == gracePeriodSeconds) &&
            (identical(other.requireOnColdStart, requireOnColdStart) ||
                other.requireOnColdStart == requireOnColdStart));
  }

  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  int get hashCode =>
      Object.hash(runtimeType, enabled, gracePeriodSeconds, requireOnColdStart);

  /// Create a copy of BiometricSettings
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  @pragma('vm:prefer-inline')
  _$$BiometricSettingsImplCopyWith<_$BiometricSettingsImpl> get copyWith =>
      __$$BiometricSettingsImplCopyWithImpl<_$BiometricSettingsImpl>(
          this, _$identity);

  @override
  Map<String, dynamic> toJson() {
    return _$$BiometricSettingsImplToJson(
      this,
    );
  }
}

abstract class _BiometricSettings implements BiometricSettings {
  const factory _BiometricSettings(
      {final bool enabled,
      final int gracePeriodSeconds,
      final bool requireOnColdStart}) = _$BiometricSettingsImpl;

  factory _BiometricSettings.fromJson(Map<String, dynamic> json) =
      _$BiometricSettingsImpl.fromJson;

  @override
  bool get enabled;
  @override
  int get gracePeriodSeconds;
  @override
  bool get requireOnColdStart;

  /// Create a copy of BiometricSettings
  /// with the given fields replaced by the non-null parameter values.
  @override
  @JsonKey(includeFromJson: false, includeToJson: false)
  _$$BiometricSettingsImplCopyWith<_$BiometricSettingsImpl> get copyWith =>
      throw _privateConstructorUsedError;
}
