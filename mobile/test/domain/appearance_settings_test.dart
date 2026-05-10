import 'package:flutter_test/flutter_test.dart';
import 'package:remote_dev/domain/appearance_settings.dart';

void main() {
  test('default values match the documented defaults', () {
    const s = AppearanceSettings();
    expect(s.fontScale, 1.0);
    expect(s.reduceMotion, isFalse);
    expect(s.cursorBlink, isTrue);
  });

  test('copyWith only mutates the supplied fields', () {
    const s = AppearanceSettings();
    final copy = s.copyWith(fontScale: 1.2);
    expect(copy.fontScale, 1.2);
    expect(copy.reduceMotion, s.reduceMotion);
    expect(copy.cursorBlink, s.cursorBlink);
  });

  test('value equality compares all fields', () {
    expect(
      const AppearanceSettings(fontScale: 1.1),
      const AppearanceSettings(fontScale: 1.1),
    );
    expect(
      const AppearanceSettings(fontScale: 1.1) ==
          const AppearanceSettings(fontScale: 1.0),
      isFalse,
    );
  });
}
