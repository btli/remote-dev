import 'package:freezed_annotation/freezed_annotation.dart';

part 'project.freezed.dart';
part 'project.g.dart';

@freezed
class Project with _$Project {
  const factory Project({
    required String id,
    required String name,
    // Nullable: the server returns `null` for root-level projects that are
    // not nested under a group. The project picker renders these as a flat
    // section above grouped projects.
    String? groupId,
    @Default(0) int sortOrder,
  }) = _Project;

  factory Project.fromJson(Map<String, dynamic> json) =>
      _$ProjectFromJson(json);
}
