import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:remote_dev/application/ports/api_client_port.dart';
import 'package:remote_dev/application/ports/connectivity_port.dart';
import 'package:remote_dev/application/ports/host_workspace_store.dart';
import 'package:remote_dev/application/ports/push_port.dart';
import 'package:remote_dev/domain/auth_cookie.dart';
import 'package:remote_dev/domain/host_config.dart';
import 'package:remote_dev/domain/workspace_config.dart';
import 'package:remote_dev/infrastructure/auth/mobile_credentials.dart';
import 'package:remote_dev/infrastructure/push/push_token_registrar.dart';

class _MockPush extends Mock implements PushPort {}

class _MockStore extends Mock implements HostWorkspaceStore {}

class _MockCredentials extends Mock implements MobileCredentialsStore {}

class _MockClient extends Mock implements ApiClientPort {}

/// A connectivity fake whose stream is a plain broadcast controller — it does
/// NOT de-dupe, so tests can model the de-duped adapter (single emissions) by
/// simply adding one event per transition, or stress the registrar by adding
/// many. Mirrors the fake in push_token_registrar_test.dart.
class _FakeConnectivity implements ConnectivityPort {
  final controller = StreamController<bool>.broadcast();

  @override
  Stream<bool> get onConnectivityChanged => controller.stream;

  @override
  Future<bool> isOnline() async => true;
}

const _pushTokenPath = '/api/notifications/push-token';

void main() {
  setUpAll(() {
    registerFallbackValue(<String, dynamic>{});
  });

  late _MockPush push;
  late _MockStore store;
  late _MockCredentials credentials;
  late StreamController<String> refresh;

  setUp(() {
    push = _MockPush();
    store = _MockStore();
    credentials = _MockCredentials();
    refresh = StreamController<String>.broadcast();
    when(() => push.onTokenRefresh).thenAnswer((_) => refresh.stream);
    when(() => credentials.getWorkspaceAuthCookies(any()))
        .thenAnswer((_) async => const <AuthCookie>[]);
  });

  tearDown(() async {
    await refresh.close();
  });

  final now = DateTime(2026, 6, 6);

  HostConfig host(String id) => HostConfig(
        id: id,
        label: id,
        origin: 'https://rdv.joyful.house',
        kind: HostKind.multiWorkspace,
        createdAt: now,
        lastUsedAt: now,
      );

  WorkspaceConfig ws(String id, {required String hostId}) => WorkspaceConfig(
        id: id,
        hostId: hostId,
        slug: '',
        basePath: '',
        displayName: id,
        lastUsedAt: now,
      );

  test(
    'one connectivity event during an in-flight failing pass coalesces into '
    'exactly one follow-up retry (bounded, not per-event)',
    () async {
      // Gate the first POST so the initial pass is still in-flight when the
      // connectivity event arrives — exercising the _busy/_retryQueued
      // coalescing path that the cellular flood used to abuse.
      final firstCallGate = Completer<void>();
      var calls = 0;
      final clientA = _MockClient();
      when(() => clientA.post(any(), body: any(named: 'body')))
          .thenAnswer((_) async {
        calls++;
        if (calls == 1) {
          await firstCallGate.future; // hold the in-flight pass open
          throw Exception('cf-302'); // ...then fail (persistent CF 302)
        }
        // Every subsequent attempt also fails (persistent failure).
        throw Exception('cf-302');
      });
      when(() => push.initialize()).thenAnswer((_) async => true);
      when(() => push.getToken()).thenAnswer((_) async => 'tok-1');

      final h = host('h1');
      when(store.loadWorkspaces)
          .thenAnswer((_) async => [ws('a', hostId: 'h1')]);
      when(() => store.loadHost('h1')).thenAnswer((_) async => h);
      when(() => credentials.getWorkspaceApiKey('a'))
          .thenAnswer((_) async => 'key-a');

      final conn = _FakeConnectivity();
      final registrar = PushTokenRegistrar(
        push: push,
        store: store,
        credentials: credentials,
        clientFactory: (_, __) => clientA,
        deviceId: 'dev-1',
        // No backoff timer here so we measure ONLY the coalesced follow-up,
        // not timer-driven retries.
        connectivity: conn,
      );

      // start() kicks off the first (gated) pass. Don't await — it blocks on
      // the gate until we release it.
      unawaited(registrar.start());
      await pumpEventQueue();
      expect(calls, 1, reason: 'first POST is in-flight (gated)');

      // Fire several connectivity 'true' events WHILE the pass is in-flight.
      // They must all collapse into a single queued follow-up.
      conn.controller
        ..add(true)
        ..add(true)
        ..add(true);
      await pumpEventQueue();
      expect(calls, 1, reason: 'queued while busy; no retry runs mid-pass');

      // Release the in-flight pass: it fails → pending {a} → _afterPass runs
      // the single coalesced retry exactly once (which also fails).
      firstCallGate.complete();
      await pumpEventQueue();

      // Bounded: the initial attempt + exactly one coalesced retry = 2.
      // (Pre-fix, three raw events would have driven three immediate retries.)
      expect(calls, 2);

      await registrar.stop();
      await conn.controller.close();
    },
  );

  test(
    'a persistent failure settles into the exponential backoff cadence '
    '(no tight per-event loop) when connectivity events are de-duped',
    () async {
      // Every POST fails (persistent CF 302). With the adapter de-duping
      // connectivity (one bool per transition), the registrar must NOT spin —
      // retries should be governed by the bounded backoff timer.
      var calls = 0;
      final clientA = _MockClient();
      when(() => clientA.post(any(), body: any(named: 'body')))
          .thenAnswer((_) async {
        calls++;
        throw Exception('cf-302');
      });
      when(() => push.initialize()).thenAnswer((_) async => true);
      when(() => push.getToken()).thenAnswer((_) async => 'tok-1');

      final h = host('h1');
      when(store.loadWorkspaces)
          .thenAnswer((_) async => [ws('a', hostId: 'h1')]);
      when(() => store.loadHost('h1')).thenAnswer((_) async => h);
      when(() => credentials.getWorkspaceApiKey('a'))
          .thenAnswer((_) async => 'key-a');

      final conn = _FakeConnectivity();
      final registrar = PushTokenRegistrar(
        push: push,
        store: store,
        credentials: credentials,
        clientFactory: (_, __) => clientA,
        deviceId: 'dev-1',
        connectivity: conn,
        // Short base so the test runs fast; the doubling (10→20→40→80ms…)
        // means only a handful of timer firings fit in the window below.
        backoffBase: const Duration(milliseconds: 10),
        backoffCap: const Duration(milliseconds: 80),
      );

      await registrar.start(); // attempt 1 fails → pending {a}, timer armed
      expect(calls, 1);

      // Model the de-duped adapter: a single 'true' per genuine transition.
      // Even one extra event only adds one coalesced retry, not a storm.
      conn.controller.add(true);
      await pumpEventQueue();
      // attempt 2 from the connectivity retry (still failing).
      expect(calls, 2);

      // Let the backoff timer drive retries for a bounded window. With base
      // 10ms doubling to a 80ms cap, ~200ms admits only a SMALL number of
      // firings — proving the cadence is timer-governed, not a tight loop.
      await Future<void>.delayed(const Duration(milliseconds: 220));
      await registrar.stop();

      // Tight-loop (pre-fix) behaviour would be dozens-to-hundreds of calls in
      // 220ms. Backoff keeps it to a handful. Assert a generous upper bound so
      // the test is robust to timer scheduling jitter but still fails loudly
      // on a spin.
      expect(
        calls,
        lessThan(12),
        reason: 'persistent failure must back off, not spin per event',
      );
      // And it did keep retrying (made progress beyond the first two attempts).
      expect(calls, greaterThanOrEqualTo(3));

      await conn.controller.close();
    },
  );

  test(
    'verifyPosted sanity: a recovering failure clears pending and stops',
    () async {
      // Guards that the backoff machinery still terminates once the failure
      // clears — pending empties, the timer cancels, no further POSTs.
      var calls = 0;
      final clientA = _MockClient();
      when(() => clientA.post(any(), body: any(named: 'body')))
          .thenAnswer((_) async {
        calls++;
        if (calls == 1) throw Exception('cf-302');
        return null; // recovers on retry
      });
      when(() => push.initialize()).thenAnswer((_) async => true);
      when(() => push.getToken()).thenAnswer((_) async => 'tok-1');

      final h = host('h1');
      when(store.loadWorkspaces)
          .thenAnswer((_) async => [ws('a', hostId: 'h1')]);
      when(() => store.loadHost('h1')).thenAnswer((_) async => h);
      when(() => credentials.getWorkspaceApiKey('a'))
          .thenAnswer((_) async => 'key-a');

      final registrar = PushTokenRegistrar(
        push: push,
        store: store,
        credentials: credentials,
        clientFactory: (_, __) => clientA,
        deviceId: 'dev-1',
        backoffBase: const Duration(milliseconds: 10),
      );

      await registrar.registerWithAll('tok-1'); // fails → pending, timer armed
      await Future<void>.delayed(const Duration(milliseconds: 40));
      // Timer fired once, retry succeeded → pending empty → timer cancelled.
      expect(calls, 2);
      await Future<void>.delayed(const Duration(milliseconds: 40));
      expect(calls, 2, reason: 'no further retries once pending is empty');

      verify(() => clientA.post(_pushTokenPath, body: any(named: 'body')))
          .called(2);

      await registrar.stop();
    },
  );
}
