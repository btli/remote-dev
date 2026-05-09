import '../../domain/group.dart';
import '../../domain/project.dart';

abstract class ProjectTreePort {
  Future<List<Group>> listGroups();
  Future<List<Project>> listProjects();
}
