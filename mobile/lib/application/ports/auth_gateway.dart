import 'package:remote_dev/domain/errors/app_error.dart';

/// Result of a successful authentication.
class AuthResult {
  final String apiKey;
  final String userId;
  final String email;

  const AuthResult({
    required this.apiKey,
    required this.userId,
    required this.email,
  });
}

/// Abstract gateway for authentication operations.
abstract interface class AuthGateway {
  /// Exchange a Cloudflare Access JWT for an API key.
  Future<Result<AuthResult>> authenticateWithCfAccess(
    String serverUrl,
    String cfToken,
  );

  /// Validate and store a direct API key (for LAN connections).
  Future<Result<AuthResult>> authenticateWithApiKey(
    String serverUrl,
    String apiKey,
  );

  /// Clear stored credentials and sign out.
  Future<void> signOut();

  /// Check if stored credentials are still valid.
  Future<bool> hasValidCredentials();
}
