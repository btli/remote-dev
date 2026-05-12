import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:remote_dev/application/ports/api_client_port.dart';
import 'package:remote_dev/domain/active_node.dart';
import 'package:remote_dev/infrastructure/api/channels_api.dart';

class _MockApiClient extends Mock implements ApiClientPort {}

void main() {
  late _MockApiClient client;
  late ChannelsApi api;

  // The Channels tab is project-scoped — every meaningful list() call
  // happens against an active node. These helpers keep the tests
  // focused on response-shape parsing rather than param plumbing.
  const projectNode = ActiveNode(id: 'proj-a', type: ActiveNodeType.project);
  const projectPath = '/api/channels?nodeId=proj-a&nodeType=project';
  const groupNode = ActiveNode(id: 'grp-1', type: ActiveNodeType.group);
  const groupPath = '/api/channels?nodeId=grp-1&nodeType=group';

  setUp(() {
    client = _MockApiClient();
    api = ChannelsApi(client);
  });

  group('list()', () {
    test('short-circuits to empty when no active node is supplied', () async {
      // The server's /api/channels endpoint 400s without ?nodeId/?nodeType
      // (or the legacy ?projectId). Match the PWA mobile-web tab: don't
      // even send the request.
      final channels = await api.list();
      expect(channels, isEmpty);
      verifyNever(() => client.get(any()));
    });

    test('passes nodeId + nodeType=project for a project active node',
        () async {
      when(() => client.get(any())).thenAnswer((_) async => const []);

      await api.list(activeNode: projectNode);

      verify(() => client.get(projectPath)).called(1);
    });

    test('passes nodeType=group for a group active node', () async {
      when(() => client.get(any())).thenAnswer((_) async => const []);

      await api.list(activeNode: groupNode);

      verify(() => client.get(groupPath)).called(1);
    });

    test('parses { channels: [...] } shape', () async {
      when(() => client.get(projectPath)).thenAnswer(
        (_) async => {
          'channels': [
            {
              'id': 'ch-1',
              'name': 'general',
              'unreadCount': 3,
              'projectId': 'proj-a',
            },
            {
              'id': 'ch-2',
              'name': 'random',
              'unreadCount': 0,
              'projectId': 'proj-a',
            },
          ],
        },
      );

      final channels = await api.list(activeNode: projectNode);

      expect(channels, hasLength(2));
      expect(channels[0].id, 'ch-1');
      expect(channels[0].name, 'general');
      expect(channels[0].unreadCount, 3);
      expect(channels[0].projectId, 'proj-a');
      expect(channels[1].unreadCount, 0);
    });

    test('parses bare-array shape', () async {
      when(() => client.get(projectPath)).thenAnswer(
        (_) async => [
          {
            'id': 'ch-3',
            'name': 'announcements',
            'unreadCount': 1,
          },
        ],
      );

      final channels = await api.list(activeNode: projectNode);

      expect(channels, hasLength(1));
      expect(channels[0].id, 'ch-3');
      expect(channels[0].name, 'announcements');
      expect(channels[0].unreadCount, 1);
      expect(channels[0].projectId, isNull);
    });

    test('flattens { groups: [{ channels: [...] }] } server shape', () async {
      when(() => client.get(projectPath)).thenAnswer(
        (_) async => {
          'groups': [
            {
              'id': 'grp-1',
              'name': 'Channels',
              'channels': [
                {
                  'id': 'ch-1',
                  'name': 'general',
                  'unreadCount': 5,
                  'projectId': 'proj-a',
                },
                {
                  'id': 'ch-2',
                  'name': 'random',
                  'unreadCount': 0,
                  'projectId': 'proj-a',
                },
              ],
            },
            {
              'id': 'grp-2',
              'name': 'Direct Messages',
              'channels': [
                {
                  'id': 'ch-3',
                  'name': 'alice',
                  'unreadCount': 2,
                  'projectId': 'proj-a',
                },
              ],
            },
          ],
        },
      );

      final channels = await api.list(activeNode: projectNode);

      expect(channels, hasLength(3));
      expect(channels[0].id, 'ch-1');
      expect(channels[1].id, 'ch-2');
      expect(channels[2].id, 'ch-3');
      expect(channels[2].name, 'alice');
      expect(channels[2].unreadCount, 2);
    });

    test('defaults unreadCount to 0 when missing', () async {
      when(() => client.get(projectPath)).thenAnswer(
        (_) async => {
          'channels': [
            {
              'id': 'ch-1',
              'name': 'general',
            },
          ],
        },
      );

      final channels = await api.list(activeNode: projectNode);
      expect(channels, hasLength(1));
      expect(channels[0].unreadCount, 0);
    });

    test('returns empty list on unrecognised shape', () async {
      when(() => client.get(projectPath))
          .thenAnswer((_) async => 'unexpected');

      final channels = await api.list(activeNode: projectNode);
      expect(channels, isEmpty);
    });

    test('returns empty list on empty groups response', () async {
      when(() => client.get(projectPath)).thenAnswer(
        (_) async => {'groups': <dynamic>[]},
      );

      final channels = await api.list(activeNode: projectNode);
      expect(channels, isEmpty);
    });
  });

  group('archive()', () {
    test('DELETEs /api/channels/:id', () async {
      when(() => client.delete(any())).thenAnswer((_) async {});

      await api.archive('ch-42');

      verify(() => client.delete('/api/channels/ch-42')).called(1);
    });
  });
}
