import '../../application/ports/api_client_port.dart';
import '../../application/ports/sessions_port.dart';
import '../../domain/session_summary.dart';

class SessionsApi implements SessionsPort {
  SessionsApi(this._client);
  final ApiClientPort _client;

  @override
  Future<List<SessionSummary>> list() async {
    final raw = await _client.get('/api/sessions');
    final list = _extractSessions(raw);
    return list
        .map((m) => SessionSummary.fromJson(m))
        // Server returns sessions in the `trashed` soft-delete state too;
        // the web client filters them out at the rendering layer and the
        // mobile UI has no trash-management surface. Drop them here so
        // they never reach the picker / tabs.
        .where((s) => s.status != SessionStatus.trashed)
        .toList(growable: false);
  }

  @override
  Future<void> suspend(String id) async {
    await _client.post(
      '/api/sessions/$id/suspend',
      body: const <String, dynamic>{},
    );
  }

  @override
  Future<void> close(String id) async {
    await _client.delete('/api/sessions/$id');
  }

  @override
  Future<SessionSummary> create({
    required String name,
    required String terminalType,
    String? projectId,
    String? initialCommand,
  }) async {
    final raw = await _client.post(
      '/api/sessions',
      body: {
        'name': name,
        'terminalType': terminalType,
        if (projectId != null) 'projectId': projectId,
        if (initialCommand != null && initialCommand.isNotEmpty)
          'initialCommand': initialCommand,
      },
    );
    // Server returns either {session: {...}} wrapped or the raw object.
    if (raw is Map<String, dynamic>) {
      final candidate = raw['session'] is Map<String, dynamic>
          ? raw['session'] as Map<String, dynamic>
          : raw;
      return SessionSummary.fromJson(candidate);
    }
    throw StateError('Unexpected create-session response: $raw');
  }

  /// Server returns either `{ sessions: [...] }` (current shape) or a bare
  /// array. Accept both for resilience.
  List<Map<String, dynamic>> _extractSessions(dynamic raw) {
    if (raw is List) {
      return raw.cast<Map<String, dynamic>>();
    }
    if (raw is Map<String, dynamic>) {
      final inner = raw['sessions'];
      if (inner is List) {
        return inner.cast<Map<String, dynamic>>();
      }
    }
    throw const FormatException('Unexpected /api/sessions response shape');
  }
}
