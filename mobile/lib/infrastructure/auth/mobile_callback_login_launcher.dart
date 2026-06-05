import 'dart:async';
import 'dart:convert';
import 'dart:math';

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

/// Number of random bytes in a login [state] nonce. 32 bytes = 256 bits of
/// entropy — comfortably above the 128-bit floor in remote-dev-gkuo, making the
/// nonce computationally infeasible to GUESS (the property the anti-forgery
/// check actually relies on).
const int _kStateEntropyBytes = 32;

/// Generate a single-use, high-entropy anti-forgery `state` nonce for one
/// mobile login attempt (remote-dev-gkuo).
///
/// The mobile login round-trips credentials through a `remotedev://auth/callback`
/// CUSTOM-SCHEME deep link. The app appends this nonce to the
/// `/auth/mobile-callback?state=…` URL it opens; the server echoes it unchanged
/// on the deep link; the app then accepts the callback ONLY if the echoed nonce
/// matches the one it generated.
///
/// WHAT THIS PROTECTS — and what it does NOT (be honest about the claim):
/// this is anti-CSRF for the custom scheme. It lets the app REJECT an
/// UNSOLICITED / FORGED callback that it never initiated (e.g. a hostile app,
/// or a stale/replayed link, firing `remotedev://auth/callback?...` on its
/// own): without the unguessable nonce such a callback is discarded, so it
/// cannot complete a login or inject attacker-chosen credentials.
///
/// It does NOT protect against INTERCEPTION of a legitimate callback. Any app
/// that registers the same `remotedev://` scheme and wins/observes the OS
/// dispatch of a REAL callback receives the credentials AND the echoed nonce
/// together (they travel in the same deep-link URL), so the nonce gives no
/// defense there — the credentials are already exposed. Closing the
/// interception gap requires verified Android App Links / iOS Universal Links
/// (HTTPS-claimed associations a rogue app cannot register), or replacing the
/// in-link credential payload with a short-lived auth CODE redeemed over HTTPS
/// using a verifier that is NEVER placed in the deep link (true PKCE). Both are
/// out of scope for remote-dev-gkuo and tracked as future hardening.
///
/// Uses [Random.secure] (a cryptographically-secure RNG) and base64url (no
/// padding) so the value is URL-safe and needs no extra escaping. 256 bits.
String generateLoginState() {
  final rng = Random.secure();
  final bytes = List<int>.generate(
    _kStateEntropyBytes,
    (_) => rng.nextInt(256),
  );
  // base64Url + strip '=' padding → fully URL-safe (no +, /, =).
  return base64Url.encode(bytes).replaceAll('=', '');
}

/// Append `state=<nonce>` to [callbackUrl]'s query string, preserving any
/// existing query parameters (there are none today, but this keeps the helper
/// total). Pure + testable.
Uri appendStateParam(Uri callbackUrl, String state) {
  final params = Map<String, String>.from(callbackUrl.queryParameters);
  params['state'] = state;
  return callbackUrl.replace(queryParameters: params);
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
    String Function() stateGenerator = generateLoginState,
  })  : _stream = deepLinkStream,
        _launch = urlLauncher,
        _timeout = timeout,
        _generateState = stateGenerator;

  final Stream<Uri> _stream;
  final Future<bool> Function(Uri uri) _launch;
  final Duration _timeout;

  /// Anti-hijack nonce factory (remote-dev-gkuo). Injectable so tests can assert
  /// the launched URL carries the generated nonce and that mismatches reject.
  final String Function() _generateState;

  /// Single-in-flight guard. `_awaitCallback` sets this `true` while a login is
  /// pending and clears it in `finally`; a second concurrent call throws
  /// [_ConcurrentLogin] instead of starting. This ENFORCES (not just documents)
  /// the single-in-flight invariant: because every flow shares one
  /// correlation-id-less `deepLinkStream`, two overlapping logins could
  /// otherwise have one flow's callback satisfy the other's waiter and
  /// cross-bind credentials. Each flow ALSO validates the echoed `state`
  /// against its OWN per-call local nonce (closed over in its listener), so
  /// even setting this guard aside a callback can only ever complete the exact
  /// flow that issued its nonce — the guard and the per-call nonce are
  /// independent, complementary defenses.
  bool _inFlight = false;

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
  ///
  /// ANTI-FORGERY STATE (remote-dev-gkuo): before launching we generate a
  /// single-use, high-entropy `state` nonce, append it to the
  /// `/auth/mobile-callback?state=…` URL, and capture it as a PER-CALL LOCAL
  /// (`expectedState`) that this flow's listener closes over. The server echoes
  /// it on the `remotedev://auth/callback` deep link. We accept a callback ONLY
  /// when its `state` EXACTLY matches THIS flow's nonce; a callback with a
  /// missing or mismatched `state` is treated as one we did NOT initiate (a
  /// forged/unsolicited callback or a replay) and is IGNORED — we keep waiting
  /// and ultimately time out rather than ever completing on, or applying
  /// credentials from, an unsolicited callback. Exact (constant) string
  /// equality is sufficient because the nonce is an opaque, uniformly-random
  /// 256-bit token with no structure to canonicalise — there is no
  /// semantically-equal-but-textually-different form to normalise, so a
  /// byte-for-byte compare is both necessary and complete. Because the nonce is
  /// a per-call local (not a shared field) and the subscription is cancelled in
  /// `finally`, it is single-use: once this flow resolves its listener is gone,
  /// so a callback replayed afterwards reaches no listener and is rejected.
  ///
  /// THREAT MODEL — what this does and does NOT protect (Codex review):
  /// this is anti-CSRF for the custom scheme — it blocks UNSOLICITED/FORGED
  /// callbacks the app never initiated. It does NOT protect against a malicious
  /// app that INTERCEPTS a legitimate `remotedev://auth/callback` dispatch: such
  /// an app receives the credentials AND the echoed nonce together (they travel
  /// in the same deep link), so the nonce cannot defend against interception.
  /// Real interception hardening needs verified Android App Links / iOS
  /// Universal Links (HTTPS-claimed, non-spoofable), or a short-lived auth CODE
  /// redeemed over HTTPS using a verifier that is NEVER placed in the deep link.
  /// Both are out of scope for remote-dev-gkuo and tracked as future work.
  ///
  /// SINGLE IN-FLIGHT (enforced): a second concurrent call throws
  /// [_ConcurrentLogin] (see [_inFlight]) — overlapping logins on one launcher
  /// share a correlation-id-less stream and must not race.
  ///
  /// VERSION COUPLING: both the instance and supervisor servers echo `state`
  /// (src/lib/mobile-callback.ts + apps/supervisor/src/lib/mobile-callback.ts),
  /// so an app build that sends a nonce always talks to a server build that
  /// returns it. There is no "updated app vs old server" window in which a
  /// legitimate callback would arrive without the echoed nonce — hence the
  /// strict reject on a missing `state` is safe.
  Future<Uri> _awaitCallback(Uri baseUrl) async {
    // Enforce the single-in-flight invariant. Two concurrent flows would share
    // this one broadcast stream with no correlation id, so one flow's callback
    // could complete the other's waiter and cross-bind credentials. Reject the
    // second flow rather than relying on call sites to serialize. (The per-call
    // nonce below independently prevents cross-validation, but refusing to even
    // start avoids two browsers/timeouts racing on the same launcher.)
    if (_inFlight) {
      throw const _ConcurrentLogin();
    }
    _inFlight = true;

    final completer = Completer<Uri>();
    StreamSubscription<Uri>? sub;

    // Generate the expected nonce for THIS attempt before launching. It is a
    // PER-CALL LOCAL closed over by this flow's listener — never a shared field
    // — so a callback can only ever validate against, and complete, the exact
    // flow that issued its nonce. Concurrent flows therefore cannot cross.
    final expectedState = _generateState();

    // Subscribe BEFORE launching so we never miss a fast-path callback —
    // a sufficiently quick `remotedev://auth/callback` could fire before
    // a post-launch listen() attaches.
    sub = _stream.listen(
      (uri) {
        if (completer.isCompleted) return;
        if (!_isCallbackUri(uri)) return;
        // Anti-forgery gate: only complete on a callback whose echoed `state`
        // EXACTLY matches THIS flow's single-use nonce. Anything else — a
        // mismatch or a missing `state` — is ignored (we keep waiting), so a
        // forged / unsolicited / replayed callback can neither complete our
        // login nor inject its credentials. Constant exact-string compare: the
        // nonce is an opaque uniformly-random token, so there is nothing to
        // canonicalise.
        final returnedState = uri.queryParameters['state'];
        if (returnedState == null || returnedState != expectedState) {
          debugPrint(
            '[MobileCallbackLogin] rejecting callback with mismatched/missing '
            'state (got ${returnedState == null ? 'none' : 'a different value'})',
          );
          return;
        }
        completer.complete(uri);
      },
      onError: (Object e) {
        if (!completer.isCompleted) {
          completer.completeError(e);
        }
      },
    );

    try {
      // Use buildCallbackUrl to preserve workspace path prefixes, then append
      // the anti-forgery nonce as a query param.
      final callbackUrl = appendStateParam(buildCallbackUrl(baseUrl), expectedState);
      final launched = await _launch(callbackUrl);
      if (!launched) {
        debugPrint(
          '[MobileCallbackLogin] url_launcher returned false for $callbackUrl',
        );
        throw const _LaunchFailed();
      }
      return await completer.future.timeout(_timeout);
    } finally {
      // Cancel the subscription (single-use: a later replay reaches no listener)
      // and release the in-flight guard so the next login can start.
      await sub.cancel();
      _inFlight = false;
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

/// Thrown when a second login is started on a launcher that already has one in
/// flight (single-in-flight enforcement; see `_awaitCallback` / `_inFlight`).
/// Extends [MobileCallbackException] so `loginHost` surfaces it as a typed host
/// failure, while `loginInstance` / `login` map it to `null` via their
/// catch-all — both treat a refused concurrent attempt as a non-fatal cancel.
class _ConcurrentLogin extends MobileCallbackException {
  const _ConcurrentLogin()
      : super('Another sign-in is already in progress.');
}

/// The system browser could not be opened for the host login.
class MobileCallbackLaunchException extends MobileCallbackException {
  const MobileCallbackLaunchException(super.message);
}

/// A host login received an instance-shaped (apiKey-bearing) callback.
class MobileCallbackShapeException extends MobileCallbackException {
  const MobileCallbackShapeException(super.message);
}
