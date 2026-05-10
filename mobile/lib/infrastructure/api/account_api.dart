import '../../application/ports/api_client_port.dart';
import '../../domain/account.dart';

/// Wraps the `/api/auth/session` endpoint into a typed [Account] fetch.
///
/// NextAuth returns `{user: {email, name, image}, expires}` when
/// authenticated, or an empty object `{}` / `null` when not. The API
/// client handles auth via [CfAuthInterceptor], so any call here that
/// fails 401 will trigger the global re-auth flow before throwing.
class AccountApi {
  AccountApi(this._client);

  final ApiClientPort _client;

  /// Fetch the current account. Throws [StateError] if the session
  /// payload is empty (i.e. user is not signed in to the active server),
  /// or [FormatException] if the response shape is unexpected.
  Future<Account> me() async {
    final raw = await _client.get('/api/auth/session');
    if (raw == null) {
      throw StateError('No active session on this server.');
    }
    if (raw is Map<String, dynamic>) {
      // NextAuth returns `{}` (an empty map) when there is no session.
      if (raw.isEmpty) {
        throw StateError('No active session on this server.');
      }
      return Account.fromJson(raw);
    }
    throw const FormatException(
      'Unexpected /api/auth/session response shape',
    );
  }
}
