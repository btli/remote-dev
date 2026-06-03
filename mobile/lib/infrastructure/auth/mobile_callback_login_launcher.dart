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

/// Parsed result of a `remotedev://auth/callback` deep link.
///
/// Two shapes share one callback scheme (the app picks the branch by
/// `scope=host` / the presence of `apiKey`):
///   * [InstanceCallback] — a workspace/instance login. Carries the
///     per-workspace `apiKey` plus the host-wide CF token.
///   * [HostCallback] — a host (Supervisor) login for workspace
///     discovery. Carries ONLY the host-wide CF token; the Supervisor has
///     no API key to mint, so per-workspace keys are issued separately.
sealed class MobileCallbackResult {}

/// Instance/workspace callback: `?apiKey=...&cfToken=...&userId=...&email=...`.
class InstanceCallback extends MobileCallbackResult {
  InstanceCallback({
    required this.apiKey,
    required this.cfToken,
    required this.email,
    required this.userId,
  });

  final String apiKey;
  final String cfToken;
  final String email;
  final String userId;
}

/// Host (Supervisor) callback: `?scope=host&cfToken=...&userId=...&email=...`
/// — note the deliberate ABSENCE of `apiKey`.
class HostCallback extends MobileCallbackResult {
  HostCallback({
    required this.cfToken,
    required this.email,
    required this.userId,
  });

  final String cfToken;
  final String email;
  final String userId;
}

/// True when [uri] is the `remotedev://auth/callback` deep link this app
/// listens for. Shared by [parseMobileCallback] and the launcher's stream
/// filter so both agree on exactly one shape.
bool _isCallbackUri(Uri uri) =>
    uri.scheme == 'remotedev' &&
    uri.host == 'auth' &&
    uri.path == '/callback';

/// Pure parser for the `remotedev://auth/callback` deep link.
///
/// Returns:
///   * `null` when [uri] is not a callback URI (wrong scheme/host/path).
///   * a [HostCallback] when `scope=host` OR `apiKey` is absent/empty — the
///     host (Supervisor) shape carries no API key.
///   * an [InstanceCallback] when a non-empty `apiKey` is present.
///
/// Identity/token fields default to the empty string when missing so callers
/// get a total result; emptiness of `cfToken`/`email`/`userId` is non-fatal
/// (they are best-effort hints), whereas `apiKey` presence is what selects
/// the instance branch.
MobileCallbackResult? parseMobileCallback(Uri uri) {
  if (!_isCallbackUri(uri)) return null;

  final params = uri.queryParameters;
  final scope = params['scope'];
  final apiKey = params['apiKey'];
  final cfToken = params['cfToken'] ?? '';
  final email = params['email'] ?? '';
  final userId = params['userId'] ?? '';

  final isHost = scope == 'host' || apiKey == null || apiKey.isEmpty;
  if (isHost) {
    return HostCallback(cfToken: cfToken, email: email, userId: userId);
  }
  return InstanceCallback(
    apiKey: apiKey,
    cfToken: cfToken,
    email: email,
    userId: userId,
  );
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
///
/// [loginHost] is the host (Supervisor) twin used for workspace discovery:
/// it drives the same browser flow against `<origin>/auth/mobile-callback`
/// but awaits a [HostCallback] (no API key) and THROWS on failure, since a
/// successful discovery bootstrap must yield a host CF token.
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
  ///
  /// PUBLIC SIGNATURE IS LOAD-BEARING: reauth (and Add Server) call
  /// `login(serverUrl: ...)` and rely on the `MobileCredentials?` return +
  /// null-on-cancel semantics. A host-shaped callback (no `apiKey`) is
  /// treated here as a malformed instance login → `null`.
  Future<MobileCredentials?> login({required Uri serverUrl}) async {
    final Uri callbackUri;
    try {
      callbackUri = await _awaitCallback(serverUrl);
    } on _LaunchFailed {
      return null;
    } on TimeoutException {
      debugPrint('[MobileCallbackLogin] timed out after $_timeout');
      return null;
    } catch (e, st) {
      debugPrint('[MobileCallbackLogin] failed: $e\n$st');
      return null;
    }

    final result = parseMobileCallback(callbackUri);
    if (result is! InstanceCallback) {
      // Missing/empty apiKey (or an explicitly host-scoped callback) — not a
      // valid instance login. Redact the query string before logging: it can
      // carry a `cfToken` we don't want to leak into release logs.
      debugPrint(
        '[MobileCallbackLogin] callback missing apiKey at '
        '${callbackUri.path}',
      );
      return null;
    }

    return MobileCredentials(
      apiKey: result.apiKey,
      cfToken: result.cfToken.isNotEmpty ? result.cfToken : null,
      userId: result.userId.isNotEmpty ? result.userId : null,
      email: result.email.isNotEmpty ? result.email : null,
    );
  }

  /// Host (Supervisor) login for workspace discovery.
  ///
  /// Opens the system browser at `<origin>/auth/mobile-callback` and
  /// resolves with the [HostCallback] parsed from the server's
  /// `remotedev://auth/callback?scope=host...` deep-link.
  ///
  /// Unlike [login], a successful discovery bootstrap MUST produce a host CF
  /// token, so this surfaces failure as an exception instead of `null`:
  ///   * [MobileCallbackLaunchException] — the browser failed to launch.
  ///   * [TimeoutException] — no callback arrived within the timeout.
  ///   * [MobileCallbackShapeException] — the callback was an instance
  ///     (apiKey-bearing) shape, not a host one.
  Future<HostCallback> loginHost({required Uri origin}) async {
    final Uri callbackUri;
    try {
      callbackUri = await _awaitCallback(origin);
    } on _LaunchFailed {
      throw const MobileCallbackLaunchException(
        'The browser could not be opened to sign in.',
      );
    } on TimeoutException {
      // Parity with [login]'s timeout logging. Unlike [login] (which maps a
      // timeout to a null/cancel result), the host bootstrap MUST yield a CF
      // token, so we log here and rethrow to preserve the documented
      // `throws TimeoutException` contract.
      debugPrint('[MobileCallbackLogin] loginHost timed out after $_timeout');
      rethrow;
    }

    final result = parseMobileCallback(callbackUri);
    if (result is! HostCallback) {
      debugPrint(
        '[MobileCallbackLogin] expected host callback at ${callbackUri.path}',
      );
      throw const MobileCallbackShapeException(
        'Expected a host sign-in but received a workspace callback.',
      );
    }
    return result;
  }

  /// Shared browser-launch + deep-link-await plumbing for [login] and
  /// [loginHost]. Subscribes to the deep-link stream BEFORE launching (so a
  /// fast callback is never missed), opens `<baseUrl>/auth/mobile-callback`,
  /// and completes with the first matching `remotedev://auth/callback` URI.
  ///
  /// SINGLE IN-FLIGHT LOGIN ASSUMPTION: callers ([login] / [loginHost], and
  /// their UI screens) run at most one sign-in at a time. The shared
  /// `deepLinkStream` carries no correlation id, so this completes on the FIRST
  /// matching callback regardless of which login started it — two concurrent
  /// logins against different hosts could cross-bind credentials. Every call
  /// site (AddHost, reauth, the workspace refresh closure) enforces this by
  /// awaiting one flow before starting another.
  ///
  /// Throws [_LaunchFailed] if the launcher reports failure, [TimeoutException]
  /// on no callback within [_timeout], or rethrows a stream error. The
  /// subscription is always cancelled.
  Future<Uri> _awaitCallback(Uri baseUrl) async {
    final completer = Completer<Uri>();
    StreamSubscription<Uri>? sub;

    // Subscribe BEFORE launching so we never miss a fast-path callback —
    // a sufficiently quick `remotedev://auth/callback` could fire before
    // a post-launch listen() attaches.
    sub = _stream.listen(
      (uri) {
        if (completer.isCompleted) return;
        if (!_isCallbackUri(uri)) return;
        completer.complete(uri);
      },
      onError: (Object e) {
        if (!completer.isCompleted) {
          completer.completeError(e);
        }
      },
    );

    try {
      final callbackUrl = baseUrl.replace(path: '/auth/mobile-callback');
      final launched = await _launch(callbackUrl);
      if (!launched) {
        debugPrint(
          '[MobileCallbackLogin] url_launcher returned false for $callbackUrl',
        );
        throw const _LaunchFailed();
      }
      return await completer.future.timeout(_timeout);
    } finally {
      await sub.cancel();
    }
  }
}

/// Internal sentinel: the system browser failed to launch. Mapped to `null`
/// by [MobileCallbackLoginLauncher.login] and to a
/// [MobileCallbackLaunchException] by `loginHost`.
class _LaunchFailed implements Exception {
  const _LaunchFailed();
}

/// Base type for host-login (`loginHost`) failures.
sealed class MobileCallbackException implements Exception {
  const MobileCallbackException(this.message);
  final String message;

  @override
  String toString() => 'MobileCallbackException: $message';
}

/// The system browser could not be opened for the host login.
class MobileCallbackLaunchException extends MobileCallbackException {
  const MobileCallbackLaunchException(super.message);
}

/// A host login received an instance-shaped (apiKey-bearing) callback.
class MobileCallbackShapeException extends MobileCallbackException {
  const MobileCallbackShapeException(super.message);
}
