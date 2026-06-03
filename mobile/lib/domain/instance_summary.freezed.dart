// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint
// ignore_for_file: unused_element, deprecated_member_use, deprecated_member_use_from_same_package, use_function_type_syntax_for_parameters, unnecessary_const, avoid_init_to_null, invalid_override_different_default_values_named, prefer_expression_function_bodies, annotate_overrides, invalid_annotation_target, unnecessary_question_mark

part of 'instance_summary.dart';

// **************************************************************************
// FreezedGenerator
// **************************************************************************

T _$identity<T>(T value) => value;

final _privateConstructorUsedError = UnsupportedError(
    'It seems like you constructed your class using `MyClass._()`. This constructor is only meant to be used by freezed and you are not supposed to need it nor use it.\nPlease check the documentation here for more information: https://github.com/rrousselGit/freezed#adding-getters-and-methods-to-our-models');

InstanceSummary _$InstanceSummaryFromJson(Map<String, dynamic> json) {
  return _InstanceSummary.fromJson(json);
}

/// @nodoc
mixin _$InstanceSummary {
  /// Instance slug, e.g. `demo`. Stable identifier + URL path segment.
  String get slug => throw _privateConstructorUsedError;

  /// Human label. The server column is NOT NULL, but we default it to [slug]
  /// (via [InstanceSummary.fromInstanceJson]) so a blank/missing value never
  /// renders an empty row in the picker.
  String get displayName => throw _privateConstructorUsedError;

  /// Raw lifecycle status string from the server.
  String get status => throw _privateConstructorUsedError;

  /// Serializes this InstanceSummary to a JSON map.
  Map<String, dynamic> toJson() => throw _privateConstructorUsedError;

  /// Create a copy of InstanceSummary
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  $InstanceSummaryCopyWith<InstanceSummary> get copyWith =>
      throw _privateConstructorUsedError;
}

/// @nodoc
abstract class $InstanceSummaryCopyWith<$Res> {
  factory $InstanceSummaryCopyWith(
          InstanceSummary value, $Res Function(InstanceSummary) then) =
      _$InstanceSummaryCopyWithImpl<$Res, InstanceSummary>;
  @useResult
  $Res call({String slug, String displayName, String status});
}

/// @nodoc
class _$InstanceSummaryCopyWithImpl<$Res, $Val extends InstanceSummary>
    implements $InstanceSummaryCopyWith<$Res> {
  _$InstanceSummaryCopyWithImpl(this._value, this._then);

  // ignore: unused_field
  final $Val _value;
  // ignore: unused_field
  final $Res Function($Val) _then;

  /// Create a copy of InstanceSummary
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? slug = null,
    Object? displayName = null,
    Object? status = null,
  }) {
    return _then(_value.copyWith(
      slug: null == slug
          ? _value.slug
          : slug // ignore: cast_nullable_to_non_nullable
              as String,
      displayName: null == displayName
          ? _value.displayName
          : displayName // ignore: cast_nullable_to_non_nullable
              as String,
      status: null == status
          ? _value.status
          : status // ignore: cast_nullable_to_non_nullable
              as String,
    ) as $Val);
  }
}

/// @nodoc
abstract class _$$InstanceSummaryImplCopyWith<$Res>
    implements $InstanceSummaryCopyWith<$Res> {
  factory _$$InstanceSummaryImplCopyWith(_$InstanceSummaryImpl value,
          $Res Function(_$InstanceSummaryImpl) then) =
      __$$InstanceSummaryImplCopyWithImpl<$Res>;
  @override
  @useResult
  $Res call({String slug, String displayName, String status});
}

/// @nodoc
class __$$InstanceSummaryImplCopyWithImpl<$Res>
    extends _$InstanceSummaryCopyWithImpl<$Res, _$InstanceSummaryImpl>
    implements _$$InstanceSummaryImplCopyWith<$Res> {
  __$$InstanceSummaryImplCopyWithImpl(
      _$InstanceSummaryImpl _value, $Res Function(_$InstanceSummaryImpl) _then)
      : super(_value, _then);

  /// Create a copy of InstanceSummary
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? slug = null,
    Object? displayName = null,
    Object? status = null,
  }) {
    return _then(_$InstanceSummaryImpl(
      slug: null == slug
          ? _value.slug
          : slug // ignore: cast_nullable_to_non_nullable
              as String,
      displayName: null == displayName
          ? _value.displayName
          : displayName // ignore: cast_nullable_to_non_nullable
              as String,
      status: null == status
          ? _value.status
          : status // ignore: cast_nullable_to_non_nullable
              as String,
    ));
  }
}

/// @nodoc
@JsonSerializable()
class _$InstanceSummaryImpl extends _InstanceSummary {
  const _$InstanceSummaryImpl(
      {required this.slug, required this.displayName, required this.status})
      : super._();

  factory _$InstanceSummaryImpl.fromJson(Map<String, dynamic> json) =>
      _$$InstanceSummaryImplFromJson(json);

  /// Instance slug, e.g. `demo`. Stable identifier + URL path segment.
  @override
  final String slug;

  /// Human label. The server column is NOT NULL, but we default it to [slug]
  /// (via [InstanceSummary.fromInstanceJson]) so a blank/missing value never
  /// renders an empty row in the picker.
  @override
  final String displayName;

  /// Raw lifecycle status string from the server.
  @override
  final String status;

  @override
  String toString() {
    return 'InstanceSummary(slug: $slug, displayName: $displayName, status: $status)';
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _$InstanceSummaryImpl &&
            (identical(other.slug, slug) || other.slug == slug) &&
            (identical(other.displayName, displayName) ||
                other.displayName == displayName) &&
            (identical(other.status, status) || other.status == status));
  }

  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  int get hashCode => Object.hash(runtimeType, slug, displayName, status);

  /// Create a copy of InstanceSummary
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  @pragma('vm:prefer-inline')
  _$$InstanceSummaryImplCopyWith<_$InstanceSummaryImpl> get copyWith =>
      __$$InstanceSummaryImplCopyWithImpl<_$InstanceSummaryImpl>(
          this, _$identity);

  @override
  Map<String, dynamic> toJson() {
    return _$$InstanceSummaryImplToJson(
      this,
    );
  }
}

abstract class _InstanceSummary extends InstanceSummary {
  const factory _InstanceSummary(
      {required final String slug,
      required final String displayName,
      required final String status}) = _$InstanceSummaryImpl;
  const _InstanceSummary._() : super._();

  factory _InstanceSummary.fromJson(Map<String, dynamic> json) =
      _$InstanceSummaryImpl.fromJson;

  /// Instance slug, e.g. `demo`. Stable identifier + URL path segment.
  @override
  String get slug;

  /// Human label. The server column is NOT NULL, but we default it to [slug]
  /// (via [InstanceSummary.fromInstanceJson]) so a blank/missing value never
  /// renders an empty row in the picker.
  @override
  String get displayName;

  /// Raw lifecycle status string from the server.
  @override
  String get status;

  /// Create a copy of InstanceSummary
  /// with the given fields replaced by the non-null parameter values.
  @override
  @JsonKey(includeFromJson: false, includeToJson: false)
  _$$InstanceSummaryImplCopyWith<_$InstanceSummaryImpl> get copyWith =>
      throw _privateConstructorUsedError;
}
