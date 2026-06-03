import 'dart:convert';

import 'package:freezed_annotation/freezed_annotation.dart';

part 'auth_cookie.freezed.dart';
part 'auth_cookie.g.dart';

/// A named cookie carrying an authentication credential (e.g. a CF Access JWT).
///
/// Auth callbacks from the server can carry a list of cookies encoded as a
/// base64url JSON array in the `authCookies` query parameter. The mobile app
/// decodes these via [decodeAuthCookies] and passes them through to the
/// request interceptor, which injects them as `Cookie:` headers so that
/// CF Access / OIDC tunnels admit the requests.
@freezed
class AuthCookie with _$AuthCookie {
  const factory AuthCookie({
    required String name,
    required String value,
    required String path,
  }) = _AuthCookie;

  factory AuthCookie.fromJson(Map<String, dynamic> json) =>
      _$AuthCookieFromJson(json);
}

/// Decodes a base64url-encoded JSON list of auth cookies from the
/// `authCookies` query parameter of a `remotedev://auth/callback` deep link.
///
/// Normalises base64url padding before decoding so callers can pass either
/// padded or unpadded strings. Returns an empty list on any error (malformed
/// base64, invalid JSON, wrong JSON shape, missing required fields) so the
/// caller can treat a decoding failure as "no cookies" without crashing.
List<AuthCookie> decodeAuthCookies(String b64url) {
  if (b64url.isEmpty) return [];
  try {
    // Normalise base64url padding: add '=' chars so length is a multiple of 4.
    final rem = b64url.length % 4;
    final padded = rem == 0 ? b64url : '$b64url${'=' * (4 - rem)}';
    final bytes = base64Url.decode(padded);
    final decoded = jsonDecode(utf8.decode(bytes));
    if (decoded is! List) return [];
    return decoded
        .cast<Map<String, dynamic>>()
        .map(AuthCookie.fromJson)
        .toList();
  } catch (_) {
    return [];
  }
}
