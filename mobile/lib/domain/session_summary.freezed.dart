// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint
// ignore_for_file: unused_element, deprecated_member_use, deprecated_member_use_from_same_package, use_function_type_syntax_for_parameters, unnecessary_const, avoid_init_to_null, invalid_override_different_default_values_named, prefer_expression_function_bodies, annotate_overrides, invalid_annotation_target, unnecessary_question_mark

part of 'session_summary.dart';

// **************************************************************************
// FreezedGenerator
// **************************************************************************

T _$identity<T>(T value) => value;

final _privateConstructorUsedError = UnsupportedError(
    'It seems like you constructed your class using `MyClass._()`. This constructor is only meant to be used by freezed and you are not supposed to need it nor use it.\nPlease check the documentation here for more information: https://github.com/rrousselGit/freezed#adding-getters-and-methods-to-our-models');

SessionSummary _$SessionSummaryFromJson(Map<String, dynamic> json) {
  return _SessionSummary.fromJson(json);
}

/// @nodoc
mixin _$SessionSummary {
  String get id => throw _privateConstructorUsedError;
  String get name => throw _privateConstructorUsedError;
  String get tmuxSessionName => throw _privateConstructorUsedError;
  SessionStatus get status => throw _privateConstructorUsedError;
  String? get projectId => throw _privateConstructorUsedError;
  @JsonKey(
      name: 'agentActivityStatus', unknownEnumValue: AgentActivityStatus.none)
  AgentActivityStatus get activity => throw _privateConstructorUsedError;

  /// Serializes this SessionSummary to a JSON map.
  Map<String, dynamic> toJson() => throw _privateConstructorUsedError;

  /// Create a copy of SessionSummary
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  $SessionSummaryCopyWith<SessionSummary> get copyWith =>
      throw _privateConstructorUsedError;
}

/// @nodoc
abstract class $SessionSummaryCopyWith<$Res> {
  factory $SessionSummaryCopyWith(
          SessionSummary value, $Res Function(SessionSummary) then) =
      _$SessionSummaryCopyWithImpl<$Res, SessionSummary>;
  @useResult
  $Res call(
      {String id,
      String name,
      String tmuxSessionName,
      SessionStatus status,
      String? projectId,
      @JsonKey(
          name: 'agentActivityStatus',
          unknownEnumValue: AgentActivityStatus.none)
      AgentActivityStatus activity});
}

/// @nodoc
class _$SessionSummaryCopyWithImpl<$Res, $Val extends SessionSummary>
    implements $SessionSummaryCopyWith<$Res> {
  _$SessionSummaryCopyWithImpl(this._value, this._then);

  // ignore: unused_field
  final $Val _value;
  // ignore: unused_field
  final $Res Function($Val) _then;

  /// Create a copy of SessionSummary
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? id = null,
    Object? name = null,
    Object? tmuxSessionName = null,
    Object? status = null,
    Object? projectId = freezed,
    Object? activity = null,
  }) {
    return _then(_value.copyWith(
      id: null == id
          ? _value.id
          : id // ignore: cast_nullable_to_non_nullable
              as String,
      name: null == name
          ? _value.name
          : name // ignore: cast_nullable_to_non_nullable
              as String,
      tmuxSessionName: null == tmuxSessionName
          ? _value.tmuxSessionName
          : tmuxSessionName // ignore: cast_nullable_to_non_nullable
              as String,
      status: null == status
          ? _value.status
          : status // ignore: cast_nullable_to_non_nullable
              as SessionStatus,
      projectId: freezed == projectId
          ? _value.projectId
          : projectId // ignore: cast_nullable_to_non_nullable
              as String?,
      activity: null == activity
          ? _value.activity
          : activity // ignore: cast_nullable_to_non_nullable
              as AgentActivityStatus,
    ) as $Val);
  }
}

/// @nodoc
abstract class _$$SessionSummaryImplCopyWith<$Res>
    implements $SessionSummaryCopyWith<$Res> {
  factory _$$SessionSummaryImplCopyWith(_$SessionSummaryImpl value,
          $Res Function(_$SessionSummaryImpl) then) =
      __$$SessionSummaryImplCopyWithImpl<$Res>;
  @override
  @useResult
  $Res call(
      {String id,
      String name,
      String tmuxSessionName,
      SessionStatus status,
      String? projectId,
      @JsonKey(
          name: 'agentActivityStatus',
          unknownEnumValue: AgentActivityStatus.none)
      AgentActivityStatus activity});
}

/// @nodoc
class __$$SessionSummaryImplCopyWithImpl<$Res>
    extends _$SessionSummaryCopyWithImpl<$Res, _$SessionSummaryImpl>
    implements _$$SessionSummaryImplCopyWith<$Res> {
  __$$SessionSummaryImplCopyWithImpl(
      _$SessionSummaryImpl _value, $Res Function(_$SessionSummaryImpl) _then)
      : super(_value, _then);

  /// Create a copy of SessionSummary
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? id = null,
    Object? name = null,
    Object? tmuxSessionName = null,
    Object? status = null,
    Object? projectId = freezed,
    Object? activity = null,
  }) {
    return _then(_$SessionSummaryImpl(
      id: null == id
          ? _value.id
          : id // ignore: cast_nullable_to_non_nullable
              as String,
      name: null == name
          ? _value.name
          : name // ignore: cast_nullable_to_non_nullable
              as String,
      tmuxSessionName: null == tmuxSessionName
          ? _value.tmuxSessionName
          : tmuxSessionName // ignore: cast_nullable_to_non_nullable
              as String,
      status: null == status
          ? _value.status
          : status // ignore: cast_nullable_to_non_nullable
              as SessionStatus,
      projectId: freezed == projectId
          ? _value.projectId
          : projectId // ignore: cast_nullable_to_non_nullable
              as String?,
      activity: null == activity
          ? _value.activity
          : activity // ignore: cast_nullable_to_non_nullable
              as AgentActivityStatus,
    ));
  }
}

/// @nodoc
@JsonSerializable()
class _$SessionSummaryImpl implements _SessionSummary {
  const _$SessionSummaryImpl(
      {required this.id,
      required this.name,
      required this.tmuxSessionName,
      required this.status,
      this.projectId,
      @JsonKey(
          name: 'agentActivityStatus',
          unknownEnumValue: AgentActivityStatus.none)
      this.activity = AgentActivityStatus.none});

  factory _$SessionSummaryImpl.fromJson(Map<String, dynamic> json) =>
      _$$SessionSummaryImplFromJson(json);

  @override
  final String id;
  @override
  final String name;
  @override
  final String tmuxSessionName;
  @override
  final SessionStatus status;
  @override
  final String? projectId;
  @override
  @JsonKey(
      name: 'agentActivityStatus', unknownEnumValue: AgentActivityStatus.none)
  final AgentActivityStatus activity;

  @override
  String toString() {
    return 'SessionSummary(id: $id, name: $name, tmuxSessionName: $tmuxSessionName, status: $status, projectId: $projectId, activity: $activity)';
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _$SessionSummaryImpl &&
            (identical(other.id, id) || other.id == id) &&
            (identical(other.name, name) || other.name == name) &&
            (identical(other.tmuxSessionName, tmuxSessionName) ||
                other.tmuxSessionName == tmuxSessionName) &&
            (identical(other.status, status) || other.status == status) &&
            (identical(other.projectId, projectId) ||
                other.projectId == projectId) &&
            (identical(other.activity, activity) ||
                other.activity == activity));
  }

  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  int get hashCode => Object.hash(
      runtimeType, id, name, tmuxSessionName, status, projectId, activity);

  /// Create a copy of SessionSummary
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  @pragma('vm:prefer-inline')
  _$$SessionSummaryImplCopyWith<_$SessionSummaryImpl> get copyWith =>
      __$$SessionSummaryImplCopyWithImpl<_$SessionSummaryImpl>(
          this, _$identity);

  @override
  Map<String, dynamic> toJson() {
    return _$$SessionSummaryImplToJson(
      this,
    );
  }
}

abstract class _SessionSummary implements SessionSummary {
  const factory _SessionSummary(
      {required final String id,
      required final String name,
      required final String tmuxSessionName,
      required final SessionStatus status,
      final String? projectId,
      @JsonKey(
          name: 'agentActivityStatus',
          unknownEnumValue: AgentActivityStatus.none)
      final AgentActivityStatus activity}) = _$SessionSummaryImpl;

  factory _SessionSummary.fromJson(Map<String, dynamic> json) =
      _$SessionSummaryImpl.fromJson;

  @override
  String get id;
  @override
  String get name;
  @override
  String get tmuxSessionName;
  @override
  SessionStatus get status;
  @override
  String? get projectId;
  @override
  @JsonKey(
      name: 'agentActivityStatus', unknownEnumValue: AgentActivityStatus.none)
  AgentActivityStatus get activity;

  /// Create a copy of SessionSummary
  /// with the given fields replaced by the non-null parameter values.
  @override
  @JsonKey(includeFromJson: false, includeToJson: false)
  _$$SessionSummaryImplCopyWith<_$SessionSummaryImpl> get copyWith =>
      throw _privateConstructorUsedError;
}
