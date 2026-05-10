import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:remote_dev/application/state/appearance_provider.dart';
import 'package:remote_dev/domain/appearance_settings.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });

  test('hydrates with defaults when prefs are empty', () async {
    final container = ProviderContainer();
    addTearDown(container.dispose);

    // Pump the microtask queue so async hydration completes.
    await Future<void>.delayed(Duration.zero);

    final state = container.read(appearanceSettingsProvider);
    expect(state.fontScale, AppearanceSettings.defaultFontScale);
    expect(state.reduceMotion, isFalse);
    expect(state.cursorBlink, isTrue);
  });

  test('writes each preference to SharedPreferences', () async {
    final container = ProviderContainer();
    addTearDown(container.dispose);

    final notifier = container.read(appearanceSettingsProvider.notifier);
    await notifier.setFontScale(1.15);
    await notifier.setReduceMotion(true);
    await notifier.setCursorBlink(false);

    final prefs = await SharedPreferences.getInstance();
    expect(prefs.getDouble(AppearancePrefsKeys.fontScale), 1.15);
    expect(prefs.getBool(AppearancePrefsKeys.reduceMotion), isTrue);
    expect(prefs.getBool(AppearancePrefsKeys.cursorBlink), isFalse);

    final state = container.read(appearanceSettingsProvider);
    expect(state.fontScale, 1.15);
    expect(state.reduceMotion, isTrue);
    expect(state.cursorBlink, isFalse);
  });

  test('clamps font scale to allowed range', () async {
    final container = ProviderContainer();
    addTearDown(container.dispose);

    final notifier = container.read(appearanceSettingsProvider.notifier);
    await notifier.setFontScale(5.0);
    expect(
      container.read(appearanceSettingsProvider).fontScale,
      AppearanceSettings.maxFontScale,
    );

    await notifier.setFontScale(0.1);
    expect(
      container.read(appearanceSettingsProvider).fontScale,
      AppearanceSettings.minFontScale,
    );
  });

  test('rehydrates persisted values via the test seam', () async {
    SharedPreferences.setMockInitialValues({
      AppearancePrefsKeys.fontScale: 1.10,
      AppearancePrefsKeys.reduceMotion: true,
      AppearancePrefsKeys.cursorBlink: false,
    });
    final prefs = await SharedPreferences.getInstance();

    final container = ProviderContainer(
      overrides: [
        appearanceSettingsProvider.overrideWith(
          (ref) => AppearanceNotifier.test(prefs),
        ),
      ],
    );
    addTearDown(container.dispose);

    final state = container.read(appearanceSettingsProvider);
    expect(state.fontScale, 1.10);
    expect(state.reduceMotion, isTrue);
    expect(state.cursorBlink, isFalse);
  });

  test('clamps an out-of-range persisted font scale on hydrate', () async {
    SharedPreferences.setMockInitialValues({
      AppearancePrefsKeys.fontScale: 9.99,
    });
    final prefs = await SharedPreferences.getInstance();

    final container = ProviderContainer(
      overrides: [
        appearanceSettingsProvider.overrideWith(
          (ref) => AppearanceNotifier.test(prefs),
        ),
      ],
    );
    addTearDown(container.dispose);

    expect(
      container.read(appearanceSettingsProvider).fontScale,
      AppearanceSettings.maxFontScale,
    );
  });

  test('AppearanceNotifier.test seam reads prefs synchronously', () async {
    SharedPreferences.setMockInitialValues({
      AppearancePrefsKeys.fontScale: 1.05,
      AppearancePrefsKeys.reduceMotion: true,
    });
    final prefs = await SharedPreferences.getInstance();
    final notifier = AppearanceNotifier.test(prefs);
    addTearDown(notifier.dispose);

    expect(notifier.state.fontScale, 1.05);
    expect(notifier.state.reduceMotion, isTrue);
    expect(notifier.state.cursorBlink, isTrue); // default
  });
}
