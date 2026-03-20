import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:remote_dev/infrastructure/api/remote_dev_client.dart';
import 'package:remote_dev/infrastructure/storage/secure_storage_service.dart';

/// Server connection configuration resolved from secure storage.
class ServerConfig {
  final String serverUrl;
  final String terminalPort;
  final String apiKey;
  final String? userId;
  final String? email;

  const ServerConfig({
    required this.serverUrl,
    required this.terminalPort,
    required this.apiKey,
    this.userId,
    this.email,
  });

  /// WebSocket URL derived from the server URL.
  String get wsUrl {
    final uri = Uri.parse(serverUrl);
    final wsScheme = uri.scheme == 'https' ? 'wss' : 'ws';
    return '$wsScheme://${uri.host}:$terminalPort';
  }
}

/// Singleton secure storage instance.
final secureStorageProvider = Provider<SecureStorageService>((ref) {
  return SecureStorageService();
});

/// Loads server config from secure storage. Refreshed after login/logout.
final serverConfigProvider = FutureProvider<ServerConfig?>((ref) async {
  final storage = ref.watch(secureStorageProvider);
  final hasCredentials = await storage.hasCredentials();
  if (!hasCredentials) return null;

  final serverUrl = await storage.getServerUrl();
  final terminalPort = await storage.getTerminalPort();
  final apiKey = await storage.getApiKey();
  final userId = await storage.getUserId();
  final email = await storage.getUserEmail();

  if (serverUrl == null || apiKey == null) return null;

  return ServerConfig(
    serverUrl: serverUrl,
    terminalPort: terminalPort ?? '6002',
    apiKey: apiKey,
    userId: userId,
    email: email,
  );
});

/// HTTP client for the Remote Dev API. Only available when authenticated.
final remoteDevClientProvider = Provider<RemoteDevClient?>((ref) {
  final configAsync = ref.watch(serverConfigProvider);
  final config = configAsync.valueOrNull;
  if (config == null) return null;

  final storage = ref.watch(secureStorageProvider);
  return RemoteDevClient(
    storage: storage,
    baseUrl: config.serverUrl,
  );
});
