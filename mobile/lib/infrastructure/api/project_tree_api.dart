import '../../application/ports/api_client_port.dart';
import '../../application/ports/project_tree_port.dart';
import '../../domain/group.dart';
import '../../domain/project.dart';

class ProjectTreeApi implements ProjectTreePort {
  ProjectTreeApi(this._client);
  final ApiClientPort _client;

  @override
  Future<List<Group>> listGroups() async {
    final raw = await _client.get('/api/groups');
    final list = _extractList(raw, 'groups');
    return list.map(Group.fromJson).toList(growable: false);
  }

  @override
  Future<List<Project>> listProjects() async {
    final raw = await _client.get('/api/projects');
    final list = _extractList(raw, 'projects');
    return list.map(Project.fromJson).toList(growable: false);
  }

  /// Tolerates both {key: [...]} wrapped and bare-array responses.
  static List<Map<String, dynamic>> _extractList(dynamic raw, String key) {
    if (raw is List) {
      return raw.cast<Map<String, dynamic>>();
    }
    if (raw is Map<String, dynamic>) {
      final inner = raw[key];
      if (inner is List) return inner.cast<Map<String, dynamic>>();
    }
    return const [];
  }
}
