import 'package:collection/collection.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:remote_dev/domain/entities/server_config.dart';
import 'package:remote_dev/infrastructure/api/remote_dev_client.dart';
import 'package:remote_dev/infrastructure/storage/secure_storage_service.dart';
import 'package:remote_dev/infrastructure/storage/server_config_store.dart';
import 'package:remote_dev/infrastructure/storage/server_scoped_storage.dart';

/// SharedPreferences instance. Must be initialized in main.dart.
final sharedPreferencesProvider = Provider<SharedPreferences>((ref) {
  throw UnimplementedError(
    'sharedPreferencesProvider must be overridden at app startup',
  );
});

/// Singleton secure storage instance.
final secureStorageProvider = Provider<SecureStorageService>((ref) {
  return SecureStorageService();
});

/// Server config store (local persistence for server list).
final serverConfigStoreProvider = Provider<ServerConfigStore>((ref) {
  final prefs = ref.watch(sharedPreferencesProvider);
  return ServerConfigStore(prefs);
});

/// All saved server configurations.
/// Call ref.invalidate(serverListProvider) after adding/removing servers.
final serverListProvider = Provider<List<ServerConfig>>((ref) {
  final store = ref.watch(serverConfigStoreProvider);
  return store.loadAll();
});

/// Currently active server ID. Persisted in SharedPreferences.
final activeServerIdProvider = StateProvider<String?>((ref) {
  final store = ref.watch(serverConfigStoreProvider);
  return store.getActiveServerId();
});

/// The active server's configuration. Null when no server selected.
final activeServerConfigProvider = Provider<ServerConfig?>((ref) {
  final serverId = ref.watch(activeServerIdProvider);
  if (serverId == null) return null;
  final servers = ref.watch(serverListProvider);
  final match = servers.firstWhereOrNull((s) => s.id == serverId);
  if (match != null) return match;
  // Stale ID (server was deleted) — return null so router redirects to setup
  return null;
});

/// Secure storage scoped to the active server.
/// Returns null when no server is active.
final serverScopedStorageProvider = Provider<ServerScopedStorage?>((ref) {
  final config = ref.watch(activeServerConfigProvider);
  if (config == null) return null;
  final storage = ref.watch(secureStorageProvider);
  return ServerScopedStorage(storage: storage, serverId: config.id);
});

/// HTTP client for the active server's REST API.
/// Only available when a server is selected.
final remoteDevClientProvider = Provider<RemoteDevClient?>((ref) {
  final config = ref.watch(activeServerConfigProvider);
  if (config == null) return null;

  final storage = ref.watch(secureStorageProvider);
  return RemoteDevClient(
    storage: storage,
    baseUrl: config.serverUrl,
  );
});

// --- Legacy compatibility ---

/// Legacy ServerConfig shape used by existing code.
/// Bridges old single-server code to new multi-server architecture.
class ServerConfigLegacy {
  final String serverUrl;
  final String terminalPort;
  final String apiKey;
  final String? userId;
  final String? email;
  final ServerConfig _source;

  ServerConfigLegacy._({
    required this.serverUrl,
    required this.terminalPort,
    required this.apiKey,
    this.userId,
    this.email,
    required ServerConfig source,
  }) : _source = source;

  /// Delegates to the canonical ServerConfig.wsUrl implementation.
  String get wsUrl => _source.wsUrl;
}

/// Legacy provider that returns the old ServerConfig shape.
/// Existing code can continue using this until migrated.
final serverConfigProvider = FutureProvider<ServerConfigLegacy?>((ref) async {
  final config = ref.watch(activeServerConfigProvider);
  if (config == null) return null;

  final scopedStorage = ref.watch(serverScopedStorageProvider);
  if (scopedStorage == null) return null;

  final apiKey = await scopedStorage.getApiKey();
  if (apiKey == null) return null;

  final userId = await scopedStorage.getUserId();
  final email = await scopedStorage.getUserEmail();

  return ServerConfigLegacy._(
    serverUrl: config.serverUrl,
    terminalPort: config.terminalPort,
    apiKey: apiKey,
    userId: userId,
    email: email,
    source: config,
  );
});
