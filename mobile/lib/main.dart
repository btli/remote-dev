import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'app.dart';
import 'application/ports/api_client_port.dart';
import 'application/state/active_connection.dart';
import 'application/state/reauth_signal_provider.dart';
import 'infrastructure/api/account_api.dart';
import 'infrastructure/api/agent_cli_api.dart';
import 'infrastructure/api/cf_auth_interceptor.dart' show AuthMaterial;
import 'infrastructure/api/channels_api.dart';
import 'infrastructure/api/github_accounts_api.dart';
import 'infrastructure/api/notifications_api.dart';
import 'infrastructure/api/preferences_api.dart';
import 'infrastructure/api/project_tree_api.dart';
import 'infrastructure/api/remote_dev_client.dart';
import 'infrastructure/api/sessions_api.dart';
import 'infrastructure/auth/mobile_callback_login_launcher.dart';
import 'infrastructure/biometric/biometric_settings_store.dart';
import 'infrastructure/biometric/local_auth_service.dart';
import 'infrastructure/deep_link/deep_link_stream_provider.dart';
import 'infrastructure/device/device_id_provider.dart';
import 'infrastructure/push/fcm_push_service.dart';
import 'infrastructure/push/push_token_registrar.dart';
import 'infrastructure/storage/flutter_secure_storage_port.dart';
import 'presentation/router/app_router.dart' show pushTokenRegistrarProvider;
import 'presentation/screens/biometric/biometric_lock_overlay.dart'
    show biometricPortProvider, biometricSettingsStoreProvider;
import 'presentation/screens/channels/channels_tab_screen.dart'
    show channelsApiProvider, preferencesApiProvider;
import 'presentation/screens/notifications/notifications_tab_screen.dart'
    show notificationsApiProvider;
import 'presentation/screens/profile/account_screen.dart'
    show accountApiProvider;
import 'presentation/screens/profile/github_accounts_screen.dart'
    show githubAccountsApiProvider;
import 'presentation/screens/sessions/new_session_sheet.dart'
    show agentCliApiProvider;
import 'presentation/screens/sessions/project_tree_sheet.dart'
    show projectTreeApiProvider;
import 'presentation/screens/sessions/sessions_tab_screen.dart'
    show sessionsApiProvider;
import 'presentation/screens/webview_host/session_route_host.dart'
    show
        activeWorkspaceProvider,
        hostWorkspaceStoreProvider,
        mobileCredentialsStoreProvider,
        secureStorageProvider;

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
  String toString() => 'No active server. Sign in via the server picker first.';
}

/// Build a silent-refresh callback that the [CfAuthInterceptor] will
/// invoke when it detects CF Access intervention (401/403, redirect to
/// `cloudflareaccess.com`, or 200 text/html). The callback drives the
/// same system-browser `/auth/mobile-callback` flow we use at initial
/// sign-in via [MobileCallbackLoginLauncher], persists the refreshed
/// credentials onto the host/workspace namespaces, and returns the new
/// [AuthMaterial] so Dio can replay the original request transparently.
///
/// When the browser's CF SSO session is still valid (the common case
/// — browser sessions typically outlive our stored JWT), the Custom Tab
/// flashes briefly and completes in <1s with no user interaction. Only
/// when the browser session is ALSO dead does the user need to type
/// credentials again.
///
/// [conn] is captured at client-construction time so a refresh can't
/// accidentally cross-bind credentials to a different workspace after the
/// user switches. The login runs against `origin + basePath` (== `origin`
/// for a migrated single-workspace config, where basePath is `''`).
///
/// Returning `null` signals genuine failure (user cancelled, timeout, etc.)
/// — the interceptor then falls through to `onReauthNeeded` so the UI routes
/// to `/reauth`.
Future<AuthMaterial?> Function() _buildWorkspaceRefreshAuth(
  Ref ref,
  ActiveConnection conn,
) {
  return () async {
    final launcher = MobileCallbackLoginLauncher(
      deepLinkStream: ref.read(deepLinkStreamProvider),
    );
    // Use loginInstance so OIDC callbacks (authCookies, no apiKey) are handled.
    final result =
        await launcher.loginInstance(serverUrl: Uri.parse(conn.effectiveUrl));
    if (result == null) return null;

    final creds = ref.read(mobileCredentialsStoreProvider);
    // Persist workspace auth cookies (OIDC session-token or CF JWT).
    await creds.setWorkspaceAuthCookies(
      conn.workspace.id,
      result.authCookies,
    );
    // apiKey is optional (null for OIDC).
    final apiKey = result.apiKey;
    if (apiKey != null && apiKey.isNotEmpty) {
      await creds.setWorkspaceApiKey(conn.workspace.id, apiKey);
    }
    // Legacy compat: refresh host cfToken when present in callback.
    final cf = result.cfToken;
    if (cf.isNotEmpty) {
      await creds.setHostCfToken(conn.host.id, cf);
    }
    return AuthMaterial(
      apiKey: apiKey,
      cookies: result.authCookies,
    );
  };
}

/// Internal: synchronous [ApiClientPort] bound to the current active
/// workspace (and its host).
///
/// Re-evaluates whenever [activeWorkspaceProvider] resolves to a different
/// connection, which transparently rebinds every dependent API provider.
/// The client reads the host-wide CF token via `getHostCfToken(host.id)`
/// and the per-workspace API key via `getWorkspaceApiKey(workspace.id)`.
final _apiClientProvider = Provider<ApiClientPort>((ref) {
  final conn = ref.watch(activeWorkspaceProvider).value;
  if (conn == null) {
    throw NoActiveServerError();
  }
  final storage = ref.watch(secureStorageProvider);
  return RemoteDevClient.forWorkspace(
    origin: conn.host.origin,
    basePath: conn.workspace.basePath,
    hostId: conn.host.id,
    workspaceId: conn.workspace.id,
    storage: storage,
    refreshAuth: _buildWorkspaceRefreshAuth(ref, conn),
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
    agentCliApiProvider.overrideWith(
      (ref) => AgentCliApi(ref.watch(_apiClientProvider)),
    ),
    projectTreeApiProvider.overrideWith(
      (ref) => ProjectTreeApi(ref.watch(_apiClientProvider)),
    ),
    channelsApiProvider.overrideWith(
      (ref) => ChannelsApi(ref.watch(_apiClientProvider)),
    ),
    preferencesApiProvider.overrideWith(
      (ref) => PreferencesApi(ref.watch(_apiClientProvider)),
    ),
    notificationsApiProvider.overrideWith(
      (ref) => NotificationsApi(ref.watch(_apiClientProvider)),
    ),
    accountApiProvider.overrideWith(
      (ref) => AccountApi(ref.watch(_apiClientProvider)),
    ),
    githubAccountsApiProvider.overrideWith(
      (ref) => GitHubAccountsApi(ref.watch(_apiClientProvider)),
    ),
    pushTokenRegistrarProvider.overrideWith(
      (ref) => PushTokenRegistrar(
        push: FcmPushService(),
        store: ref.watch(hostWorkspaceStoreProvider),
        credentials: ref.watch(mobileCredentialsStoreProvider),
        // Push registration is a best-effort background POST against EVERY
        // saved WORKSPACE; it must not trigger an interactive CF refresh on a
        // non-active workspace (no UI is mounted to drive the browser). We pass
        // NO `refreshAuth`, so `forWorkspace`'s default no-op refresh falls
        // through to a logged per-workspace failure — the desired behaviour
        // here. The client is base-path-aware (origin + ws.basePath) and reads
        // the per-workspace API key + host-wide CF cookie.
        clientFactory: (host, ws) => RemoteDevClient.forWorkspace(
          origin: host.origin,
          basePath: ws.basePath,
          hostId: host.id,
          workspaceId: ws.id,
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

  // Firebase must be initialized before registering the background handler.
  // FcmPushService.initialize() tolerates the duplicate initializeApp call.
  try {
    await Firebase.initializeApp();
  } catch (e) {
    debugPrint('[Push] Firebase.initializeApp failed in main: $e');
  }
  try {
    FirebaseMessaging.onBackgroundMessage(firebaseMessagingBackgroundHandler);
  } catch (e) {
    debugPrint('[Push] onBackgroundMessage registration failed: $e');
  }

  // Resolve the stable per-device UUID before runApp so the synchronous
  // pushTokenRegistrarProvider override can read it without going async.
  // First-call generates + persists; subsequent runs return the cached value.
  final storage = FlutterSecureStoragePort();
  final deviceId = await DeviceIdProvider(storage).get();

  // Build a ProviderContainer up-front so we can eagerly start the deep-link
  // listener before runApp. This ensures custom-scheme links delivered during
  // cold-start are routed correctly.
  final container = ProviderContainer(
    overrides: buildServerScopedOverrides(deviceId: deviceId),
  );

  // One-time migration of legacy `servers` → Host/Workspace hierarchy. Must
  // run before the first route resolves / before `activeWorkspaceProvider` is
  // first read so a migrated single-workspace user lands on their workspace.
  // Idempotent (guarded by a persisted schema_version) and non-destructive
  // (legacy keys are retained). On error we log and continue so the app still
  // launches — the migration can resume on the next cold start.
  try {
    await container
        .read(hostWorkspaceStoreProvider)
        .migrateLegacyServersIfNeeded();
  } catch (e) {
    debugPrint('[Migration] migrateLegacyServersIfNeeded failed: $e');
  }

  // Read for side effect — kicks off AppLinkListener.start().
  container.read(appLinkListenerProvider);
  // Read for side effect — wires FirebaseMessaging.onMessageOpenedApp and
  // getInitialMessage so notification taps navigate to the correct surface
  // and sync read-state with the server.
  container.read(notificationTapHandlerProvider);
  // Fire-and-forget: registers the FCM token with every saved server and
  // subscribes to refresh. See PushTokenRegistrar.start(). Surface failures
  // in logs rather than swallowing them with `unawaited`.
  container.read(pushTokenRegistrarProvider).start().then((ok) {
    if (!ok) debugPrint('[Push] registrar.start returned false; push disabled');
  }).catchError((Object e) {
    debugPrint('[Push] registrar.start threw: $e');
  });

  runApp(
    UncontrolledProviderScope(
      container: container,
      child: const RemoteDevApp(),
    ),
  );
}

/// Top-level FCM background message handler (must be top-level + entry-point).
///
/// Messages with a `notification` payload are displayed by the OS automatically,
/// so this handler is intentionally a no-op.
@pragma('vm:entry-point')
Future<void> firebaseMessagingBackgroundHandler(RemoteMessage message) async {}
