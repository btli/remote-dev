import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:remote_dev/application/ports/api_client_port.dart';
import 'package:remote_dev/domain/active_node.dart';
import 'package:remote_dev/infrastructure/api/preferences_api.dart';

class _MockClient extends Mock implements ApiClientPort {}

void main() {
  setUpAll(() {
    registerFallbackValue(<String, dynamic>{});
  });

  late _MockClient client;
  late PreferencesApi api;

  setUp(() {
    client = _MockClient();
    api = PreferencesApi(client);
  });

  group('getActiveNode()', () {
    test('prefers pinnedNode over activeNode when both are set', () async {
      when(() => client.get('/api/preferences')).thenAnswer(
        (_) async => {
          'userSettings': {
            'activeNodeId': 'active-id',
            'activeNodeType': 'project',
            'pinnedNodeId': 'pinned-id',
            'pinnedNodeType': 'group',
          },
          'activeFolder': {'id': 'pinned-id', 'name': 'Pinned'},
        },
      );

      final node = await api.getActiveNode();

      expect(node, isNotNull);
      expect(node!.id, 'pinned-id');
      expect(node.type, ActiveNodeType.group);
      expect(node.name, 'Pinned');
    });

    test('falls back to activeNode when pinned is empty', () async {
      when(() => client.get('/api/preferences')).thenAnswer(
        (_) async => {
          'userSettings': {
            'activeNodeId': 'active-id',
            'activeNodeType': 'project',
            'pinnedNodeId': null,
            'pinnedNodeType': null,
          },
          'activeFolder': {'id': 'active-id', 'name': 'My project'},
        },
      );

      final node = await api.getActiveNode();
      expect(node!.id, 'active-id');
      expect(node.type, ActiveNodeType.project);
      expect(node.name, 'My project');
    });

    test('returns null when no active or pinned node is set', () async {
      when(() => client.get('/api/preferences')).thenAnswer(
        (_) async => {
          'userSettings': {
            'activeNodeId': null,
            'activeNodeType': null,
            'pinnedNodeId': null,
            'pinnedNodeType': null,
          },
          'activeFolder': null,
        },
      );

      expect(await api.getActiveNode(), isNull);
    });

    test('omits name when activeFolder.id does not match the resolved id',
        () async {
      // Defensive: server may return an activeFolder pointing at the
      // pinned node while we resolved the active one (or vice versa).
      // We shouldn't show a misleading name in that case.
      when(() => client.get('/api/preferences')).thenAnswer(
        (_) async => {
          'userSettings': {
            'activeNodeId': 'other-id',
            'activeNodeType': 'project',
            'pinnedNodeId': null,
            'pinnedNodeType': null,
          },
          'activeFolder': {'id': 'mismatch', 'name': 'Wrong'},
        },
      );

      final node = await api.getActiveNode();
      expect(node!.id, 'other-id');
      expect(node.name, isNull);
    });

    test('returns null when the response shape is unexpected', () async {
      when(() => client.get('/api/preferences'))
          .thenAnswer((_) async => 'oops');
      expect(await api.getActiveNode(), isNull);
    });

    test('returns null when nodeType is not a known enum value', () async {
      when(() => client.get('/api/preferences')).thenAnswer(
        (_) async => {
          'userSettings': {
            'activeNodeId': 'x',
            'activeNodeType': 'session',
          },
        },
      );
      expect(await api.getActiveNode(), isNull);
    });
  });

  group('setActiveNode()', () {
    test('POSTs nodeId/nodeType/pinned for a project selection', () async {
      when(() => client.post(any(), body: any(named: 'body')))
          .thenAnswer((_) async => null);

      await api.setActiveNode(
        nodeId: 'proj-1',
        nodeType: ActiveNodeType.project,
      );

      verify(
        () => client.post(
          '/api/preferences/active-node',
          body: {
            'nodeId': 'proj-1',
            'nodeType': 'project',
            'pinned': false,
          },
        ),
      ).called(1);
    });

    test('forwards pinned=true and serializes group type', () async {
      when(() => client.post(any(), body: any(named: 'body')))
          .thenAnswer((_) async => null);

      await api.setActiveNode(
        nodeId: 'grp-9',
        nodeType: ActiveNodeType.group,
        pinned: true,
      );

      verify(
        () => client.post(
          '/api/preferences/active-node',
          body: {
            'nodeId': 'grp-9',
            'nodeType': 'group',
            'pinned': true,
          },
        ),
      ).called(1);
    });

    test('sends both fields as null when clearing the selection', () async {
      // The server schema requires nodeId and nodeType to be present-or-
      // absent together. Passing null for both is the documented way to
      // clear the selection — verify we forward exactly that.
      when(() => client.post(any(), body: any(named: 'body')))
          .thenAnswer((_) async => null);

      await api.setActiveNode(nodeId: null, nodeType: null);

      verify(
        () => client.post(
          '/api/preferences/active-node',
          body: {
            'nodeId': null,
            'nodeType': null,
            'pinned': false,
          },
        ),
      ).called(1);
    });
  });
}
