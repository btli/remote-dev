import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

import 'package:remote_dev/domain/entities/server_config.dart';

/// Local persistence for server configurations using SharedPreferences.
///
/// Stores server configs as a JSON list. Credentials (API keys, tokens)
/// are stored separately in [ServerScopedStorage] via flutter_secure_storage.
///
/// Caches the decoded list to avoid repeated JSON parsing on every read.
class ServerConfigStore {
  ServerConfigStore(this._prefs);

  final SharedPreferences _prefs;
  List<ServerConfig>? _cache;

  static const _serversKey = 'rdv_servers';
  static const _activeServerKey = 'rdv_active_server_id';

  /// Load all saved server configurations. Returns cached list if available.
  List<ServerConfig> loadAll() {
    if (_cache != null) return _cache!;

    final json = _prefs.getString(_serversKey);
    if (json == null) return _cache = [];

    final list = jsonDecode(json) as List<dynamic>;
    return _cache = list
        .map((e) => ServerConfig.fromJson(e as Map<String, dynamic>))
        .toList()
      ..sort((a, b) => a.sortOrder.compareTo(b.sortOrder));
  }

  /// Save a server configuration (create or update).
  Future<void> save(ServerConfig config) async {
    final servers = List<ServerConfig>.of(loadAll());
    final index = servers.indexWhere((s) => s.id == config.id);
    if (index >= 0) {
      servers[index] = config;
    } else {
      servers.add(config);
    }
    await _persist(servers);
  }

  /// Delete a server configuration by ID.
  Future<void> delete(String id) async {
    final servers = List<ServerConfig>.of(loadAll())
      ..removeWhere((s) => s.id == id);
    await _persist(servers);

    if (getActiveServerId() == id) {
      await setActiveServerId(servers.isNotEmpty ? servers.first.id : null);
    }
  }

  /// Reorder servers by providing ordered IDs.
  Future<void> reorder(List<String> orderedIds) async {
    final servers = loadAll();
    final reordered = <ServerConfig>[];
    for (var i = 0; i < orderedIds.length; i++) {
      final server = servers.firstWhere(
        (s) => s.id == orderedIds[i],
        orElse: () => throw StateError('Server not found: ${orderedIds[i]}'),
      );
      reordered.add(server.copyWith(sortOrder: i));
    }
    await _persist(reordered);
  }

  String? getActiveServerId() => _prefs.getString(_activeServerKey);

  Future<void> setActiveServerId(String? id) async {
    if (id == null) {
      await _prefs.remove(_activeServerKey);
    } else {
      await _prefs.setString(_activeServerKey, id);
    }
  }

  Future<void> _persist(List<ServerConfig> servers) async {
    _cache = List.of(servers);
    final json = jsonEncode(servers.map((s) => s.toJson()).toList());
    await _prefs.setString(_serversKey, json);
  }
}
