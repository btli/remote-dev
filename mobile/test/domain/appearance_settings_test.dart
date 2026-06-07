import 'package:flutter_test/flutter_test.dart';
import 'package:remote_dev/domain/appearance_settings.dart';

void main() {
  test('default values match the documented defaults', () {
    const s = AppearanceSettings();
    expect(s.fontScale, 1.0);
    expect(s.reduceMotion, isFalse);
    expect(s.cursorBlink, isTrue);
    expect(s.terminalFontSize, 12);
    expect(s.terminalFontSize, AppearanceSettings.defaultTerminalFontSize);
  });

  test('terminal font size bounds mirror the embed constants', () {
    expect(AppearanceSettings.minTerminalFontSize, 9);
    expect(AppearanceSettings.maxTerminalFontSize, 22);
    expect(AppearanceSettings.defaultTerminalFontSize, 12);
  });

  test('copyWith only mutates the supplied fields', () {
    const s = AppearanceSettings();
    final copy = s.copyWith(fontScale: 1.2);
    expect(copy.fontScale, 1.2);
    expect(copy.reduceMotion, s.reduceMotion);
    expect(copy.cursorBlink, s.cursorBlink);
    expect(copy.terminalFontSize, s.terminalFontSize);
  });

  test('copyWith updates terminalFontSize independently', () {
    const s = AppearanceSettings();
    final copy = s.copyWith(terminalFontSize: 18);
    expect(copy.terminalFontSize, 18);
    expect(copy.fontScale, s.fontScale);
    expect(copy.reduceMotion, s.reduceMotion);
    expect(copy.cursorBlink, s.cursorBlink);
  });

  test('value equality compares all fields incl. terminalFontSize', () {
    expect(
      const AppearanceSettings(fontScale: 1.1),
      const AppearanceSettings(fontScale: 1.1),
    );
    expect(
      const AppearanceSettings(fontScale: 1.1) ==
          const AppearanceSettings(fontScale: 1.0),
      isFalse,
    );
    expect(
      const AppearanceSettings(terminalFontSize: 14),
      const AppearanceSettings(terminalFontSize: 14),
    );
    expect(
      const AppearanceSettings(terminalFontSize: 14) ==
          const AppearanceSettings(terminalFontSize: 16),
      isFalse,
    );
    // Equal terminalFontSize values produce equal hashCodes.
    expect(
      const AppearanceSettings(terminalFontSize: 14).hashCode,
      const AppearanceSettings(terminalFontSize: 14).hashCode,
    );
  });
}
