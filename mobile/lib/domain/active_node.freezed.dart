// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint
// ignore_for_file: unused_element, deprecated_member_use, deprecated_member_use_from_same_package, use_function_type_syntax_for_parameters, unnecessary_const, avoid_init_to_null, invalid_override_different_default_values_named, prefer_expression_function_bodies, annotate_overrides, invalid_annotation_target, unnecessary_question_mark

part of 'active_node.dart';

// **************************************************************************
// FreezedGenerator
// **************************************************************************

T _$identity<T>(T value) => value;

final _privateConstructorUsedError = UnsupportedError(
    'It seems like you constructed your class using `MyClass._()`. This constructor is only meant to be used by freezed and you are not supposed to need it nor use it.\nPlease check the documentation here for more information: https://github.com/rrousselGit/freezed#adding-getters-and-methods-to-our-models');

ActiveNode _$ActiveNodeFromJson(Map<String, dynamic> json) {
  return _ActiveNode.fromJson(json);
}

/// @nodoc
mixin _$ActiveNode {
  String get id => throw _privateConstructorUsedError;
  ActiveNodeType get type => throw _privateConstructorUsedError;
  String? get name => throw _privateConstructorUsedError;

  /// Serializes this ActiveNode to a JSON map.
  Map<String, dynamic> toJson() => throw _privateConstructorUsedError;

  /// Create a copy of ActiveNode
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  $ActiveNodeCopyWith<ActiveNode> get copyWith =>
      throw _privateConstructorUsedError;
}

/// @nodoc
abstract class $ActiveNodeCopyWith<$Res> {
  factory $ActiveNodeCopyWith(
          ActiveNode value, $Res Function(ActiveNode) then) =
      _$ActiveNodeCopyWithImpl<$Res, ActiveNode>;
  @useResult
  $Res call({String id, ActiveNodeType type, String? name});
}

/// @nodoc
class _$ActiveNodeCopyWithImpl<$Res, $Val extends ActiveNode>
    implements $ActiveNodeCopyWith<$Res> {
  _$ActiveNodeCopyWithImpl(this._value, this._then);

  // ignore: unused_field
  final $Val _value;
  // ignore: unused_field
  final $Res Function($Val) _then;

  /// Create a copy of ActiveNode
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? id = null,
    Object? type = null,
    Object? name = freezed,
  }) {
    return _then(_value.copyWith(
      id: null == id
          ? _value.id
          : id // ignore: cast_nullable_to_non_nullable
              as String,
      type: null == type
          ? _value.type
          : type // ignore: cast_nullable_to_non_nullable
              as ActiveNodeType,
      name: freezed == name
          ? _value.name
          : name // ignore: cast_nullable_to_non_nullable
              as String?,
    ) as $Val);
  }
}

/// @nodoc
abstract class _$$ActiveNodeImplCopyWith<$Res>
    implements $ActiveNodeCopyWith<$Res> {
  factory _$$ActiveNodeImplCopyWith(
          _$ActiveNodeImpl value, $Res Function(_$ActiveNodeImpl) then) =
      __$$ActiveNodeImplCopyWithImpl<$Res>;
  @override
  @useResult
  $Res call({String id, ActiveNodeType type, String? name});
}

/// @nodoc
class __$$ActiveNodeImplCopyWithImpl<$Res>
    extends _$ActiveNodeCopyWithImpl<$Res, _$ActiveNodeImpl>
    implements _$$ActiveNodeImplCopyWith<$Res> {
  __$$ActiveNodeImplCopyWithImpl(
      _$ActiveNodeImpl _value, $Res Function(_$ActiveNodeImpl) _then)
      : super(_value, _then);

  /// Create a copy of ActiveNode
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? id = null,
    Object? type = null,
    Object? name = freezed,
  }) {
    return _then(_$ActiveNodeImpl(
      id: null == id
          ? _value.id
          : id // ignore: cast_nullable_to_non_nullable
              as String,
      type: null == type
          ? _value.type
          : type // ignore: cast_nullable_to_non_nullable
              as ActiveNodeType,
      name: freezed == name
          ? _value.name
          : name // ignore: cast_nullable_to_non_nullable
              as String?,
    ));
  }
}

/// @nodoc
@JsonSerializable()
class _$ActiveNodeImpl implements _ActiveNode {
  const _$ActiveNodeImpl({required this.id, required this.type, this.name});

  factory _$ActiveNodeImpl.fromJson(Map<String, dynamic> json) =>
      _$$ActiveNodeImplFromJson(json);

  @override
  final String id;
  @override
  final ActiveNodeType type;
  @override
  final String? name;

  @override
  String toString() {
    return 'ActiveNode(id: $id, type: $type, name: $name)';
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _$ActiveNodeImpl &&
            (identical(other.id, id) || other.id == id) &&
            (identical(other.type, type) || other.type == type) &&
            (identical(other.name, name) || other.name == name));
  }

  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  int get hashCode => Object.hash(runtimeType, id, type, name);

  /// Create a copy of ActiveNode
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  @pragma('vm:prefer-inline')
  _$$ActiveNodeImplCopyWith<_$ActiveNodeImpl> get copyWith =>
      __$$ActiveNodeImplCopyWithImpl<_$ActiveNodeImpl>(this, _$identity);

  @override
  Map<String, dynamic> toJson() {
    return _$$ActiveNodeImplToJson(
      this,
    );
  }
}

abstract class _ActiveNode implements ActiveNode {
  const factory _ActiveNode(
      {required final String id,
      required final ActiveNodeType type,
      final String? name}) = _$ActiveNodeImpl;

  factory _ActiveNode.fromJson(Map<String, dynamic> json) =
      _$ActiveNodeImpl.fromJson;

  @override
  String get id;
  @override
  ActiveNodeType get type;
  @override
  String? get name;

  /// Create a copy of ActiveNode
  /// with the given fields replaced by the non-null parameter values.
  @override
  @JsonKey(includeFromJson: false, includeToJson: false)
  _$$ActiveNodeImplCopyWith<_$ActiveNodeImpl> get copyWith =>
      throw _privateConstructorUsedError;
}
