import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:remote_dev/application/ports/api_client_port.dart';
import 'package:remote_dev/infrastructure/api/project_tree_api.dart';

class _MockClient extends Mock implements ApiClientPort {}

void main() {
  late _MockClient client;
  late ProjectTreeApi api;

  setUp(() {
    client = _MockClient();
    api = ProjectTreeApi(client);
  });

  test('listGroups parses bare-array response', () async {
    when(() => client.get('/api/groups')).thenAnswer(
      (_) async => [
        {'id': 'g1', 'name': 'Work'},
        {
          'id': 'g2',
          'name': 'Personal',
          'parentGroupId': null,
          'sortOrder': 1,
        },
      ],
    );
    final result = await api.listGroups();
    expect(result, hasLength(2));
    expect(result.first.id, 'g1');
  });

  test('listGroups parses wrapped response', () async {
    when(() => client.get('/api/groups')).thenAnswer(
      (_) async => {
        'groups': [
          {'id': 'g1', 'name': 'Work'},
        ],
      },
    );
    final result = await api.listGroups();
    expect(result, hasLength(1));
  });

  test('listProjects similarly tolerates both shapes', () async {
    when(() => client.get('/api/projects')).thenAnswer(
      (_) async => [
        {'id': 'p1', 'name': 'remote-dev', 'groupId': 'g1'},
      ],
    );
    final result = await api.listProjects();
    expect(result.single.id, 'p1');
  });
}
