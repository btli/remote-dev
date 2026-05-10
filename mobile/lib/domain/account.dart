/// Active user/session account info returned by `/api/auth/session`.
///
/// NextAuth typically returns `{user: {email, name, image}, expires}`. For
/// CF Access deployments, `email` is sourced from the resolved CF identity
/// by the server middleware. This model intentionally keeps only the fields
/// the mobile Account screen displays, decoded from the wrapped or bare
/// shape via [Account.fromJson].
///
/// Plain immutable class instead of freezed — the model is small, has no
/// union/copyWith needs, and avoids the extra build_runner step.
class Account {
  const Account({
    required this.email,
    this.name,
    this.image,
  });

  final String email;
  final String? name;
  final String? image;

  /// Decode from the `/api/auth/session` payload. Accepts both the wrapped
  /// `{user: {...}, expires}` shape (NextAuth default) and a bare `{email,
  /// name, image}` shape, so the call site doesn't have to care.
  ///
  /// Throws [FormatException] if neither shape contains an `email`.
  factory Account.fromJson(Map<String, dynamic> json) {
    final user = json['user'];
    final source = user is Map<String, dynamic> ? user : json;

    final email = source['email'];
    if (email is! String || email.isEmpty) {
      throw const FormatException(
        'Account.fromJson: missing or empty `email` field',
      );
    }
    final name = source['name'];
    final image = source['image'];
    return Account(
      email: email,
      name: name is String && name.isNotEmpty ? name : null,
      image: image is String && image.isNotEmpty ? image : null,
    );
  }

  Map<String, dynamic> toJson() => {
        'email': email,
        if (name != null) 'name': name,
        if (image != null) 'image': image,
      };

  @override
  bool operator ==(Object other) {
    if (identical(this, other)) return true;
    return other is Account &&
        other.email == email &&
        other.name == name &&
        other.image == image;
  }

  @override
  int get hashCode => Object.hash(email, name, image);

  @override
  String toString() => 'Account(email: $email, name: $name, image: $image)';
}
