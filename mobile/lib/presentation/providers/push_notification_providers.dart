import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:remote_dev/app.dart';
import 'package:remote_dev/infrastructure/push/push_notification_service.dart';
import 'package:remote_dev/presentation/providers/server_config_providers.dart';

/// Push notification service — only available when authenticated.
/// Kept alive so the onTokenRefresh listener survives provider disposal.
final pushNotificationServiceProvider =
    Provider<PushNotificationService?>((ref) {
  ref.keepAlive();
  final client = ref.watch(remoteDevClientProvider);
  if (client == null) return null;
  final storage = ref.watch(secureStorageProvider);
  final router = ref.watch(routerProvider);
  return PushNotificationService(
    client: client,
    storage: storage,
    router: router,
  );
});

/// Initializes push notifications after login.
/// Invalidate this provider to re-register (e.g., on token refresh).
final pushRegistrationProvider = FutureProvider<bool>((ref) async {
  ref.keepAlive();
  final pushService = ref.watch(pushNotificationServiceProvider);
  if (pushService == null) return false;
  return pushService.initialize();
});
