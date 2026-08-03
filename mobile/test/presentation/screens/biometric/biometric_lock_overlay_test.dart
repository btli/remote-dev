import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:remote_dev/application/ports/biometric_port.dart';
import 'package:remote_dev/application/state/clipboard_access_readiness_provider.dart';
import 'package:remote_dev/domain/biometric_settings.dart';
import 'package:remote_dev/infrastructure/biometric/biometric_settings_store.dart';
import 'package:remote_dev/presentation/screens/biometric/biometric_lock_overlay.dart';
import 'package:remote_dev/presentation/screens/biometric/biometric_lock_screen.dart';

/// In-memory settings store backed by a single mutable [BiometricSettings]
/// reference. Avoids touching real secure storage in widget tests.
class _FakeSettingsStore implements BiometricSettingsStore {
  _FakeSettingsStore(this.current);
  BiometricSettings current;

  @override
  Future<BiometricSettings> load() async => current;

  @override
  Future<void> save(BiometricSettings s) async {
    current = s;
  }
}

class _DeferredSettingsStore implements BiometricSettingsStore {
  final Completer<BiometricSettings> completer = Completer<BiometricSettings>();

  @override
  Future<BiometricSettings> load() => completer.future;

  @override
  Future<void> save(BiometricSettings settings) async {}
}

/// Configurable [BiometricPort] fake. [authenticate] returns [authResult].
class _FakeBiometricPort implements BiometricPort {
  _FakeBiometricPort({this.authResult = true});
  final bool authResult;
  int authCalls = 0;

  @override
  Future<bool> isAvailable() async => true;

  @override
  Future<bool> authenticate({String reason = 'Unlock Remote Dev'}) async {
    authCalls += 1;
    return authResult;
  }
}

Widget _wrap({
  required BiometricSettings initial,
  required _FakeBiometricPort port,
  BiometricSettingsStore? store,
  Widget child = const _ChildSentinel(),
}) {
  return ProviderScope(
    overrides: [
      biometricPortProvider.overrideWithValue(port),
      biometricSettingsStoreProvider.overrideWithValue(
        store ?? _FakeSettingsStore(initial),
      ),
    ],
    child: MaterialApp(home: BiometricLockOverlay(child: child)),
  );
}

class _ChildSentinel extends ConsumerWidget {
  const _ChildSentinel();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final ready = ref.watch(clipboardAccessReadyProvider);
    return Scaffold(
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text('child-content'),
            Text(ready ? 'clipboard-ready' : 'clipboard-blocked'),
          ],
        ),
      ),
    );
  }
}

void main() {
  group('BiometricLockOverlay', () {
    setUp(() {
      TestWidgetsFlutterBinding.ensureInitialized()
          .handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    });

    testWidgets('cold start remains fail closed until settings resolve', (
      tester,
    ) async {
      final port = _FakeBiometricPort();
      final store = _DeferredSettingsStore();
      await tester.pumpWidget(
        _wrap(initial: const BiometricSettings(), port: port, store: store),
      );
      await tester.pump();

      expect(find.text('clipboard-blocked'), findsOneWidget);

      store.completer.complete(const BiometricSettings());
      await tester.pumpAndSettle();
      expect(find.text('clipboard-ready'), findsOneWidget);
    });

    testWidgets('does not lock when biometrics are disabled', (tester) async {
      final port = _FakeBiometricPort();
      await tester.pumpWidget(
        _wrap(initial: const BiometricSettings(), port: port),
      );
      await tester.pumpAndSettle();

      expect(find.byType(BiometricLockScreen), findsNothing);
      expect(find.text('child-content'), findsOneWidget);
      expect(find.text('clipboard-ready'), findsOneWidget);
      expect(port.authCalls, 0); // disabled → never prompts
    });

    testWidgets('cold-start auto-presents the prompt and unlocks on success', (
      tester,
    ) async {
      final port = _FakeBiometricPort(authResult: true);
      await tester.pumpWidget(
        _wrap(
          initial: const BiometricSettings(
            enabled: true,
            requireOnColdStart: true,
          ),
          port: port,
        ),
      );
      await tester.pumpAndSettle();

      // The prompt fired automatically (no tap); on success the lock is
      // dismissed — the user never sees the "Authenticate" button.
      expect(port.authCalls, 1);
      expect(find.byType(BiometricLockScreen), findsNothing);
      expect(find.text('child-content'), findsOneWidget);
      expect(find.text('clipboard-ready'), findsOneWidget);
    });

    testWidgets('cold-start auto-prompt failure keeps lock visible with error', (
      tester,
    ) async {
      final port = _FakeBiometricPort(authResult: false);
      await tester.pumpWidget(
        _wrap(
          initial: const BiometricSettings(
            enabled: true,
            requireOnColdStart: true,
          ),
          port: port,
        ),
      );
      await tester.pumpAndSettle();

      // Auto-prompt fired once, failed → lock stays up with an inline error and
      // the manual button as fallback.
      expect(port.authCalls, 1);
      expect(find.byType(BiometricLockScreen), findsOneWidget);
      expect(find.text('Authentication failed'), findsOneWidget);
      expect(find.text('Authenticate'), findsOneWidget);
      expect(find.text('clipboard-blocked'), findsOneWidget);
    });

    testWidgets('does not auto-loop the prompt after a failure', (
      tester,
    ) async {
      final port = _FakeBiometricPort(authResult: false);
      await tester.pumpWidget(
        _wrap(
          initial: const BiometricSettings(
            enabled: true,
            requireOnColdStart: true,
          ),
          port: port,
        ),
      );
      await tester.pumpAndSettle();

      // Extra frames must not trigger further prompts — exactly one auto-prompt.
      await tester.pump(const Duration(seconds: 1));
      await tester.pumpAndSettle();
      expect(port.authCalls, 1);
      expect(find.byType(BiometricLockScreen), findsOneWidget);
    });

    testWidgets('manual button retries after an auto-prompt failure', (
      tester,
    ) async {
      final port = _FakeBiometricPort(authResult: false);
      await tester.pumpWidget(
        _wrap(
          initial: const BiometricSettings(
            enabled: true,
            requireOnColdStart: true,
          ),
          port: port,
        ),
      );
      await tester.pumpAndSettle();
      expect(port.authCalls, 1); // auto-prompt

      await tester.tap(find.text('Authenticate'));
      await tester.pumpAndSettle();
      expect(port.authCalls, 2); // manual retry still works
      expect(find.byType(BiometricLockScreen), findsOneWidget);
    });

    testWidgets('cold-start does not lock when requireOnColdStart is false', (
      tester,
    ) async {
      final port = _FakeBiometricPort();
      await tester.pumpWidget(
        _wrap(
          initial: const BiometricSettings(
            enabled: true,
            requireOnColdStart: false,
          ),
          port: port,
        ),
      );
      await tester.pumpAndSettle();

      expect(find.byType(BiometricLockScreen), findsNothing);
      expect(port.authCalls, 0);
      expect(find.text('clipboard-ready'), findsOneWidget);
    });

    testWidgets(
      'resume after grace auto-presents the prompt and unlocks on success',
      (tester) async {
        final port = _FakeBiometricPort(authResult: true);
        await tester.pumpWidget(
          _wrap(
            initial: const BiometricSettings(
              enabled: true,
              requireOnColdStart: false, // no cold lock; we drive a resume
              gracePeriodSeconds: 0,
            ),
            port: port,
          ),
        );
        await tester.pumpAndSettle();
        expect(find.byType(BiometricLockScreen), findsNothing);

        // Drive a background→foreground cycle through valid lifecycle states.
        // Only `resumed` triggers the overlay's handler.
        tester.binding.handleAppLifecycleStateChanged(
          AppLifecycleState.inactive,
        );
        tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.hidden);
        tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
        tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.hidden);
        tester.binding.handleAppLifecycleStateChanged(
          AppLifecycleState.inactive,
        );
        tester.binding.handleAppLifecycleStateChanged(
          AppLifecycleState.resumed,
        );
        await tester.pumpAndSettle();

        // Resume locked the app AND auto-presented the prompt (no tap); success
        // dismissed it.
        expect(port.authCalls, 1);
        expect(find.byType(BiometricLockScreen), findsNothing);
        expect(find.text('clipboard-ready'), findsOneWidget);
      },
    );

    testWidgets('non-resumed states synchronously revoke clipboard readiness', (
      tester,
    ) async {
      final port = _FakeBiometricPort();
      await tester.pumpWidget(
        _wrap(initial: const BiometricSettings(), port: port),
      );
      await tester.pumpAndSettle();
      expect(find.text('clipboard-ready'), findsOneWidget);

      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
      await tester.pump();
      expect(find.text('clipboard-blocked'), findsOneWidget);

      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.hidden);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.hidden);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await tester.pumpAndSettle();
      expect(find.text('clipboard-ready'), findsOneWidget);
    });

    testWidgets('resume authentication failure keeps clipboard unavailable', (
      tester,
    ) async {
      final port = _FakeBiometricPort(authResult: false);
      await tester.pumpWidget(
        _wrap(
          initial: const BiometricSettings(
            enabled: true,
            requireOnColdStart: false,
            gracePeriodSeconds: 0,
          ),
          port: port,
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('clipboard-ready'), findsOneWidget);

      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.hidden);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.hidden);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await tester.pumpAndSettle();

      expect(port.authCalls, 1);
      expect(find.byType(BiometricLockScreen), findsOneWidget);
      expect(find.text('clipboard-blocked'), findsOneWidget);
    });
  });
}
