// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint
// ignore_for_file: unused_element, deprecated_member_use, deprecated_member_use_from_same_package, use_function_type_syntax_for_parameters, unnecessary_const, avoid_init_to_null, invalid_override_different_default_values_named, prefer_expression_function_bodies, annotate_overrides, invalid_annotation_target, unnecessary_question_mark

part of 'server_config.dart';

// **************************************************************************
// FreezedGenerator
// **************************************************************************

T _$identity<T>(T value) => value;

final _privateConstructorUsedError = UnsupportedError(
    'It seems like you constructed your class using `MyClass._()`. This constructor is only meant to be used by freezed and you are not supposed to need it nor use it.\nPlease check the documentation here for more information: https://github.com/rrousselGit/freezed#adding-getters-and-methods-to-our-models');

ServerConfig _$ServerConfigFromJson(Map<String, dynamic> json) {
  return _ServerConfig.fromJson(json);
}

/// @nodoc
mixin _$ServerConfig {
  String get id => throw _privateConstructorUsedError;
  String get label => throw _privateConstructorUsedError;
  String get url => throw _privateConstructorUsedError;
  DateTime get lastUsedAt => throw _privateConstructorUsedError;

  /// Serializes this ServerConfig to a JSON map.
  Map<String, dynamic> toJson() => throw _privateConstructorUsedError;

  /// Create a copy of ServerConfig
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  $ServerConfigCopyWith<ServerConfig> get copyWith =>
      throw _privateConstructorUsedError;
}

/// @nodoc
abstract class $ServerConfigCopyWith<$Res> {
  factory $ServerConfigCopyWith(
          ServerConfig value, $Res Function(ServerConfig) then) =
      _$ServerConfigCopyWithImpl<$Res, ServerConfig>;
  @useResult
  $Res call({String id, String label, String url, DateTime lastUsedAt});
}

/// @nodoc
class _$ServerConfigCopyWithImpl<$Res, $Val extends ServerConfig>
    implements $ServerConfigCopyWith<$Res> {
  _$ServerConfigCopyWithImpl(this._value, this._then);

  // ignore: unused_field
  final $Val _value;
  // ignore: unused_field
  final $Res Function($Val) _then;

  /// Create a copy of ServerConfig
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? id = null,
    Object? label = null,
    Object? url = null,
    Object? lastUsedAt = null,
  }) {
    return _then(_value.copyWith(
      id: null == id
          ? _value.id
          : id // ignore: cast_nullable_to_non_nullable
              as String,
      label: null == label
          ? _value.label
          : label // ignore: cast_nullable_to_non_nullable
              as String,
      url: null == url
          ? _value.url
          : url // ignore: cast_nullable_to_non_nullable
              as String,
      lastUsedAt: null == lastUsedAt
          ? _value.lastUsedAt
          : lastUsedAt // ignore: cast_nullable_to_non_nullable
              as DateTime,
    ) as $Val);
  }
}

/// @nodoc
abstract class _$$ServerConfigImplCopyWith<$Res>
    implements $ServerConfigCopyWith<$Res> {
  factory _$$ServerConfigImplCopyWith(
          _$ServerConfigImpl value, $Res Function(_$ServerConfigImpl) then) =
      __$$ServerConfigImplCopyWithImpl<$Res>;
  @override
  @useResult
  $Res call({String id, String label, String url, DateTime lastUsedAt});
}

/// @nodoc
class __$$ServerConfigImplCopyWithImpl<$Res>
    extends _$ServerConfigCopyWithImpl<$Res, _$ServerConfigImpl>
    implements _$$ServerConfigImplCopyWith<$Res> {
  __$$ServerConfigImplCopyWithImpl(
      _$ServerConfigImpl _value, $Res Function(_$ServerConfigImpl) _then)
      : super(_value, _then);

  /// Create a copy of ServerConfig
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? id = null,
    Object? label = null,
    Object? url = null,
    Object? lastUsedAt = null,
  }) {
    return _then(_$ServerConfigImpl(
      id: null == id
          ? _value.id
          : id // ignore: cast_nullable_to_non_nullable
              as String,
      label: null == label
          ? _value.label
          : label // ignore: cast_nullable_to_non_nullable
              as String,
      url: null == url
          ? _value.url
          : url // ignore: cast_nullable_to_non_nullable
              as String,
      lastUsedAt: null == lastUsedAt
          ? _value.lastUsedAt
          : lastUsedAt // ignore: cast_nullable_to_non_nullable
              as DateTime,
    ));
  }
}

/// @nodoc
@JsonSerializable()
class _$ServerConfigImpl implements _ServerConfig {
  const _$ServerConfigImpl(
      {required this.id,
      required this.label,
      required this.url,
      required this.lastUsedAt});

  factory _$ServerConfigImpl.fromJson(Map<String, dynamic> json) =>
      _$$ServerConfigImplFromJson(json);

  @override
  final String id;
  @override
  final String label;
  @override
  final String url;
  @override
  final DateTime lastUsedAt;

  @override
  String toString() {
    return 'ServerConfig(id: $id, label: $label, url: $url, lastUsedAt: $lastUsedAt)';
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _$ServerConfigImpl &&
            (identical(other.id, id) || other.id == id) &&
            (identical(other.label, label) || other.label == label) &&
            (identical(other.url, url) || other.url == url) &&
            (identical(other.lastUsedAt, lastUsedAt) ||
                other.lastUsedAt == lastUsedAt));
  }

  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  int get hashCode => Object.hash(runtimeType, id, label, url, lastUsedAt);

  /// Create a copy of ServerConfig
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  @pragma('vm:prefer-inline')
  _$$ServerConfigImplCopyWith<_$ServerConfigImpl> get copyWith =>
      __$$ServerConfigImplCopyWithImpl<_$ServerConfigImpl>(this, _$identity);

  @override
  Map<String, dynamic> toJson() {
    return _$$ServerConfigImplToJson(
      this,
    );
  }
}

abstract class _ServerConfig implements ServerConfig {
  const factory _ServerConfig(
      {required final String id,
      required final String label,
      required final String url,
      required final DateTime lastUsedAt}) = _$ServerConfigImpl;

  factory _ServerConfig.fromJson(Map<String, dynamic> json) =
      _$ServerConfigImpl.fromJson;

  @override
  String get id;
  @override
  String get label;
  @override
  String get url;
  @override
  DateTime get lastUsedAt;

  /// Create a copy of ServerConfig
  /// with the given fields replaced by the non-null parameter values.
  @override
  @JsonKey(includeFromJson: false, includeToJson: false)
  _$$ServerConfigImplCopyWith<_$ServerConfigImpl> get copyWith =>
      throw _privateConstructorUsedError;
}
