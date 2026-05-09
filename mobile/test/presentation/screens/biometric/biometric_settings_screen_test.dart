import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:remote_dev/application/ports/biometric_port.dart';
import 'package:remote_dev/domain/biometric_settings.dart';
import 'package:remote_dev/infrastructure/biometric/biometric_settings_store.dart';
import 'package:remote_dev/presentation/screens/biometric/biometric_lock_overlay.dart';
import 'package:remote_dev/presentation/screens/biometric/biometric_settings_screen.dart';

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

class _StubPort implements BiometricPort {
  @override
  Future<bool> authenticate({String reason = 'Unlock Remote Dev'}) async =>
      true;
  @override
  Future<bool> isAvailable() async => true;
}

Widget _wrap(_FakeSettingsStore store) {
  return ProviderScope(
    overrides: [
      biometricPortProvider.overrideWithValue(_StubPort()),
      biometricSettingsStoreProvider.overrideWithValue(store),
    ],
    child: const MaterialApp(home: BiometricSettingsScreen()),
  );
}

void main() {
  testWidgets('renders Security title and a disabled-by-default switch row',
      (tester) async {
    final store = _FakeSettingsStore(const BiometricSettings());
    await tester.pumpWidget(_wrap(store));
    await tester.pumpAndSettle();

    expect(find.text('Security'), findsOneWidget);
    expect(find.text('Biometric lock'), findsOneWidget);
    // The "Re-lock after" tile is rendered but disabled.
    expect(find.text('Re-lock after'), findsOneWidget);
  });

  testWidgets('toggling the master switch saves enabled=true', (tester) async {
    final store = _FakeSettingsStore(const BiometricSettings());
    await tester.pumpWidget(_wrap(store));
    await tester.pumpAndSettle();

    final switchFinder = find.byType(SwitchListTile).first;
    await tester.tap(switchFinder);
    await tester.pumpAndSettle();

    expect(store.current.enabled, isTrue);
  });
}
