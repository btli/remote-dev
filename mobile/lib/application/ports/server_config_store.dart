import '../../domain/server_config.dart';

abstract class ServerConfigStore {
  Future<List<ServerConfig>> loadAll();
  Future<ServerConfig?> loadActive();
  Future<void> setActive(String serverId);
  Future<void> upsert(ServerConfig config);
  Future<void> remove(String serverId);
}
