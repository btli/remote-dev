import '../../application/ports/api_client_port.dart';
import '../../domain/github_account.dart';

/// Wraps `/api/github/accounts` for the mobile profile screen.
///
/// The server returns either a bare `[...]` array or a wrapped
/// `{accounts: [...], folderBindings: {...}}` shape (the current
/// implementation uses the wrapped form). [list] accepts both so the
/// mobile client doesn't have to care if the server shape ever changes.
///
/// PATCH uses an action discriminator (`{action: "set-default"}`)
/// rather than a property-style body. We hide that detail behind a
/// typed [setDefault] method so callers only pass an account id.
class GitHubAccountsApi {
  GitHubAccountsApi(this._client);

  final ApiClientPort _client;

  /// Returns every GitHub account linked to the active server's user,
  /// in the order returned by the server (default-first by convention).
  ///
  /// Throws [FormatException] when the response shape is unrecognized.
  Future<List<GitHubAccount>> list() async {
    final raw = await _client.get('/api/github/accounts');
    final list = _extractAccounts(raw);
    return list
        .map((m) => GitHubAccount.fromJson(m))
        .toList(growable: false);
  }

  /// Marks [id] as the user's default GitHub account. The server
  /// guarantees the previous default is automatically unset.
  Future<void> setDefault(String id) async {
    await _client.patch(
      '/api/github/accounts/$id',
      body: const {'action': 'set-default'},
    );
  }

  /// Unlinks [id] from the active server's user. Irreversible — the
  /// caller is expected to confirm with the user before invoking.
  Future<void> unlink(String id) async {
    await _client.delete('/api/github/accounts/$id');
  }

  List<Map<String, dynamic>> _extractAccounts(dynamic raw) {
    if (raw is List) {
      return raw.cast<Map<String, dynamic>>();
    }
    if (raw is Map<String, dynamic>) {
      final inner = raw['accounts'];
      if (inner is List) {
        return inner.cast<Map<String, dynamic>>();
      }
    }
    throw const FormatException(
      'Unexpected /api/github/accounts response shape',
    );
  }
}
