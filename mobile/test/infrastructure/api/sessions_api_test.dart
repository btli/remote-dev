import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:remote_dev/application/ports/api_client_port.dart';
import 'package:remote_dev/domain/session_summary.dart';
import 'package:remote_dev/infrastructure/api/sessions_api.dart';

class _MockApiClient extends Mock implements ApiClientPort {}

void main() {
  late _MockApiClient client;
  late SessionsApi api;

  setUp(() {
    client = _MockApiClient();
    api = SessionsApi(client);
  });

  group('list()', () {
    test('parses wrapped {sessions: [...]} response', () async {
      when(() => client.get('/api/sessions')).thenAnswer(
        (_) async => {
          'sessions': [
            {
              'id': 'sess-1',
              'name': 'Main',
              'tmuxSessionName': 'rdv-1',
              'status': 'active',
              'projectId': 'proj-a',
              'agentActivityStatus': 'running',
            },
            {
              'id': 'sess-2',
              'name': 'Backup',
              'tmuxSessionName': 'rdv-2',
              'status': 'suspended',
              'projectId': null,
              'agentActivityStatus': null,
            },
          ],
        },
      );

      final sessions = await api.list();

      expect(sessions, hasLength(2));
      expect(sessions[0].id, 'sess-1');
      expect(sessions[0].name, 'Main');
      expect(sessions[0].status, SessionStatus.active);
      expect(sessions[0].projectId, 'proj-a');
      expect(sessions[0].activity, AgentActivityStatus.running);
      expect(sessions[1].status, SessionStatus.suspended);
      expect(sessions[1].projectId, isNull);
      expect(sessions[1].activity, AgentActivityStatus.none);
    });

    test('parses bare-array response', () async {
      when(() => client.get('/api/sessions')).thenAnswer(
        (_) async => [
          {
            'id': 'sess-3',
            'name': 'Test',
            'tmuxSessionName': 'rdv-3',
            'status': 'active',
            'projectId': null,
          },
        ],
      );

      final sessions = await api.list();
      expect(sessions, hasLength(1));
      expect(sessions[0].status, SessionStatus.active);
    });

    test('drops closed and trashed sessions, keeps active + suspended',
        () async {
      // Mirror the PWA mobile-web Sessions tab, which only displays
      // sessions in `active` or `suspended` status. The server can hand
      // back `closed` (terminal) and `trashed` (soft-deleted) entries
      // too — neither belongs in the mobile picker.
      when(() => client.get('/api/sessions')).thenAnswer(
        (_) async => {
          'sessions': [
            {
              'id': 'sess-active',
              'name': 'A',
              'tmuxSessionName': 'rdv-a',
              'status': 'active',
            },
            {
              'id': 'sess-suspended',
              'name': 'S',
              'tmuxSessionName': 'rdv-s',
              'status': 'suspended',
            },
            {
              'id': 'sess-closed',
              'name': 'C',
              'tmuxSessionName': 'rdv-c',
              'status': 'closed',
            },
            {
              'id': 'sess-trashed',
              'name': 'T',
              'tmuxSessionName': 'rdv-t',
              'status': 'trashed',
            },
          ],
        },
      );

      final sessions = await api.list();
      final ids = sessions.map((s) => s.id).toList();
      expect(ids, equals(['sess-active', 'sess-suspended']));
      expect(
        sessions.every(
          (s) =>
              s.status == SessionStatus.active ||
              s.status == SessionStatus.suspended,
        ),
        isTrue,
      );
    });

    test('throws on unexpected shape', () async {
      when(() => client.get('/api/sessions')).thenAnswer((_) async => 'oops');
      expect(api.list(), throwsA(isA<FormatException>()));
    });

    test('defaults activity to none when agentActivityStatus is missing',
        () async {
      when(() => client.get('/api/sessions')).thenAnswer(
        (_) async => {
          'sessions': [
            {
              'id': 'sess-4',
              'name': 'Plain shell',
              'tmuxSessionName': 'rdv-4',
              'status': 'active',
              'projectId': 'p1',
            },
          ],
        },
      );

      final sessions = await api.list();
      expect(sessions[0].activity, AgentActivityStatus.none);
    });

    test('maps subagent / compacting / ended activity statuses', () async {
      when(() => client.get('/api/sessions')).thenAnswer(
        (_) async => {
          'sessions': [
            {
              'id': 'sess-sub',
              'name': 'Subagent',
              'tmuxSessionName': 'rdv-sub',
              'status': 'active',
              'agentActivityStatus': 'subagent',
            },
            {
              'id': 'sess-comp',
              'name': 'Compacting',
              'tmuxSessionName': 'rdv-comp',
              'status': 'active',
              'agentActivityStatus': 'compacting',
            },
            {
              'id': 'sess-end',
              'name': 'Ended',
              'tmuxSessionName': 'rdv-end',
              'status': 'active',
              'agentActivityStatus': 'ended',
            },
          ],
        },
      );

      final sessions = await api.list();
      expect(sessions[0].activity, AgentActivityStatus.subagent);
      expect(sessions[1].activity, AgentActivityStatus.compacting);
      expect(sessions[2].activity, AgentActivityStatus.ended);
    });
  });

  group('suspend()', () {
    test('POSTs to /api/sessions/:id/suspend with empty body', () async {
      when(() => client.post(any(), body: any(named: 'body')))
          .thenAnswer((_) async => null);

      await api.suspend('sess-1');

      verify(
        () => client.post(
          '/api/sessions/sess-1/suspend',
          body: const <String, dynamic>{},
        ),
      ).called(1);
    });
  });

  group('close()', () {
    test('DELETEs /api/sessions/:id', () async {
      when(() => client.delete(any())).thenAnswer((_) async {});

      await api.close('sess-2');

      verify(() => client.delete('/api/sessions/sess-2')).called(1);
    });
  });
}
