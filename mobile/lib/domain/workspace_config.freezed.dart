// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint
// ignore_for_file: unused_element, deprecated_member_use, deprecated_member_use_from_same_package, use_function_type_syntax_for_parameters, unnecessary_const, avoid_init_to_null, invalid_override_different_default_values_named, prefer_expression_function_bodies, annotate_overrides, invalid_annotation_target, unnecessary_question_mark

part of 'workspace_config.dart';

// **************************************************************************
// FreezedGenerator
// **************************************************************************

T _$identity<T>(T value) => value;

final _privateConstructorUsedError = UnsupportedError(
    'It seems like you constructed your class using `MyClass._()`. This constructor is only meant to be used by freezed and you are not supposed to need it nor use it.\nPlease check the documentation here for more information: https://github.com/rrousselGit/freezed#adding-getters-and-methods-to-our-models');

WorkspaceConfig _$WorkspaceConfigFromJson(Map<String, dynamic> json) {
  return _WorkspaceConfig.fromJson(json);
}

/// @nodoc
mixin _$WorkspaceConfig {
  String get id => throw _privateConstructorUsedError;
  String get hostId => throw _privateConstructorUsedError;

  /// Instance slug, e.g. `demo`. Empty string for single-workspace hosts.
  String get slug => throw _privateConstructorUsedError;

  /// `""` or `/<slug>` — prepended to every API/WebView path.
  String get basePath => throw _privateConstructorUsedError;
  String get displayName => throw _privateConstructorUsedError;

  /// Last-known instance status; null for single-workspace hosts.
  String? get status => throw _privateConstructorUsedError;
  DateTime get lastUsedAt => throw _privateConstructorUsedError;

  /// Serializes this WorkspaceConfig to a JSON map.
  Map<String, dynamic> toJson() => throw _privateConstructorUsedError;

  /// Create a copy of WorkspaceConfig
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  $WorkspaceConfigCopyWith<WorkspaceConfig> get copyWith =>
      throw _privateConstructorUsedError;
}

/// @nodoc
abstract class $WorkspaceConfigCopyWith<$Res> {
  factory $WorkspaceConfigCopyWith(
          WorkspaceConfig value, $Res Function(WorkspaceConfig) then) =
      _$WorkspaceConfigCopyWithImpl<$Res, WorkspaceConfig>;
  @useResult
  $Res call(
      {String id,
      String hostId,
      String slug,
      String basePath,
      String displayName,
      String? status,
      DateTime lastUsedAt});
}

/// @nodoc
class _$WorkspaceConfigCopyWithImpl<$Res, $Val extends WorkspaceConfig>
    implements $WorkspaceConfigCopyWith<$Res> {
  _$WorkspaceConfigCopyWithImpl(this._value, this._then);

  // ignore: unused_field
  final $Val _value;
  // ignore: unused_field
  final $Res Function($Val) _then;

  /// Create a copy of WorkspaceConfig
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? id = null,
    Object? hostId = null,
    Object? slug = null,
    Object? basePath = null,
    Object? displayName = null,
    Object? status = freezed,
    Object? lastUsedAt = null,
  }) {
    return _then(_value.copyWith(
      id: null == id
          ? _value.id
          : id // ignore: cast_nullable_to_non_nullable
              as String,
      hostId: null == hostId
          ? _value.hostId
          : hostId // ignore: cast_nullable_to_non_nullable
              as String,
      slug: null == slug
          ? _value.slug
          : slug // ignore: cast_nullable_to_non_nullable
              as String,
      basePath: null == basePath
          ? _value.basePath
          : basePath // ignore: cast_nullable_to_non_nullable
              as String,
      displayName: null == displayName
          ? _value.displayName
          : displayName // ignore: cast_nullable_to_non_nullable
              as String,
      status: freezed == status
          ? _value.status
          : status // ignore: cast_nullable_to_non_nullable
              as String?,
      lastUsedAt: null == lastUsedAt
          ? _value.lastUsedAt
          : lastUsedAt // ignore: cast_nullable_to_non_nullable
              as DateTime,
    ) as $Val);
  }
}

/// @nodoc
abstract class _$$WorkspaceConfigImplCopyWith<$Res>
    implements $WorkspaceConfigCopyWith<$Res> {
  factory _$$WorkspaceConfigImplCopyWith(_$WorkspaceConfigImpl value,
          $Res Function(_$WorkspaceConfigImpl) then) =
      __$$WorkspaceConfigImplCopyWithImpl<$Res>;
  @override
  @useResult
  $Res call(
      {String id,
      String hostId,
      String slug,
      String basePath,
      String displayName,
      String? status,
      DateTime lastUsedAt});
}

/// @nodoc
class __$$WorkspaceConfigImplCopyWithImpl<$Res>
    extends _$WorkspaceConfigCopyWithImpl<$Res, _$WorkspaceConfigImpl>
    implements _$$WorkspaceConfigImplCopyWith<$Res> {
  __$$WorkspaceConfigImplCopyWithImpl(
      _$WorkspaceConfigImpl _value, $Res Function(_$WorkspaceConfigImpl) _then)
      : super(_value, _then);

  /// Create a copy of WorkspaceConfig
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? id = null,
    Object? hostId = null,
    Object? slug = null,
    Object? basePath = null,
    Object? displayName = null,
    Object? status = freezed,
    Object? lastUsedAt = null,
  }) {
    return _then(_$WorkspaceConfigImpl(
      id: null == id
          ? _value.id
          : id // ignore: cast_nullable_to_non_nullable
              as String,
      hostId: null == hostId
          ? _value.hostId
          : hostId // ignore: cast_nullable_to_non_nullable
              as String,
      slug: null == slug
          ? _value.slug
          : slug // ignore: cast_nullable_to_non_nullable
              as String,
      basePath: null == basePath
          ? _value.basePath
          : basePath // ignore: cast_nullable_to_non_nullable
              as String,
      displayName: null == displayName
          ? _value.displayName
          : displayName // ignore: cast_nullable_to_non_nullable
              as String,
      status: freezed == status
          ? _value.status
          : status // ignore: cast_nullable_to_non_nullable
              as String?,
      lastUsedAt: null == lastUsedAt
          ? _value.lastUsedAt
          : lastUsedAt // ignore: cast_nullable_to_non_nullable
              as DateTime,
    ));
  }
}

/// @nodoc
@JsonSerializable()
class _$WorkspaceConfigImpl implements _WorkspaceConfig {
  const _$WorkspaceConfigImpl(
      {required this.id,
      required this.hostId,
      required this.slug,
      required this.basePath,
      required this.displayName,
      this.status,
      required this.lastUsedAt});

  factory _$WorkspaceConfigImpl.fromJson(Map<String, dynamic> json) =>
      _$$WorkspaceConfigImplFromJson(json);

  @override
  final String id;
  @override
  final String hostId;

  /// Instance slug, e.g. `demo`. Empty string for single-workspace hosts.
  @override
  final String slug;

  /// `""` or `/<slug>` — prepended to every API/WebView path.
  @override
  final String basePath;
  @override
  final String displayName;

  /// Last-known instance status; null for single-workspace hosts.
  @override
  final String? status;
  @override
  final DateTime lastUsedAt;

  @override
  String toString() {
    return 'WorkspaceConfig(id: $id, hostId: $hostId, slug: $slug, basePath: $basePath, displayName: $displayName, status: $status, lastUsedAt: $lastUsedAt)';
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _$WorkspaceConfigImpl &&
            (identical(other.id, id) || other.id == id) &&
            (identical(other.hostId, hostId) || other.hostId == hostId) &&
            (identical(other.slug, slug) || other.slug == slug) &&
            (identical(other.basePath, basePath) ||
                other.basePath == basePath) &&
            (identical(other.displayName, displayName) ||
                other.displayName == displayName) &&
            (identical(other.status, status) || other.status == status) &&
            (identical(other.lastUsedAt, lastUsedAt) ||
                other.lastUsedAt == lastUsedAt));
  }

  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  int get hashCode => Object.hash(
      runtimeType, id, hostId, slug, basePath, displayName, status, lastUsedAt);

  /// Create a copy of WorkspaceConfig
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  @pragma('vm:prefer-inline')
  _$$WorkspaceConfigImplCopyWith<_$WorkspaceConfigImpl> get copyWith =>
      __$$WorkspaceConfigImplCopyWithImpl<_$WorkspaceConfigImpl>(
          this, _$identity);

  @override
  Map<String, dynamic> toJson() {
    return _$$WorkspaceConfigImplToJson(
      this,
    );
  }
}

abstract class _WorkspaceConfig implements WorkspaceConfig {
  const factory _WorkspaceConfig(
      {required final String id,
      required final String hostId,
      required final String slug,
      required final String basePath,
      required final String displayName,
      final String? status,
      required final DateTime lastUsedAt}) = _$WorkspaceConfigImpl;

  factory _WorkspaceConfig.fromJson(Map<String, dynamic> json) =
      _$WorkspaceConfigImpl.fromJson;

  @override
  String get id;
  @override
  String get hostId;

  /// Instance slug, e.g. `demo`. Empty string for single-workspace hosts.
  @override
  String get slug;

  /// `""` or `/<slug>` — prepended to every API/WebView path.
  @override
  String get basePath;
  @override
  String get displayName;

  /// Last-known instance status; null for single-workspace hosts.
  @override
  String? get status;
  @override
  DateTime get lastUsedAt;

  /// Create a copy of WorkspaceConfig
  /// with the given fields replaced by the non-null parameter values.
  @override
  @JsonKey(includeFromJson: false, includeToJson: false)
  _$$WorkspaceConfigImplCopyWith<_$WorkspaceConfigImpl> get copyWith =>
      throw _privateConstructorUsedError;
}
