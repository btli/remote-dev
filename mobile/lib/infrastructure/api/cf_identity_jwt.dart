import 'dart:convert';

/// Default clock-skew guard: a `CF_Authorization` identity JWT is treated as
/// expired once it is within this window of its `exp`. Prevents sending a
/// cookie the Cloudflare edge would reject as (about to be) stale.
const Duration kCfIdentitySkew = Duration(seconds: 30);

/// Whether [jwt] is a decodable Cloudflare Access identity token whose `exp`
/// claim is still comfortably in the future.
///
/// This is the deterministic, CLIENT-SIDE discriminator the [CfAuthInterceptor]
/// uses to decide whether to rely on the `CF_Authorization` identity cookie or
/// fall back to the (non-identity) service-token headers. It matters because
/// Cloudflare Access evaluates **Service Auth policies FIRST** and stops at the
/// first match: if a request carries BOTH a valid identity cookie AND the
/// service-token headers, the Service Auth policy wins and the origin receives
/// the NON-identity JWT (`common_name`, no `email`). So the app must never send
/// both — it decides here, per request, which single edge credential to present:
///
///   * fresh identity cookie  → send ONLY the cookie (edge admits WITH identity)
///   * absent / expired / bad → send ONLY the service-token headers (edge admits
///     non-identity; the origin re-authenticates via the Bearer API key).
///
/// Returns `true` ONLY when [jwt]:
///   * is non-null / non-empty, AND
///   * has at least two `.`-separated segments (header.payload[.signature]), AND
///   * whose payload base64url-decodes to a JSON object carrying a numeric
///     `exp` (seconds since the Unix epoch), AND
///   * that `exp` is strictly AFTER `now + skew`.
///
/// Returns `false` for a null/empty, structurally-malformed, non-JSON,
/// `exp`-less, or expired token — the token is only ever READ here, never
/// verified (the `exp` claim is public; signature verification is Cloudflare's
/// job at the edge). A malformed token is deliberately treated as expired so a
/// corrupt cookie falls back to the service-token path rather than throwing.
///
/// [now] is injectable for tests; it defaults to the current instant. [skew]
/// defaults to [kCfIdentitySkew].
bool cfCookieIsFreshIdentity(
  String? jwt, {
  DateTime? now,
  Duration skew = kCfIdentitySkew,
}) {
  final expSeconds = _jwtExpSeconds(jwt);
  if (expSeconds == null) return false;
  final exp = DateTime.fromMillisecondsSinceEpoch(
    expSeconds * 1000,
    isUtc: true,
  );
  final threshold = (now ?? DateTime.now()).add(skew);
  return exp.isAfter(threshold);
}

/// Extract the integer `exp` (seconds since epoch) from a JWT's payload
/// segment, or `null` when the token is null/empty, has fewer than two
/// segments, does not base64url-decode to UTF-8 JSON, is not a JSON object, or
/// carries no coercible numeric `exp`. Never throws.
int? _jwtExpSeconds(String? jwt) {
  if (jwt == null || jwt.isEmpty) return null;
  final segments = jwt.split('.');
  if (segments.length < 2) return null;
  try {
    final payloadBytes = base64Url.decode(_padBase64(segments[1]));
    final decoded = jsonDecode(utf8.decode(payloadBytes));
    if (decoded is! Map) return null;
    final exp = decoded['exp'];
    if (exp is int) return exp;
    if (exp is double) return exp.toInt();
    if (exp is String) return int.tryParse(exp);
    return null;
  } catch (_) {
    // Malformed base64url / non-UTF-8 / invalid JSON → treat as undecodable.
    return null;
  }
}

/// Restore the `=` padding that JWTs strip from their base64url segments so
/// [base64Url.decode] (which requires a length that is a multiple of 4) accepts
/// the input. base64url already uses the URL-safe `-`/`_` alphabet, so no
/// character translation is needed.
String _padBase64(String input) {
  final remainder = input.length % 4;
  if (remainder == 0) return input;
  return input + ('=' * (4 - remainder));
}
