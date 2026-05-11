import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:url_launcher/url_launcher.dart';

import 'mobile_credentials.dart';

/// Default url_launcher integration. Opens [uri] in
/// `LaunchMode.externalApplication` so iOS uses
/// SFSafariViewController-equivalent and Android uses a Chrome Custom Tab
/// — both of which share the user's main browser cookie jar, so any
/// in-progress CF Access / Google SSO session is reused instead of
/// triggering a fresh `disallowed_useragent` challenge.
Future<bool> _defaultUrlLauncher(Uri uri) async {
  return launchUrl(uri, mode: LaunchMode.externalApplication);
}

/// Drives the system-browser CF Access login.
///
/// Flow:
///   1. Caller invokes [login] with the server's base URL.
///   2. We open `<server>/auth/mobile-callback` in the platform
///      system browser (Chrome Custom Tab / SFSafariViewController).
///   3. The user completes CF Access in that browser, sharing cookies
///      with their main browser session.
///   4. `/auth/mobile-callback` (already deployed on the server) mints
///      an API key, reads the CF JWT from the request's
///      `CF_Authorization` cookie, and 302s to
///      `remotedev://auth/callback?apiKey=...&cfToken=...&userId=...&email=...`.
///   5. The OS routes that custom-scheme URI back into the app; our
///      `app_links` subscription picks it up, the launcher's stream
///      filter matches, and we resolve with [MobileCredentials].
///   6. On timeout / non-matching URI / user backout, we return `null`.
///
/// Returning `null` is the cancellation signal — callers should display
/// a friendly "Sign-in cancelled" message rather than treating it as an
/// error.
class MobileCallbackLoginLauncher {
  MobileCallbackLoginLauncher({
    required Stream<Uri> deepLinkStream,
    Future<bool> Function(Uri uri) urlLauncher = _defaultUrlLauncher,
    Duration timeout = const Duration(minutes: 2),
  })  : _stream = deepLinkStream,
        _launch = urlLauncher,
        _timeout = timeout;

  final Stream<Uri> _stream;
  final Future<bool> Function(Uri uri) _launch;
  final Duration _timeout;

  /// Opens the system browser at `<serverUrl>/auth/mobile-callback` and
  /// resolves with the credentials parsed from the
  /// `remotedev://auth/callback` deep-link emitted by the server, or
  /// `null` on timeout / user cancel / malformed callback.
  Future<MobileCredentials?> login({required Uri serverUrl}) async {
    final completer = Completer<Uri>();
    StreamSubscription<Uri>? sub;

    // Subscribe BEFORE launching so we never miss a fast-path callback —
    // a sufficiently quick `remotedev://auth/callback` could fire before
    // a post-launch listen() attaches.
    sub = _stream.listen(
      (uri) {
        if (completer.isCompleted) return;
        if (uri.scheme != 'remotedev') return;
        if (uri.host != 'auth') return;
        if (uri.path != '/callback') return;
        completer.complete(uri);
      },
      onError: (Object e) {
        if (!completer.isCompleted) {
          completer.completeError(e);
        }
      },
    );

    try {
      final callbackUrl = serverUrl.replace(path: '/auth/mobile-callback');
      final launched = await _launch(callbackUrl);
      if (!launched) {
        debugPrint(
          '[MobileCallbackLogin] url_launcher returned false for $callbackUrl',
        );
        return null;
      }

      final Uri callbackUri;
      try {
        callbackUri = await completer.future.timeout(_timeout);
      } on TimeoutException {
        debugPrint('[MobileCallbackLogin] timed out after $_timeout');
        return null;
      }

      final apiKey = callbackUri.queryParameters['apiKey'];
      if (apiKey == null || apiKey.isEmpty) {
        // Redact the query string before logging — it can carry a
        // `cfToken` (and any other future query params) we don't want to
        // leak into release logs. The path alone is sufficient to
        // diagnose a malformed-callback regression.
        debugPrint(
          '[MobileCallbackLogin] callback missing apiKey at '
          '${callbackUri.path}',
        );
        return null;
      }
      final cfToken = callbackUri.queryParameters['cfToken'];
      final userId = callbackUri.queryParameters['userId'];
      final email = callbackUri.queryParameters['email'];

      return MobileCredentials(
        apiKey: apiKey,
        cfToken: (cfToken != null && cfToken.isNotEmpty) ? cfToken : null,
        userId: (userId != null && userId.isNotEmpty) ? userId : null,
        email: (email != null && email.isNotEmpty) ? email : null,
      );
    } catch (e, st) {
      debugPrint('[MobileCallbackLogin] failed: $e\n$st');
      return null;
    } finally {
      await sub.cancel();
    }
  }
}
