/// A linked GitHub account exposed by `/api/github/accounts`.
///
/// The server returns each account as
/// `{providerAccountId, userId, login, displayName, avatarUrl, email,
///   isDefault, createdAt, updatedAt, needsReauth}`. The mobile UI only
/// needs an opaque id, the @login handle, an avatar URL, and the default
/// flag — everything else is stripped.
///
/// We accept both `id` and `providerAccountId` keys so the model survives
/// any future shape simplification on the server side.
///
/// Plain immutable class instead of freezed — small, no copyWith/union
/// surface, and avoids the build_runner dependency.
class GitHubAccount {
  const GitHubAccount({
    required this.id,
    required this.login,
    this.avatarUrl,
    required this.isDefault,
  });

  /// Stable identifier for PATCH/DELETE endpoints. In the current server
  /// implementation this is the GitHub numeric user ID as a string
  /// (a.k.a. `providerAccountId`).
  final String id;

  /// GitHub @username. Rendered with a leading `@` in the UI; we store
  /// the bare login here.
  final String login;

  /// GitHub avatar URL. May be missing or empty when the user has no
  /// avatar set; we normalize to `null` so call sites can branch with
  /// `account.avatarUrl == null` without also checking for empty strings.
  final String? avatarUrl;

  /// True iff this account is the user's current default. Exactly one
  /// account per user can be default at a time; the server guarantees
  /// this invariant on writes.
  final bool isDefault;

  /// Decode from the JSON shape returned by `/api/github/accounts`.
  ///
  /// Throws [FormatException] when neither `id` nor `providerAccountId`
  /// is present, or when `login` is missing — both are load-bearing for
  /// the UI (no id = can't PATCH/DELETE, no login = nothing to render).
  factory GitHubAccount.fromJson(Map<String, dynamic> json) {
    final rawId = json['id'] ?? json['providerAccountId'];
    if (rawId is! String || rawId.isEmpty) {
      throw const FormatException(
        'GitHubAccount.fromJson: missing `id`/`providerAccountId`',
      );
    }
    final login = json['login'];
    if (login is! String || login.isEmpty) {
      throw const FormatException(
        'GitHubAccount.fromJson: missing `login`',
      );
    }
    final avatar = json['avatarUrl'];
    return GitHubAccount(
      id: rawId,
      login: login,
      avatarUrl: avatar is String && avatar.isNotEmpty ? avatar : null,
      isDefault: json['isDefault'] as bool? ?? false,
    );
  }

  @override
  bool operator ==(Object other) {
    if (identical(this, other)) return true;
    return other is GitHubAccount &&
        other.id == id &&
        other.login == login &&
        other.avatarUrl == avatarUrl &&
        other.isDefault == isDefault;
  }

  @override
  int get hashCode => Object.hash(id, login, avatarUrl, isDefault);

  @override
  String toString() =>
      'GitHubAccount(id: $id, login: $login, isDefault: $isDefault)';
}
