import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:remote_dev/application/ports/secure_storage_port.dart';
import 'package:remote_dev/domain/biometric_settings.dart';
import 'package:remote_dev/infrastructure/biometric/biometric_settings_store.dart';

class _MockStorage extends Mock implements SecureStoragePort {}

void main() {
  late _MockStorage storage;
  late BiometricSettingsStore store;

  setUp(() {
    storage = _MockStorage();
    store = BiometricSettingsStore(storage);
  });

  test('load returns defaults when nothing is stored', () async {
    when(() => storage.read('__meta__', 'biometric_settings'))
        .thenAnswer((_) async => null);
    expect(await store.load(), equals(const BiometricSettings()));
  });

  test('load returns defaults on empty string', () async {
    when(() => storage.read('__meta__', 'biometric_settings'))
        .thenAnswer((_) async => '');
    expect(await store.load(), equals(const BiometricSettings()));
  });

  test('load decodes stored JSON', () async {
    when(() => storage.read('__meta__', 'biometric_settings')).thenAnswer(
      (_) async => jsonEncode({
        'enabled': true,
        'gracePeriodSeconds': 300,
        'requireOnColdStart': false,
      }),
    );
    final loaded = await store.load();
    expect(loaded.enabled, isTrue);
    expect(loaded.gracePeriodSeconds, 300);
    expect(loaded.requireOnColdStart, isFalse);
  });

  test('save writes encoded JSON to the meta namespace', () async {
    when(() => storage.write(any(), any(), any())).thenAnswer((_) async {});

    await store.save(
      const BiometricSettings(
        enabled: true,
        gracePeriodSeconds: 60,
      ),
    );

    final captured = verify(
      () => storage.write('__meta__', 'biometric_settings', captureAny()),
    ).captured.single as String;
    final decoded = jsonDecode(captured) as Map<String, dynamic>;
    expect(decoded['enabled'], isTrue);
    expect(decoded['gracePeriodSeconds'], 60);
    expect(decoded['requireOnColdStart'], isTrue);
  });
}
