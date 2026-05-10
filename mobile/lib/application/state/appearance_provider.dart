import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../domain/appearance_settings.dart';

/// Storage keys used by [AppearanceNotifier]. Stable across versions.
class AppearancePrefsKeys {
  static const fontScale = 'appearance.fontScale';
  static const reduceMotion = 'appearance.reduceMotion';
  static const cursorBlink = 'appearance.cursorBlink';
}

/// StateNotifier that owns the device-local [AppearanceSettings] and
/// persists every change to [SharedPreferences].
///
/// Hydration is asynchronous: the notifier starts at defaults and transitions
/// to the persisted state as soon as `SharedPreferences.getInstance()` resolves.
/// Tests can pre-seed with [SharedPreferences.setMockInitialValues] and then
/// `await tester.pumpAndSettle()` to observe the hydrated state, or pass an
/// already-hydrated [SharedPreferences] via [AppearanceNotifier.test].
class AppearanceNotifier extends StateNotifier<AppearanceSettings> {
  AppearanceNotifier() : super(const AppearanceSettings()) {
    _hydrate();
  }

  /// Test seam: construct with an already-resolved [SharedPreferences] so
  /// widget tests don't have to await hydration.
  AppearanceNotifier.test(SharedPreferences prefs)
      : _prefs = prefs,
        super(_readFromPrefs(prefs));

  SharedPreferences? _prefs;

  Future<void> _hydrate() async {
    final prefs = await SharedPreferences.getInstance();
    _prefs = prefs;
    final hydrated = _readFromPrefs(prefs);
    if (mounted) {
      state = hydrated;
    }
  }

  static AppearanceSettings _readFromPrefs(SharedPreferences prefs) {
    final rawScale = prefs.getDouble(AppearancePrefsKeys.fontScale);
    final scale = rawScale == null
        ? AppearanceSettings.defaultFontScale
        : _clampScale(rawScale);
    return AppearanceSettings(
      fontScale: scale,
      reduceMotion:
          prefs.getBool(AppearancePrefsKeys.reduceMotion) ?? false,
      cursorBlink: prefs.getBool(AppearancePrefsKeys.cursorBlink) ?? true,
    );
  }

  static double _clampScale(double v) {
    if (v < AppearanceSettings.minFontScale) {
      return AppearanceSettings.minFontScale;
    }
    if (v > AppearanceSettings.maxFontScale) {
      return AppearanceSettings.maxFontScale;
    }
    return v;
  }

  Future<void> setFontScale(double value) async {
    final clamped = _clampScale(value);
    state = state.copyWith(fontScale: clamped);
    final prefs = _prefs ?? await SharedPreferences.getInstance();
    _prefs = prefs;
    await prefs.setDouble(AppearancePrefsKeys.fontScale, clamped);
  }

  Future<void> setReduceMotion(bool value) async {
    state = state.copyWith(reduceMotion: value);
    final prefs = _prefs ?? await SharedPreferences.getInstance();
    _prefs = prefs;
    await prefs.setBool(AppearancePrefsKeys.reduceMotion, value);
  }

  Future<void> setCursorBlink(bool value) async {
    state = state.copyWith(cursorBlink: value);
    final prefs = _prefs ?? await SharedPreferences.getInstance();
    _prefs = prefs;
    await prefs.setBool(AppearancePrefsKeys.cursorBlink, value);
  }
}

/// App-wide appearance preferences. Read with `ref.watch`, mutate via
/// `ref.read(appearanceSettingsProvider.notifier).setX(...)`.
final appearanceSettingsProvider =
    StateNotifierProvider<AppearanceNotifier, AppearanceSettings>(
  (ref) => AppearanceNotifier(),
);
