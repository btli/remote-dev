import 'package:flutter_test/flutter_test.dart';
import 'package:remote_dev/domain/biometric_settings.dart';

void main() {
  group('BiometricSettings', () {
    test('defaults: disabled, 60s grace, cold-start required', () {
      const s = BiometricSettings();
      expect(s.enabled, isFalse);
      expect(s.gracePeriodSeconds, 60);
      expect(s.requireOnColdStart, isTrue);
    });

    test('round-trips through JSON', () {
      const s = BiometricSettings(
        enabled: true,
        gracePeriodSeconds: 300,
        requireOnColdStart: false,
      );
      final json = s.toJson();
      final restored = BiometricSettings.fromJson(json);
      expect(restored, equals(s));
    });

    test('copyWith preserves untouched fields', () {
      const s = BiometricSettings();
      final updated = s.copyWith(enabled: true);
      expect(updated.enabled, isTrue);
      expect(updated.gracePeriodSeconds, 60);
      expect(updated.requireOnColdStart, isTrue);
    });
  });
}
