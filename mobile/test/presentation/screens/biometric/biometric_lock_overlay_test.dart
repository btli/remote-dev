import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:remote_dev/application/ports/biometric_port.dart';
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
  Widget child = const _ChildSentinel(),
}) {
  return ProviderScope(
    overrides: [
      biometricPortProvider.overrideWithValue(port),
      biometricSettingsStoreProvider
          .overrideWithValue(_FakeSettingsStore(initial)),
    ],
    child: MaterialApp(
      home: BiometricLockOverlay(child: child),
    ),
  );
}

class _ChildSentinel extends StatelessWidget {
  const _ChildSentinel();

  @override
  Widget build(BuildContext context) {
    return const Scaffold(
      body: Center(child: Text('child-content')),
    );
  }
}

void main() {
  group('BiometricLockOverlay', () {
    testWidgets('does not lock when biometrics are disabled', (tester) async {
      await tester.pumpWidget(
        _wrap(
          initial: const BiometricSettings(),
          port: _FakeBiometricPort(),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.byType(BiometricLockScreen), findsNothing);
      expect(find.text('child-content'), findsOneWidget);
    });

    testWidgets('cold-start locks when enabled + requireOnColdStart',
        (tester) async {
      await tester.pumpWidget(
        _wrap(
          initial: const BiometricSettings(
            enabled: true,
            requireOnColdStart: true,
          ),
          port: _FakeBiometricPort(),
        ),
      );
      // Two pump cycles: one to flush initState's microtask, one for setState.
      await tester.pumpAndSettle();

      expect(find.byType(BiometricLockScreen), findsOneWidget);
      expect(find.text('Remote Dev locked'), findsOneWidget);
      // Child still mounted under the overlay (Stack-based).
      expect(find.text('child-content'), findsOneWidget);
    });

    testWidgets('cold-start does not lock when requireOnColdStart is false',
        (tester) async {
      await tester.pumpWidget(
        _wrap(
          initial: const BiometricSettings(
            enabled: true,
            requireOnColdStart: false,
          ),
          port: _FakeBiometricPort(),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.byType(BiometricLockScreen), findsNothing);
    });

    testWidgets('successful authenticate hides the lock screen',
        (tester) async {
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

      expect(find.byType(BiometricLockScreen), findsOneWidget);

      await tester.tap(find.text('Authenticate'));
      await tester.pumpAndSettle();

      expect(port.authCalls, 1);
      expect(find.byType(BiometricLockScreen), findsNothing);
    });

    testWidgets('failed authenticate keeps the lock screen visible',
        (tester) async {
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

      await tester.tap(find.text('Authenticate'));
      await tester.pumpAndSettle();

      expect(port.authCalls, 1);
      expect(find.byType(BiometricLockScreen), findsOneWidget);
    });
  });
}
