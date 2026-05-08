import 'dart:convert';
import '../../application/ports/secure_storage_port.dart';
import '../../application/ports/server_config_store.dart';
import '../../domain/server_config.dart';

class ServerConfigStoreImpl implements ServerConfigStore {
  ServerConfigStoreImpl(this._storage);

  final SecureStoragePort _storage;

  static const _metaServerId = '__meta__';
  static const _serverListKey = 'servers';
  static const _activeServerKey = 'active_server_id';

  @override
  Future<List<ServerConfig>> loadAll() async {
    final raw = await _storage.read(_metaServerId, _serverListKey);
    if (raw == null || raw.isEmpty) return const [];
    final list = (jsonDecode(raw) as List).cast<Map<String, dynamic>>();
    return list.map(ServerConfig.fromJson).toList(growable: false);
  }

  @override
  Future<ServerConfig?> loadActive() async {
    final id = await _storage.read(_metaServerId, _activeServerKey);
    if (id == null) return null;
    final all = await loadAll();
    for (final cfg in all) {
      if (cfg.id == id) return cfg;
    }
    return null;
  }

  @override
  Future<void> setActive(String serverId) =>
      _storage.write(_metaServerId, _activeServerKey, serverId);

  @override
  Future<void> upsert(ServerConfig config) async {
    final list = await loadAll();
    final updated = [
      ...list.where((c) => c.id != config.id),
      config,
    ]..sort((a, b) => b.lastUsedAt.compareTo(a.lastUsedAt));
    await _storage.write(
      _metaServerId,
      _serverListKey,
      jsonEncode(updated.map((c) => c.toJson()).toList()),
    );
  }

  @override
  Future<void> remove(String serverId) async {
    final list = await loadAll();
    final updated = list.where((c) => c.id != serverId).toList();
    await _storage.write(
      _metaServerId,
      _serverListKey,
      jsonEncode(updated.map((c) => c.toJson()).toList()),
    );
    await _storage.deleteAll(serverId);
    final activeId = await _storage.read(_metaServerId, _activeServerKey);
    if (activeId == serverId) {
      if (updated.isNotEmpty) {
        await setActive(updated.first.id);
      } else {
        await _storage.delete(_metaServerId, _activeServerKey);
      }
    }
  }
}
