import 'package:flutter_riverpod/flutter_riverpod.dart';

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

/// Manages authentication state by checking secure storage for credentials.
class AuthNotifier extends StateNotifier<AuthState> {
  AuthNotifier(this._ref) : super(const AuthLoading()) {
    checkStoredCredentials();
  }

  final Ref _ref;

  /// Check if valid credentials exist in secure storage.
  Future<void> checkStoredCredentials() async {
    state = const AuthLoading();
    final storage = _ref.read(secureStorageProvider);
    final hasCredentials = await storage.hasCredentials();

    if (hasCredentials) {
      final serverUrl = await storage.getServerUrl();
      final email = await storage.getUserEmail();
      state = Authenticated(
        serverUrl: serverUrl ?? '',
        email: email,
      );
    } else {
      state = const Unauthenticated();
    }
  }

  /// Called after successful login to transition to authenticated state.
  void loginCompleted() {
    // Invalidate server config so it re-reads from storage
    _ref.invalidate(serverConfigProvider);
    checkStoredCredentials();
  }

  /// Sign out: clear storage and transition to unauthenticated.
  Future<void> signOut() async {
    final storage = _ref.read(secureStorageProvider);
    await storage.clearAll();
    _ref.invalidate(serverConfigProvider);
    state = const Unauthenticated();
  }
}

final authNotifierProvider =
    StateNotifierProvider<AuthNotifier, AuthState>((ref) {
  return AuthNotifier(ref);
});
