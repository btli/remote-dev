import 'dart:convert';

import 'package:flutter/foundation.dart' show immutable;

/// Parsed result of scanning a Remote Dev provisioning QR code.
///
/// Two shapes are understood, distinguished purely by the decoded JSON:
///
///  - **Typed envelope** — a JSON object carrying a `type` string. The only
///    type currently understood is `rdv.cfServiceToken` (version 1), which
///    provisions a per-host Cloudflare Access **service token** (the
///    `CF-Access-Client-Id` / `CF-Access-Client-Secret` pair). Unknown types or
///    versions are rejected with a friendly [QrPayloadError]. This is the
///    forward-looking format: new payload kinds add a new `type` without
///    breaking older apps (which reject what they don't understand).
///
///  - **Legacy server payload** — the pre-existing `{url, port, apiKey}` shape
///    the web Settings → Mobile panel already emits (it has NO `type` field).
///    Recognised by the presence of `url` + `apiKey` and the ABSENCE of `type`.
///    Kept working for back-compat so existing QR codes still provision a
///    server.
///
/// Parse a scanned string with [QrPayload.parse]; it returns a concrete subtype
/// on success or throws [QrPayloadError] (whose message is safe to surface to
/// the user) on any malformed / unsupported input.
///
/// SECURITY: subtypes that carry a secret (e.g. [CfServiceTokenPayload]) do NOT
/// override [toString] with a value-revealing form — the inherited identity-only
/// `Object.toString` is intentional so a secret can never leak via logging,
/// interpolation, or an exception message. Do not add a revealing `toString`.
@immutable
sealed class QrPayload {
  const QrPayload();

  /// The `type` discriminator for the CF service-token envelope.
  static const cfServiceTokenType = 'rdv.cfServiceToken';

  /// The only envelope version this build understands.
  static const supportedVersion = 1;

  /// Parse a raw scanned QR string into a typed [QrPayload].
  ///
  /// Throws [QrPayloadError] with a user-facing message when [raw] is not valid
  /// JSON, is not a JSON object, declares an unknown `type`/version, or is
  /// missing required fields. Never throws any other exception type, so callers
  /// can render `e.message` directly.
  static QrPayload parse(String raw) {
    final Object? decoded;
    try {
      decoded = jsonDecode(raw.trim());
    } on FormatException {
      throw const QrPayloadError(
        "This QR code isn't a Remote Dev credential.",
      );
    }

    if (decoded is! Map<String, dynamic>) {
      throw const QrPayloadError(
        "This QR code isn't a Remote Dev credential.",
      );
    }

    // The PRESENCE of a `type` key (even `null`) marks a typed envelope — the
    // legacy payload is defined by the ABSENCE of `type`. Routing on
    // containsKey (not `!= null`) means a malformed `{"type":null,...}` can
    // never be misread as legacy and is rejected by the envelope validator.
    if (decoded.containsKey('type')) {
      return _parseEnvelope(decoded);
    }

    // No `type` key => legacy server-provisioning payload. Requires url + apiKey.
    if (decoded['url'] is String && decoded['apiKey'] is String) {
      return LegacyServerPayload._fromJson(decoded);
    }

    throw const QrPayloadError(
      "This QR code isn't a Remote Dev credential.",
    );
  }

  static QrPayload _parseEnvelope(Map<String, dynamic> json) {
    // `type` must be a present, non-null string. (containsKey routed us here,
    // so a null/non-string value is a malformed envelope, not legacy.)
    final type = json['type'];
    if (type is! String || type != cfServiceTokenType) {
      // SECURITY: never interpolate the scanned `type` value into a message —
      // it is attacker-controlled and the scanner renders parser messages
      // verbatim. A value-free message avoids reflecting hostile content.
      throw const QrPayloadError('Unsupported QR code type.');
    }

    // Version gate: only v1 is understood. A missing version is treated as
    // incompatible rather than assumed-v1 so a future bump is fail-safe.
    final version = json['v'];
    if (version != supportedVersion) {
      throw const QrPayloadError(
        'This QR code was made by a newer version of Remote Dev. '
        'Update the app and try again.',
      );
    }

    return CfServiceTokenPayload._fromJson(json);
  }
}

/// Typed envelope (`type: "rdv.cfServiceToken"`, `v: 1`) provisioning a per-host
/// Cloudflare Access service token.
///
/// SECURITY: [clientSecret] is confidential. This class deliberately does NOT
/// override [toString] (it inherits `Object`'s identity-only form) so neither
/// half — and in particular the secret — can leak via logging, interpolation,
/// or an exception message. Do not add a value-revealing `toString`.
@immutable
final class CfServiceTokenPayload extends QrPayload {
  const CfServiceTokenPayload({
    required this.host,
    required this.clientId,
    required this.clientSecret,
  });

  /// The host this token is for, as an `https` origin (`scheme://host[:port]`).
  /// Used to warn when the scanned token targets a different host than the one
  /// the user is editing. Compare with [originsMatch].
  final String host;

  /// Public half of the pair — the `CF-Access-Client-Id` header value.
  final String clientId;

  /// Confidential half of the pair — the `CF-Access-Client-Secret` header
  /// value. NEVER log, print, or interpolate this value.
  final String clientSecret;

  static CfServiceTokenPayload _fromJson(Map<String, dynamic> json) {
    final host = json['host'];
    final clientId = json['clientId'];
    final clientSecret = json['clientSecret'];
    if (host is! String ||
        host.trim().isEmpty ||
        clientId is! String ||
        clientId.trim().isEmpty ||
        clientSecret is! String ||
        clientSecret.isEmpty) {
      throw const QrPayloadError(
        'This Cloudflare service-token QR code is incomplete.',
      );
    }
    return CfServiceTokenPayload(
      host: host.trim(),
      clientId: clientId.trim(),
      clientSecret: clientSecret,
    );
  }
}

/// Legacy `{url, port?, apiKey}` payload (no `type`) — the existing web-panel
/// shape that provisions a server with an API key.
@immutable
final class LegacyServerPayload extends QrPayload {
  const LegacyServerPayload({
    required this.url,
    required this.apiKey,
    this.port,
  });

  /// Server URL as emitted by the web panel (typically `window.location.origin`).
  final String url;

  /// Opaque API key (bearer token). Treated as sensitive — not logged.
  final String apiKey;

  /// Optional terminal-server port string the web panel includes. May be null
  /// for payloads that omit it.
  final String? port;

  static LegacyServerPayload _fromJson(Map<String, dynamic> json) {
    final url = (json['url'] as String).trim();
    final apiKey = json['apiKey'] as String;
    if (url.isEmpty || apiKey.isEmpty) {
      throw const QrPayloadError('This server QR code is incomplete.');
    }
    // `port` is optional and may arrive as a string or a number; coerce to a
    // trimmed string when present, otherwise leave null.
    final rawPort = json['port'];
    final port = switch (rawPort) {
      String s when s.trim().isNotEmpty => s.trim(),
      num n => n.toString(),
      _ => null,
    };
    return LegacyServerPayload(url: url, apiKey: apiKey, port: port);
  }
}

/// Thrown by [QrPayload.parse] for any malformed or unsupported QR code. The
/// [message] is user-facing and safe to render directly (it never contains a
/// secret).
@immutable
class QrPayloadError implements Exception {
  const QrPayloadError(this.message);

  final String message;

  @override
  String toString() => 'QrPayloadError: $message';
}

/// Normalise an arbitrary server URL to a comparable origin
/// (`scheme://host[:port]`, lowercased, no trailing slash, no path) so two
/// references to the same host compare equal regardless of casing or a trailing
/// path. Returns the trimmed input unchanged if it can't be parsed as a URI with
/// an authority (best-effort — the caller only uses the result for a
/// same-host warning, never for security decisions).
String normalizeQrOrigin(String input) {
  final trimmed = input.trim();
  final uri = Uri.tryParse(trimmed);
  if (uri == null || uri.host.isEmpty) return trimmed;
  final scheme = uri.scheme.isEmpty ? '' : '${uri.scheme.toLowerCase()}://';
  final port = uri.hasPort ? ':${uri.port}' : '';
  return '$scheme${uri.host.toLowerCase()}$port';
}

/// Whether [a] and [b] refer to the same host origin (scheme + host + port),
/// ignoring case, trailing slashes, and any path. Used to decide whether a
/// scanned [CfServiceTokenPayload.host] matches the host the user is editing.
bool originsMatch(String a, String b) =>
    normalizeQrOrigin(a) == normalizeQrOrigin(b);
