import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:remote_dev/presentation/providers/push_notification_providers.dart';
import 'package:remote_dev/presentation/providers/server_config_providers.dart';

/// Authentication state machine.
sealed class AuthState {
  const AuthState();
}

final class AuthLoading extends AuthState {
  const AuthLoading();
}

final class Authenticated extends AuthState {
  const Authenticated({required this.serverUrl, this.email});
  final String serverUrl;
  final String? email;
}

final class Unauthenticated extends AuthState {
  const Unauthenticated();
}

/// Manages authentication state scoped to the active server.
///
/// Checks the active server's scoped storage for credentials.
/// When no server is configured, transitions to Unauthenticated
/// (the router then redirects to server setup).
class AuthNotifier extends StateNotifier<AuthState> {
  AuthNotifier(this._ref) : super(const AuthLoading()) {
    checkStoredCredentials();
  }

  final Ref _ref;

  /// Check if valid credentials exist for the active server.
  Future<void> checkStoredCredentials() async {
    state = const AuthLoading();

    final config = _ref.read(activeServerConfigProvider);
    if (config == null) {
      state = const Unauthenticated();
      return;
    }

    final scopedStorage = _ref.read(serverScopedStorageProvider);
    if (scopedStorage == null) {
      state = const Unauthenticated();
      return;
    }

    final hasCredentials = await scopedStorage.hasCredentials();
    if (hasCredentials) {
      final email = await scopedStorage.getUserEmail();
      state = Authenticated(
        serverUrl: config.serverUrl,
        email: email,
      );
    } else {
      state = const Unauthenticated();
    }
  }

  /// Called after successful login to transition to authenticated state.
  ///
  /// Pass [serverUrl] and [email] directly to avoid provider timing issues —
  /// the provider graph may not have rebuilt yet after invalidations.
  Future<void> loginCompleted({String? serverUrl, String? email}) async {
    _ref.invalidate(serverConfigProvider);
    _ref.invalidate(serverListProvider);
    if (serverUrl != null) {
      state = Authenticated(serverUrl: serverUrl, email: email);
    } else {
      await checkStoredCredentials();
    }
    _ref.invalidate(pushRegistrationProvider);
  }

  /// Sign out from the active server only.
  Future<void> signOut() async {
    final pushService = _ref.read(pushNotificationServiceProvider);
    await pushService?.unregister();

    final scopedStorage = _ref.read(serverScopedStorageProvider);
    await scopedStorage?.clearAll();

    _ref.invalidate(serverConfigProvider);
    state = const Unauthenticated();
  }
}

final authNotifierProvider =
    StateNotifierProvider<AuthNotifier, AuthState>((ref) {
  return AuthNotifier(ref);
});
