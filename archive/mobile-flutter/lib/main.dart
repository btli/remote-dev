import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:uuid/uuid.dart';

import 'package:remote_dev/app.dart';
import 'package:remote_dev/domain/entities/server_config.dart';
import 'package:remote_dev/domain/value_objects/auth_method.dart';
import 'package:remote_dev/firebase_options.dart';
import 'package:remote_dev/infrastructure/push/push_notification_service.dart';
import 'package:remote_dev/infrastructure/storage/secure_storage_service.dart';
import 'package:remote_dev/infrastructure/storage/server_config_store.dart';
import 'package:remote_dev/infrastructure/storage/server_scoped_storage.dart';
import 'package:remote_dev/presentation/providers/server_config_providers.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  final results = await Future.wait([
    Firebase.initializeApp(options: DefaultFirebaseOptions.currentPlatform),
    SharedPreferences.getInstance(),
  ]);
  final prefs = results[1] as SharedPreferences;

  FirebaseMessaging.onBackgroundMessage(firebaseMessagingBackgroundHandler);

  await _migrateToMultiServer(prefs);

  SystemChrome.setSystemUIOverlayStyle(
    const SystemUiOverlayStyle(
      statusBarColor: Colors.transparent,
      statusBarIconBrightness: Brightness.light,
      systemNavigationBarColor: Colors.black,
      systemNavigationBarIconBrightness: Brightness.light,
    ),
  );

  runApp(
    ProviderScope(
      overrides: [
        sharedPreferencesProvider.overrideWithValue(prefs),
      ],
      child: const RemoteDevApp(),
    ),
  );
}

/// Migrates existing single-server credentials to multi-server format.
///
/// If old-style credentials exist (rdv_api_key, rdv_server_url) but no
/// server configs are saved, creates a "default" server config and copies
/// credentials to server-scoped keys.
Future<void> _migrateToMultiServer(SharedPreferences prefs) async {
  final store = ServerConfigStore(prefs);
  final existing = store.loadAll();
  if (existing.isNotEmpty) return;

  final storage = SecureStorageService();
  final hasOldCredentials = await storage.hasCredentials();
  if (!hasOldCredentials) return;

  final serverUrl = await storage.getServerUrl();
  final terminalPort = await storage.getTerminalPort();
  final apiKey = await storage.getApiKey();
  final userId = await storage.getUserId();
  final email = await storage.getUserEmail();
  final cfToken = await storage.getCfToken();

  if (serverUrl == null || apiKey == null) return;

  final serverId = const Uuid().v4();
  final config = ServerConfig(
    id: serverId,
    nickname: '',
    serverUrl: serverUrl,
    terminalPort: terminalPort ?? '6002',
    authMethod: cfToken != null ? const CfAccessAuth() : const ApiKeyAuth(),
    createdAt: DateTime.now(),
    lastConnectedAt: DateTime.now(),
  );

  await store.save(config);
  await store.setActiveServerId(serverId);

  final scopedStorage = ServerScopedStorage(
    storage: storage,
    serverId: serverId,
  );
  await scopedStorage.storeCredentials(
    apiKey: apiKey,
    userId: userId ?? '',
    email: email ?? '',
    cfToken: cfToken,
  );
}
