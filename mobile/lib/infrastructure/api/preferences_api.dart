import '../../application/ports/api_client_port.dart';
import '../../application/ports/preferences_port.dart';
import '../../domain/active_node.dart';

/// HTTP implementation of [PreferencesPort] hitting Remote Dev's
/// `/api/preferences` and `/api/preferences/active-node` endpoints.
class PreferencesApi implements PreferencesPort {
  PreferencesApi(this._client);

  final ApiClientPort _client;

  @override
  Future<ActiveNode?> getActiveNode() async {
    final raw = await _client.get('/api/preferences');
    if (raw is! Map<String, dynamic>) {
      return null;
    }

    // Settings live under `userSettings`; `activeFolder` (when set)
    // gives us the human-readable name to render in headers without a
    // second round-trip. The server returns
    // `{ userSettings: {...}, activeFolder: {id, name} | null, ... }`.
    final settings = raw['userSettings'];
    if (settings is! Map<String, dynamic>) {
      return null;
    }

    // Prefer the pinned node over the live active node — this matches
    // the PWA's behavior and the server's own GET handler (see
    // `src/app/api/preferences/route.ts`), which resolves the
    // active-folder lookup with `pinnedNodeId || activeNodeId`.
    final resolvedId = _nonEmptyString(settings['pinnedNodeId']) ??
        _nonEmptyString(settings['activeNodeId']);
    final resolvedTypeStr = _nonEmptyString(settings['pinnedNodeType']) ??
        _nonEmptyString(settings['activeNodeType']);
    if (resolvedId == null || resolvedTypeStr == null) {
      return null;
    }

    final resolvedType = _parseType(resolvedTypeStr);
    if (resolvedType == null) {
      return null;
    }

    final activeFolder = raw['activeFolder'];
    final name = (activeFolder is Map<String, dynamic> &&
            activeFolder['id'] == resolvedId)
        ? _nonEmptyString(activeFolder['name'])
        : null;

    return ActiveNode(id: resolvedId, type: resolvedType, name: name);
  }

  @override
  Future<void> setActiveNode({
    required String? nodeId,
    required ActiveNodeType? nodeType,
    bool pinned = false,
  }) async {
    // The server requires either both values present or both null —
    // pass them as `null` rather than omitting so the schema's
    // `(nodeId === null) !== (nodeType === null)` guard is satisfied.
    await _client.post(
      '/api/preferences/active-node',
      body: {
        'nodeId': nodeId,
        'nodeType': nodeType?.wireValue,
        'pinned': pinned,
      },
    );
  }

  static ActiveNodeType? _parseType(String s) => switch (s) {
        'group' => ActiveNodeType.group,
        'project' => ActiveNodeType.project,
        _ => null,
      };

  static String? _nonEmptyString(Object? v) =>
      (v is String && v.isNotEmpty) ? v : null;
}
