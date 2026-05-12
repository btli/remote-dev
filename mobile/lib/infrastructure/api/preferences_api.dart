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
    final pinnedId = settings['pinnedNodeId'];
    final pinnedType = settings['pinnedNodeType'];
    final activeId = settings['activeNodeId'];
    final activeType = settings['activeNodeType'];

    final String? id =
        (pinnedId is String && pinnedId.isNotEmpty) ? pinnedId : null;
    final String? typeStr =
        (pinnedType is String && pinnedType.isNotEmpty) ? pinnedType : null;
    final String? fallbackId =
        (activeId is String && activeId.isNotEmpty) ? activeId : null;
    final String? fallbackTypeStr =
        (activeType is String && activeType.isNotEmpty) ? activeType : null;

    final resolvedId = id ?? fallbackId;
    final resolvedTypeStr = typeStr ?? fallbackTypeStr;
    if (resolvedId == null || resolvedTypeStr == null) {
      return null;
    }

    final resolvedType = _parseType(resolvedTypeStr);
    if (resolvedType == null) {
      return null;
    }

    String? name;
    final activeFolder = raw['activeFolder'];
    if (activeFolder is Map<String, dynamic> &&
        activeFolder['id'] == resolvedId) {
      final n = activeFolder['name'];
      if (n is String && n.isNotEmpty) {
        name = n;
      }
    }

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
        'nodeType': nodeType == null ? null : _serializeType(nodeType),
        'pinned': pinned,
      },
    );
  }

  static ActiveNodeType? _parseType(String s) {
    switch (s) {
      case 'group':
        return ActiveNodeType.group;
      case 'project':
        return ActiveNodeType.project;
    }
    return null;
  }

  static String _serializeType(ActiveNodeType t) {
    switch (t) {
      case ActiveNodeType.group:
        return 'group';
      case ActiveNodeType.project:
        return 'project';
    }
  }
}
