import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'app.dart';
import 'application/ports/api_client_port.dart';
import 'application/state/reauth_signal_provider.dart';
import 'infrastructure/api/channels_api.dart';
import 'infrastructure/api/notifications_api.dart';
import 'infrastructure/api/project_tree_api.dart';
import 'infrastructure/api/remote_dev_client.dart';
import 'infrastructure/api/sessions_api.dart';
import 'infrastructure/biometric/biometric_settings_store.dart';
import 'infrastructure/biometric/local_auth_service.dart';
import 'infrastructure/device/device_id_provider.dart';
import 'infrastructure/push/fcm_push_service.dart';
import 'infrastructure/push/push_token_registrar.dart';
import 'infrastructure/storage/flutter_secure_storage_port.dart';
import 'presentation/router/app_router.dart' show pushTokenRegistrarProvider;
import 'presentation/screens/biometric/biometric_lock_overlay.dart'
    show biometricPortProvider, biometricSettingsStoreProvider;
import 'presentation/screens/channels/channels_tab_screen.dart'
    show channelsApiProvider;
import 'presentation/screens/notifications/notifications_tab_screen.dart'
    show notificationsApiProvider;
import 'presentation/screens/sessions/project_tree_sheet.dart'
    show projectTreeApiProvider;
import 'presentation/screens/sessions/sessions_tab_screen.dart'
    show sessionsApiProvider;
import 'presentation/screens/webview_host/session_route_host.dart'
    show activeServerProvider, secureStorageProvider, serverConfigStoreProvider;

/// Thrown by [_apiClientProvider] when no active server has been chosen.
///
/// The router's initial location is `/servers`, so users are expected to
/// pick a server before navigating to any screen that consumes one of the
/// API providers. The screens (`SessionsTabScreen`, `ChannelsTabScreen`,
/// `NotificationsTabScreen`) all wrap their data fetches with `AsyncValue`
/// error/retry views, so a stray read here surfaces a clear error rather
/// than a silent crash.
class NoActiveServerError extends Error {
  NoActiveServerError();

  @override
  String toString() =>
      'No active server. Sign in via the server picker first.';
}

/// Internal: synchronous [ApiClientPort] bound to the current active server.
///
/// Re-evaluates whenever [activeServerProvider] resolves to a different
/// server, which transparently rebinds every dependent API provider.
final _apiClientProvider = Provider<ApiClientPort>((ref) {
  final server = ref.watch(activeServerProvider).value;
  if (server == null) {
    throw NoActiveServerError();
  }
  final storage = ref.watch(secureStorageProvider);
  return RemoteDevClient(
    serverOrigin: Uri.parse(server.url),
    serverId: server.id,
    storage: storage,
    onReauthNeeded: () => ref.read(reauthSignalProvider.notifier).request(),
  );
});

/// Overrides for the deferred `*ApiProvider`s and `pushTokenRegistrarProvider`.
///
/// [deviceId] is resolved at app boot via [DeviceIdProvider] so the synchronous
/// [pushTokenRegistrarProvider] can be wired without converting it to a
/// FutureProvider. Tests can pass a stable string here.
///
/// Exposed so tests can apply the same wiring without duplicating the list.
List<Override> buildServerScopedOverrides({required String deviceId}) {
  return <Override>[
    sessionsApiProvider.overrideWith(
      (ref) => SessionsApi(ref.watch(_apiClientProvider)),
    ),
    projectTreeApiProvider.overrideWith(
      (ref) => ProjectTreeApi(ref.watch(_apiClientProvider)),
    ),
    channelsApiProvider.overrideWith(
      (ref) => ChannelsApi(ref.watch(_apiClientProvider)),
    ),
    notificationsApiProvider.overrideWith(
      (ref) => NotificationsApi(ref.watch(_apiClientProvider)),
    ),
    pushTokenRegistrarProvider.overrideWith(
      (ref) => PushTokenRegistrar(
        push: FcmPushService(),
        serverStore: ref.watch(serverConfigStoreProvider),
        clientFactory: (server) => RemoteDevClient(
          serverOrigin: Uri.parse(server.url),
          serverId: server.id,
          storage: ref.read(secureStorageProvider),
          onReauthNeeded: () =>
              ref.read(reauthSignalProvider.notifier).request(),
        ),
        deviceId: deviceId,
      ),
    ),
    biometricPortProvider.overrideWithValue(LocalAuthService()),
    biometricSettingsStoreProvider.overrideWith(
      (ref) => BiometricSettingsStore(ref.watch(secureStorageProvider)),
    ),
  ];
}

void main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // Resolve the stable per-device UUID before runApp so the synchronous
  // pushTokenRegistrarProvider override can read it without going async.
  // First-call generates + persists; subsequent runs return the cached value.
  final storage = FlutterSecureStoragePort();
  final deviceId = await DeviceIdProvider(storage).get();

  // Non-blocking push init — runs in the background; failures are logged
  // and don't prevent the UI from launching.
  Future<void>.microtask(() => FcmPushService().initialize());

  // Build a ProviderContainer up-front so we can eagerly start the deep-link
  // listener before runApp. This ensures custom-scheme links delivered during
  // cold-start are routed correctly.
  final container = ProviderContainer(
    overrides: buildServerScopedOverrides(deviceId: deviceId),
  );
  // Read for side effect — kicks off AppLinkListener.start().
  container.read(appLinkListenerProvider);

  runApp(
    UncontrolledProviderScope(
      container: container,
      child: const RemoteDevApp(),
    ),
  );
}
