// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint
// ignore_for_file: unused_element, deprecated_member_use, deprecated_member_use_from_same_package, use_function_type_syntax_for_parameters, unnecessary_const, avoid_init_to_null, invalid_override_different_default_values_named, prefer_expression_function_bodies, annotate_overrides, invalid_annotation_target, unnecessary_question_mark

part of 'host_config.dart';

// **************************************************************************
// FreezedGenerator
// **************************************************************************

T _$identity<T>(T value) => value;

final _privateConstructorUsedError = UnsupportedError(
    'It seems like you constructed your class using `MyClass._()`. This constructor is only meant to be used by freezed and you are not supposed to need it nor use it.\nPlease check the documentation here for more information: https://github.com/rrousselGit/freezed#adding-getters-and-methods-to-our-models');

HostConfig _$HostConfigFromJson(Map<String, dynamic> json) {
  return _HostConfig.fromJson(json);
}

/// @nodoc
mixin _$HostConfig {
  String get id => throw _privateConstructorUsedError;
  String get label => throw _privateConstructorUsedError;

  /// `scheme://host[:port]` — NO trailing slash, NO path.
  /// Build with [normalizeOrigin] to guarantee that invariant.
  String get origin => throw _privateConstructorUsedError;
  HostKind get kind => throw _privateConstructorUsedError;
  DateTime get createdAt => throw _privateConstructorUsedError;
  DateTime get lastUsedAt => throw _privateConstructorUsedError;

  /// Serializes this HostConfig to a JSON map.
  Map<String, dynamic> toJson() => throw _privateConstructorUsedError;

  /// Create a copy of HostConfig
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  $HostConfigCopyWith<HostConfig> get copyWith =>
      throw _privateConstructorUsedError;
}

/// @nodoc
abstract class $HostConfigCopyWith<$Res> {
  factory $HostConfigCopyWith(
          HostConfig value, $Res Function(HostConfig) then) =
      _$HostConfigCopyWithImpl<$Res, HostConfig>;
  @useResult
  $Res call(
      {String id,
      String label,
      String origin,
      HostKind kind,
      DateTime createdAt,
      DateTime lastUsedAt});
}

/// @nodoc
class _$HostConfigCopyWithImpl<$Res, $Val extends HostConfig>
    implements $HostConfigCopyWith<$Res> {
  _$HostConfigCopyWithImpl(this._value, this._then);

  // ignore: unused_field
  final $Val _value;
  // ignore: unused_field
  final $Res Function($Val) _then;

  /// Create a copy of HostConfig
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? id = null,
    Object? label = null,
    Object? origin = null,
    Object? kind = null,
    Object? createdAt = null,
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
      origin: null == origin
          ? _value.origin
          : origin // ignore: cast_nullable_to_non_nullable
              as String,
      kind: null == kind
          ? _value.kind
          : kind // ignore: cast_nullable_to_non_nullable
              as HostKind,
      createdAt: null == createdAt
          ? _value.createdAt
          : createdAt // ignore: cast_nullable_to_non_nullable
              as DateTime,
      lastUsedAt: null == lastUsedAt
          ? _value.lastUsedAt
          : lastUsedAt // ignore: cast_nullable_to_non_nullable
              as DateTime,
    ) as $Val);
  }
}

/// @nodoc
abstract class _$$HostConfigImplCopyWith<$Res>
    implements $HostConfigCopyWith<$Res> {
  factory _$$HostConfigImplCopyWith(
          _$HostConfigImpl value, $Res Function(_$HostConfigImpl) then) =
      __$$HostConfigImplCopyWithImpl<$Res>;
  @override
  @useResult
  $Res call(
      {String id,
      String label,
      String origin,
      HostKind kind,
      DateTime createdAt,
      DateTime lastUsedAt});
}

/// @nodoc
class __$$HostConfigImplCopyWithImpl<$Res>
    extends _$HostConfigCopyWithImpl<$Res, _$HostConfigImpl>
    implements _$$HostConfigImplCopyWith<$Res> {
  __$$HostConfigImplCopyWithImpl(
      _$HostConfigImpl _value, $Res Function(_$HostConfigImpl) _then)
      : super(_value, _then);

  /// Create a copy of HostConfig
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? id = null,
    Object? label = null,
    Object? origin = null,
    Object? kind = null,
    Object? createdAt = null,
    Object? lastUsedAt = null,
  }) {
    return _then(_$HostConfigImpl(
      id: null == id
          ? _value.id
          : id // ignore: cast_nullable_to_non_nullable
              as String,
      label: null == label
          ? _value.label
          : label // ignore: cast_nullable_to_non_nullable
              as String,
      origin: null == origin
          ? _value.origin
          : origin // ignore: cast_nullable_to_non_nullable
              as String,
      kind: null == kind
          ? _value.kind
          : kind // ignore: cast_nullable_to_non_nullable
              as HostKind,
      createdAt: null == createdAt
          ? _value.createdAt
          : createdAt // ignore: cast_nullable_to_non_nullable
              as DateTime,
      lastUsedAt: null == lastUsedAt
          ? _value.lastUsedAt
          : lastUsedAt // ignore: cast_nullable_to_non_nullable
              as DateTime,
    ));
  }
}

/// @nodoc
@JsonSerializable()
class _$HostConfigImpl extends _HostConfig {
  const _$HostConfigImpl(
      {required this.id,
      required this.label,
      required this.origin,
      required this.kind,
      required this.createdAt,
      required this.lastUsedAt})
      : super._();

  factory _$HostConfigImpl.fromJson(Map<String, dynamic> json) =>
      _$$HostConfigImplFromJson(json);

  @override
  final String id;
  @override
  final String label;

  /// `scheme://host[:port]` — NO trailing slash, NO path.
  /// Build with [normalizeOrigin] to guarantee that invariant.
  @override
  final String origin;
  @override
  final HostKind kind;
  @override
  final DateTime createdAt;
  @override
  final DateTime lastUsedAt;

  @override
  String toString() {
    return 'HostConfig(id: $id, label: $label, origin: $origin, kind: $kind, createdAt: $createdAt, lastUsedAt: $lastUsedAt)';
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _$HostConfigImpl &&
            (identical(other.id, id) || other.id == id) &&
            (identical(other.label, label) || other.label == label) &&
            (identical(other.origin, origin) || other.origin == origin) &&
            (identical(other.kind, kind) || other.kind == kind) &&
            (identical(other.createdAt, createdAt) ||
                other.createdAt == createdAt) &&
            (identical(other.lastUsedAt, lastUsedAt) ||
                other.lastUsedAt == lastUsedAt));
  }

  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  int get hashCode =>
      Object.hash(runtimeType, id, label, origin, kind, createdAt, lastUsedAt);

  /// Create a copy of HostConfig
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  @pragma('vm:prefer-inline')
  _$$HostConfigImplCopyWith<_$HostConfigImpl> get copyWith =>
      __$$HostConfigImplCopyWithImpl<_$HostConfigImpl>(this, _$identity);

  @override
  Map<String, dynamic> toJson() {
    return _$$HostConfigImplToJson(
      this,
    );
  }
}

abstract class _HostConfig extends HostConfig {
  const factory _HostConfig(
      {required final String id,
      required final String label,
      required final String origin,
      required final HostKind kind,
      required final DateTime createdAt,
      required final DateTime lastUsedAt}) = _$HostConfigImpl;
  const _HostConfig._() : super._();

  factory _HostConfig.fromJson(Map<String, dynamic> json) =
      _$HostConfigImpl.fromJson;

  @override
  String get id;
  @override
  String get label;

  /// `scheme://host[:port]` — NO trailing slash, NO path.
  /// Build with [normalizeOrigin] to guarantee that invariant.
  @override
  String get origin;
  @override
  HostKind get kind;
  @override
  DateTime get createdAt;
  @override
  DateTime get lastUsedAt;

  /// Create a copy of HostConfig
  /// with the given fields replaced by the non-null parameter values.
  @override
  @JsonKey(includeFromJson: false, includeToJson: false)
  _$$HostConfigImplCopyWith<_$HostConfigImpl> get copyWith =>
      throw _privateConstructorUsedError;
}
