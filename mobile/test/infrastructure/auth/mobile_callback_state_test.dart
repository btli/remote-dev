import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:remote_dev/infrastructure/auth/mobile_callback_login_launcher.dart';

/// Tests for the anti-hijack `state` nonce (remote-dev-gkuo).
///
/// The mobile login round-trips credentials through a `remotedev://auth/callback`
/// CUSTOM-SCHEME deep link that any app could register and intercept. The app
/// generates a single-use, high-entropy `state`, appends it to the
/// `/auth/mobile-callback?state=…` URL it opens, and the server echoes it on the
/// deep link. The app accepts the callback ONLY when the echoed `state` matches
/// — so a hijacked / forged / replayed callback is rejected.
void main() {
  // -------------------------------------------------------------------------
  // generateLoginState — entropy + encoding
  // -------------------------------------------------------------------------
  group('generateLoginState', () {
    test('produces a non-empty, URL-safe, high-entropy value', () {
      final s = generateLoginState();
      expect(s, isNotEmpty);
      // base64url without padding: no +, /, or = (so it needs no extra escaping
      // when placed in a query string).
      expect(s, isNot(contains('+')));
      expect(s, isNot(contains('/')));
      expect(s, isNot(contains('=')));
      // 32 random bytes → 256 bits. base64 of 32 bytes (unpadded) = 43 chars,
      // which is well above the 128-bit (>=22 base64 chars) floor.
      expect(s.length, greaterThanOrEqualTo(22));
    });

    test('is effectively unique across calls (no fixed/predictable value)', () {
      final values = List.generate(200, (_) => generateLoginState()).toSet();
      // A secure RNG must not collide across 200 draws of a 256-bit value.
      expect(values.length, 200);
    });
  });

  // -------------------------------------------------------------------------
  // appendStateParam — URL threading
  // -------------------------------------------------------------------------
  group('appendStateParam', () {
    test('adds state to a query-less callback URL', () {
      final out = appendStateParam(
        Uri.parse('https://h/auth/mobile-callback'),
        'abc123',
      );
      expect(out.queryParameters['state'], 'abc123');
      expect(out.path, '/auth/mobile-callback');
    });

    test('preserves an existing path prefix (workspace slug)', () {
      final out = appendStateParam(
        Uri.parse('https://h/demo/auth/mobile-callback'),
        'xyz',
      );
      expect(out.path, '/demo/auth/mobile-callback');
      expect(out.queryParameters['state'], 'xyz');
    });
  });

  // -------------------------------------------------------------------------
  // Launcher state validation — accept / reject
  // -------------------------------------------------------------------------
  group('MobileCallbackLoginLauncher state validation', () {
    test('launches with the generated state appended to the URL', () async {
      final stream = StreamController<Uri>.broadcast();
      Uri? launchedAt;
      final launcher = MobileCallbackLoginLauncher(
        deepLinkStream: stream.stream,
        stateGenerator: () => 'fixed-state-token',
        urlLauncher: (uri) async {
          launchedAt = uri;
          // Never fire a callback — we only assert the launch URL here.
          return true;
        },
        timeout: const Duration(milliseconds: 50),
      );

      // Times out → null; we only care about the launched URL.
      await launcher.loginInstance(serverUrl: Uri.parse('https://h'));

      expect(launchedAt, isNotNull);
      expect(launchedAt!.queryParameters['state'], 'fixed-state-token');
      await stream.close();
    });

    test('MATCHING state ⇒ credentials accepted', () async {
      final stream = StreamController<Uri>.broadcast();
      final launcher = MobileCallbackLoginLauncher(
        deepLinkStream: stream.stream,
        stateGenerator: () => 'good-state',
        urlLauncher: (_) async {
          scheduleMicrotask(() {
            stream.add(
              Uri.parse(
                'remotedev://auth/callback?scope=instance&apiKey=sk-ok'
                '&state=good-state',
              ),
            );
          });
          return true;
        },
      );

      final result =
          await launcher.loginInstance(serverUrl: Uri.parse('https://h'));
      expect(result, isNotNull);
      expect(result!.apiKey, 'sk-ok');
      await stream.close();
    });

    test('MISMATCHED state ⇒ rejected (times out to null)', () async {
      final stream = StreamController<Uri>.broadcast();
      final launcher = MobileCallbackLoginLauncher(
        deepLinkStream: stream.stream,
        stateGenerator: () => 'expected-state',
        urlLauncher: (_) async {
          scheduleMicrotask(() {
            // Attacker / replay: a perfectly-shaped callback, but with a state
            // the app never issued. MUST be ignored (never accepted).
            stream.add(
              Uri.parse(
                'remotedev://auth/callback?scope=instance&apiKey=sk-evil'
                '&state=attacker-state',
              ),
            );
          });
          return true;
        },
        timeout: const Duration(milliseconds: 80),
      );

      final result =
          await launcher.loginInstance(serverUrl: Uri.parse('https://h'));
      expect(result, isNull, reason: 'mismatched state must not be accepted');
      await stream.close();
    });

    test('MISSING state when one was expected ⇒ rejected', () async {
      final stream = StreamController<Uri>.broadcast();
      final launcher = MobileCallbackLoginLauncher(
        deepLinkStream: stream.stream,
        stateGenerator: () => 'expected-state',
        urlLauncher: (_) async {
          scheduleMicrotask(() {
            // A callback with NO state at all (e.g. a hijacker who didn't know
            // to echo one). MUST be rejected.
            stream.add(
              Uri.parse(
                'remotedev://auth/callback?scope=instance&apiKey=sk-nostate',
              ),
            );
          });
          return true;
        },
        timeout: const Duration(milliseconds: 80),
      );

      final result =
          await launcher.loginInstance(serverUrl: Uri.parse('https://h'));
      expect(result, isNull, reason: 'missing state must not be accepted');
      await stream.close();
    });

    test(
        'a mismatched callback does NOT consume the flow — a later MATCHING '
        'callback still wins (hijack does not break legit login)', () async {
      final stream = StreamController<Uri>.broadcast();
      final launcher = MobileCallbackLoginLauncher(
        deepLinkStream: stream.stream,
        stateGenerator: () => 'real-state',
        urlLauncher: (_) async {
          scheduleMicrotask(() {
            // Forged callback first…
            stream.add(
              Uri.parse(
                'remotedev://auth/callback?scope=instance&apiKey=sk-evil'
                '&state=wrong',
              ),
            );
            // …then the genuine one with the correct state.
            stream.add(
              Uri.parse(
                'remotedev://auth/callback?scope=instance&apiKey=sk-real'
                '&state=real-state',
              ),
            );
          });
          return true;
        },
      );

      final result =
          await launcher.loginInstance(serverUrl: Uri.parse('https://h'));
      expect(result, isNotNull);
      expect(
        result!.apiKey,
        'sk-real',
        reason: 'forged callback must be ignored, genuine one accepted',
      );
      await stream.close();
    });

    test('loginHost: matching host callback with state is accepted', () async {
      final stream = StreamController<Uri>.broadcast();
      final launcher = MobileCallbackLoginLauncher(
        deepLinkStream: stream.stream,
        stateGenerator: () => 'host-state',
        urlLauncher: (_) async {
          scheduleMicrotask(() {
            stream.add(
              Uri.parse(
                'remotedev://auth/callback?scope=host&cfToken=host-jwt'
                '&state=host-state',
              ),
            );
          });
          return true;
        },
      );

      final host =
          await launcher.loginHost(origin: Uri.parse('https://sup'));
      expect(host.cfToken, 'host-jwt');
      await stream.close();
    });

    test('loginHost: mismatched state ⇒ TimeoutException (rejected)', () async {
      final stream = StreamController<Uri>.broadcast();
      final launcher = MobileCallbackLoginLauncher(
        deepLinkStream: stream.stream,
        stateGenerator: () => 'host-state',
        urlLauncher: (_) async {
          scheduleMicrotask(() {
            stream.add(
              Uri.parse(
                'remotedev://auth/callback?scope=host&cfToken=evil-jwt'
                '&state=nope',
              ),
            );
          });
          return true;
        },
        timeout: const Duration(milliseconds: 80),
      );

      await expectLater(
        launcher.loginHost(origin: Uri.parse('https://sup')),
        throwsA(isA<TimeoutException>()),
      );
      await stream.close();
    });

    test(
        'REPLAY: each attempt uses a fresh nonce — a callback from a prior '
        'attempt is not accepted by a new attempt', () async {
      final stream = StreamController<Uri>.broadcast();
      var counter = 0;
      final launcher = MobileCallbackLoginLauncher(
        deepLinkStream: stream.stream,
        stateGenerator: () => 'state-${counter++}',
        urlLauncher: (_) async => true,
        timeout: const Duration(milliseconds: 80),
      );

      // First attempt: generates state-0, then times out (no callback).
      final first =
          await launcher.loginInstance(serverUrl: Uri.parse('https://h'));
      expect(first, isNull);

      // Second attempt: generates state-1. A replayed callback bearing the OLD
      // state-0 must NOT be accepted by this new attempt.
      final secondFuture =
          launcher.loginInstance(serverUrl: Uri.parse('https://h'));
      scheduleMicrotask(() {
        stream.add(
          Uri.parse(
            'remotedev://auth/callback?scope=instance&apiKey=sk-replay'
            '&state=state-0',
          ),
        );
      });
      final second = await secondFuture;
      expect(
        second,
        isNull,
        reason: 'a stale nonce from a prior attempt must be rejected',
      );
      await stream.close();
    });
  });

  // -------------------------------------------------------------------------
  // Single-in-flight enforcement — concurrent logins cannot cross (Codex #2)
  // -------------------------------------------------------------------------
  group('MobileCallbackLoginLauncher single-in-flight', () {
    test(
        'a second concurrent loginInstance is refused (null) while the first '
        'is pending, and does NOT disturb the first flow', () async {
      final stream = StreamController<Uri>.broadcast();
      // Distinct nonce per call so a cross-completion would be observable.
      var counter = 0;
      final launcher = MobileCallbackLoginLauncher(
        deepLinkStream: stream.stream,
        stateGenerator: () => 'concurrent-${counter++}',
        urlLauncher: (_) async => true,
        timeout: const Duration(seconds: 5),
      );

      // Flow A launches and stays pending (no callback yet). Uses nonce
      // 'concurrent-0'.
      final flowA = launcher.loginInstance(serverUrl: Uri.parse('https://h'));

      // Yield so flow A has set the in-flight guard before flow B starts.
      await Future<void>.delayed(const Duration(milliseconds: 10));

      // Flow B starts WHILE A is pending → must be refused immediately. It must
      // NOT have generated a second nonce that consumes A's slot.
      final flowB = await launcher.loginInstance(
        serverUrl: Uri.parse('https://h'),
      );
      expect(
        flowB,
        isNull,
        reason: 'concurrent second login must be refused',
      );
      // Only flow A generated a nonce (B was refused before generating one).
      expect(counter, 1);

      // Now deliver A's genuine callback (its own nonce) — A still completes.
      stream.add(
        Uri.parse(
          'remotedev://auth/callback?scope=instance&apiKey=sk-A'
          '&state=concurrent-0',
        ),
      );
      final resultA = await flowA;
      expect(resultA, isNotNull);
      expect(resultA!.apiKey, 'sk-A');
      await stream.close();
    });

    test(
        'after the first flow resolves, a fresh login is allowed again '
        '(in-flight guard is released)', () async {
      final stream = StreamController<Uri>.broadcast();
      var counter = 0;
      final launcher = MobileCallbackLoginLauncher(
        deepLinkStream: stream.stream,
        stateGenerator: () => 'seq-${counter++}',
        urlLauncher: (_) async => true,
        timeout: const Duration(milliseconds: 60),
      );

      // First flow times out (no callback) → releases the guard.
      final first =
          await launcher.loginInstance(serverUrl: Uri.parse('https://h'));
      expect(first, isNull);

      // A brand-new flow must be permitted and complete with its OWN nonce.
      final secondFuture =
          launcher.loginInstance(serverUrl: Uri.parse('https://h'));
      scheduleMicrotask(() {
        stream.add(
          Uri.parse(
            'remotedev://auth/callback?scope=instance&apiKey=sk-2&state=seq-1',
          ),
        );
      });
      final second = await secondFuture;
      expect(second, isNotNull);
      expect(second!.apiKey, 'sk-2');
      await stream.close();
    });

    test('a concurrent loginHost is refused with a MobileCallbackException',
        () async {
      final stream = StreamController<Uri>.broadcast();
      var counter = 0;
      final launcher = MobileCallbackLoginLauncher(
        deepLinkStream: stream.stream,
        stateGenerator: () => 'host-${counter++}',
        urlLauncher: (_) async => true,
        timeout: const Duration(seconds: 5),
      );

      // Flow A (host) pending.
      final flowA = launcher.loginHost(origin: Uri.parse('https://sup'));
      await Future<void>.delayed(const Duration(milliseconds: 10));

      // Concurrent host login → typed host failure (not a silent hang).
      await expectLater(
        launcher.loginHost(origin: Uri.parse('https://sup')),
        throwsA(isA<MobileCallbackException>()),
      );

      // Flow A still completes on its own callback.
      stream.add(
        Uri.parse(
          'remotedev://auth/callback?scope=host&cfToken=host-jwt&state=host-0',
        ),
      );
      final hostA = await flowA;
      expect(hostA.cfToken, 'host-jwt');
      await stream.close();
    });
  });
}
