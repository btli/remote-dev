import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../domain/auth_cookie.dart';
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

/// Builds the callback URL for a given base URL, preserving any workspace
/// path prefix.
///
/// Examples:
///   `https://h`        → `https://h/auth/mobile-callback`
///   `https://h/demo`   → `https://h/demo/auth/mobile-callback`
///   `https://h/demo/`  → `https://h/demo/auth/mobile-callback` (trailing slash stripped)
///
/// This fixes the base-path bug where using `baseUrl.replace(path:
/// '/auth/mobile-callback')` would discard any workspace prefix (e.g.
/// an instance at `https://host/demo` would wrongly open
/// `https://host/auth/mobile-callback` instead of
/// `https://host/demo/auth/mobile-callback`).
Uri buildCallbackUrl(Uri base) {
  final trimmed = base.path.replaceFirst(RegExp(r'/+$'), '');
  return base.replace(path: '$trimmed/auth/mobile-callback');
}

/// Parsed result of a `remotedev://auth/callback` deep link.
///
/// Two shapes share one callback scheme (the app picks the branch by
/// `scope=host` / the presence of `apiKey`):
///   * [InstanceCallback] — a workspace/instance login. Carries the
///     per-workspace `apiKey` (nullable for OIDC flows) plus auth cookies
///     and identity hints.
///   * [HostCallback] — a host (Supervisor) login for workspace
///     discovery. Carries ONLY the host-wide auth cookies / CF token; the
///     Supervisor has no API key to mint, so per-workspace keys are issued
///     separately.
sealed class MobileCallbackResult {}

/// Instance/workspace callback.
///
/// Classic shape: `?apiKey=...&cfToken=...&userId=...&email=...`
/// OIDC shape:    `?scope=instance&authCookies=<b64json>&userId=...&email=...`
///
/// [apiKey] is nullable — OIDC instance callbacks carry no API key (the
/// server uses the OIDC session instead). Callers MUST null-check before use.
///
/// [authCookies] is the preferred credential carrier going forward. For legacy
/// callbacks without an `authCookies` param, it is synthesized from `cfToken`
/// as `[AuthCookie(name: "CF_Authorization", value: cfToken, path: "/")]` when
/// `cfToken` is non-empty; otherwise it is empty.
class InstanceCallback extends MobileCallbackResult {
  InstanceCallback({
    required this.apiKey,
    required this.cfToken,
    required this.email,
    required this.userId,
    required this.authCookies,
  });

  /// The per-workspace API key. Null for OIDC instance callbacks.
  final String? apiKey;
  final String cfToken;
  final String email;
  final String userId;

  /// Decoded auth cookies from the `authCookies` query parameter, or
  /// synthesized from `cfToken` for legacy callbacks.
  final List<AuthCookie> authCookies;
}

/// Host (Supervisor) callback.
///
/// Shape: `?scope=host&authCookies=<b64json>&userId=...&email=...`
/// Legacy: `?scope=host&cfToken=...&userId=...&email=...`
///
/// [authCookies] is the preferred credential carrier. For legacy callbacks
/// without an `authCookies` param, it is synthesized from `cfToken` when
/// non-empty; otherwise it is empty.
class HostCallback extends MobileCallbackResult {
  HostCallback({
    required this.cfToken,
    required this.email,
    required this.userId,
    required this.authCookies,
  });

  final String cfToken;
  final String email;
  final String userId;

  /// Decoded auth cookies from the `authCookies` query parameter, or
  /// synthesized from `cfToken` for legacy callbacks.
  final List<AuthCookie> authCookies;
}

/// True when [uri] is the `remotedev://auth/callback` deep link this app
/// listens for. Shared by [parseMobileCallback] and the launcher's stream
/// filter so both agree on exactly one shape.
bool _isCallbackUri(Uri uri) =>
    uri.scheme == 'remotedev' && uri.host == 'auth' && uri.path == '/callback';

/// Resolves the [AuthCookie] list for a callback.
///
/// Priority:
///   1. `authCookies` query param (base64url JSON) — preferred for all new
///      server-side flows (CF Access, OIDC).
///   2. Legacy fallback: if `authCookies` is absent/empty but `cfToken` is
///      present, synthesize `[AuthCookie(name: "CF_Authorization", ...)]`.
///   3. Otherwise `[]`.
List<AuthCookie> _resolveAuthCookies(Map<String, String> params) {
  final raw = params['authCookies'];
  if (raw != null && raw.isNotEmpty) {
    final decoded = decodeAuthCookies(raw);
    // decodeAuthCookies returns [] on malformed input — no need to check.
    return decoded;
  }
  // Legacy cfToken fallback.
  final cfToken = params['cfToken'];
  if (cfToken != null && cfToken.isNotEmpty) {
    return [AuthCookie(name: 'CF_Authorization', value: cfToken, path: '/')];
  }
  return [];
}

/// Pure parser for the `remotedev://auth/callback` deep link.
///
/// Precedence:
///   * `scope=host`                             → [HostCallback]
///   * `scope=instance`                         → [InstanceCallback] (apiKey nullable)
///   * legacy (no scope) + non-empty `apiKey`   → [InstanceCallback]
///   * legacy (no scope) + absent/empty `apiKey`→ [HostCallback]
///
/// Returns `null` when [uri] is not a callback URI (wrong scheme/host/path).
///
/// Identity/token fields default to the empty string when missing so callers
/// get a total result; emptiness of `cfToken`/`email`/`userId` is non-fatal.
/// `authCookies` is always resolved via [_resolveAuthCookies] — never null.
MobileCallbackResult? parseMobileCallback(Uri uri) {
  if (!_isCallbackUri(uri)) return null;

  final params = uri.queryParameters;
  final scope = params['scope'];
  final apiKey = params['apiKey'];
  final cfToken = params['cfToken'] ?? '';
  final email = params['email'] ?? '';
  final userId = params['userId'] ?? '';
  final authCookies = _resolveAuthCookies(params);

  // Explicit scope takes priority.
  if (scope == 'host') {
    return HostCallback(
      cfToken: cfToken,
      email: email,
      userId: userId,
      authCookies: authCookies,
    );
  }
  if (scope == 'instance') {
    return InstanceCallback(
      apiKey: apiKey?.isNotEmpty == true ? apiKey : null,
      cfToken: cfToken,
      email: email,
      userId: userId,
      authCookies: authCookies,
    );
  }

  // Legacy (no scope): apiKey presence determines the branch.
  final hasApiKey = apiKey != null && apiKey.isNotEmpty;
  if (hasApiKey) {
    return InstanceCallback(
      apiKey: apiKey,
      cfToken: cfToken,
      email: email,
      userId: userId,
      authCookies: authCookies,
    );
  }
  return HostCallback(
    cfToken: cfToken,
    email: email,
    userId: userId,
    authCookies: authCookies,
  );
}

/// Drives the system-browser CF Access / OIDC login.
///
/// Flow:
///   1. Caller invokes [login] with the server's base URL.
///   2. We open `<server>/auth/mobile-callback` (via [buildCallbackUrl],
///      which preserves any workspace path prefix) in the platform system
///      browser (Chrome Custom Tab / SFSafariViewController).
///   3. The user completes CF Access / OIDC in that browser, sharing cookies
///      with their main browser session.
///   4. `/auth/mobile-callback` (already deployed on the server) mints
///      credentials and 302s to a `remotedev://auth/callback?...` deep link.
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
  /// DEPRECATED for new call sites: prefer [loginInstance], which returns
  /// the richer [InstanceCallback] that carries `authCookies` and treats
  /// `apiKey` as optional (supporting OIDC flows). This method is kept for
  /// legacy callers (reauth path in `main.dart`) that still expect
  /// `MobileCredentials?` with a non-null `apiKey`.
  ///
  /// A host-shaped callback (no `apiKey`) or an OIDC callback (empty `apiKey`)
  /// is treated here as a malformed instance login → `null`.
  Future<MobileCredentials?> login({required Uri serverUrl}) async {
    final result = await loginInstance(serverUrl: serverUrl);
    if (result == null) return null;
    final apiKey = result.apiKey;
    if (apiKey == null || apiKey.isEmpty) {
      // OIDC instance callback — no API key. Legacy callers cannot build a
      // MobileCredentials without an apiKey; use loginInstance() instead.
      debugPrint(
        '[MobileCallbackLogin] OIDC instance callback (no apiKey) at '
        '${serverUrl.path} — callers should use loginInstance()',
      );
      return null;
    }
    return MobileCredentials(
      apiKey: apiKey,
      cfToken: result.cfToken.isNotEmpty ? result.cfToken : null,
      userId: result.userId.isNotEmpty ? result.userId : null,
      email: result.email.isNotEmpty ? result.email : null,
    );
  }

  /// Opens the system browser at `<serverUrl>/auth/mobile-callback` and
  /// resolves with the [InstanceCallback] parsed from the server's
  /// `remotedev://auth/callback` deep-link, or `null` on timeout / user
  /// cancel / malformed callback / host-shaped callback.
  ///
  /// Unlike the legacy [login], `apiKey` is treated as optional — OIDC
  /// instance callbacks carry `authCookies` without an `apiKey`. Callers
  /// must persist both `authCookies` (always) and `apiKey` (when non-null).
  Future<InstanceCallback?> loginInstance({required Uri serverUrl}) async {
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
      // Host-scoped callback or completely unparseable — not a valid instance
      // login. Redact the query string before logging.
      debugPrint(
        '[MobileCallbackLogin] expected instance callback at '
        '${callbackUri.path}',
      );
      return null;
    }
    return result;
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
  /// fast callback is never missed), opens `<baseUrl>/auth/mobile-callback`
  /// (preserving any workspace path prefix via [buildCallbackUrl]), and
  /// completes with the first matching `remotedev://auth/callback` URI.
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
      // Use buildCallbackUrl to preserve workspace path prefixes.
      final callbackUrl = buildCallbackUrl(baseUrl);
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
