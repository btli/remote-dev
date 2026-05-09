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
            'status': 'closed',
            'projectId': null,
          },
        ],
      );

      final sessions = await api.list();
      expect(sessions, hasLength(1));
      expect(sessions[0].status, SessionStatus.closed);
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
