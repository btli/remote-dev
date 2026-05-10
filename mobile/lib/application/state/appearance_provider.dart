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
///
/// If the user mutates settings before hydration completes, the user's value
/// wins: hydration becomes a no-op once `_userTouched` flips true. This avoids
/// clobbering an early tap on a slow device.
class AppearanceNotifier extends StateNotifier<AppearanceSettings> {
  AppearanceNotifier() : super(const AppearanceSettings()) {
    _hydrate();
  }

  /// Test seam: construct with an already-resolved [SharedPreferences] so
  /// widget tests don't have to await hydration.
  AppearanceNotifier.test(SharedPreferences prefs)
      : _prefs = prefs,
        _hydrated = true,
        super(_readFromPrefs(prefs));

  SharedPreferences? _prefs;
  bool _hydrated = false;
  bool _userTouched = false;

  /// Visible for tests: true once hydration has completed (or was bypassed
  /// via the [AppearanceNotifier.test] seam).
  bool get isHydrated => _hydrated;

  Future<void> _hydrate() async {
    final prefs = await SharedPreferences.getInstance();
    _prefs = prefs;
    if (_userTouched) {
      // User beat us to a write — keep their state, just remember the prefs
      // handle so future setters don't need to re-await getInstance().
      _hydrated = true;
      return;
    }
    final hydrated = _readFromPrefs(prefs);
    if (mounted) {
      state = hydrated;
    }
    _hydrated = true;
  }

  static AppearanceSettings _readFromPrefs(SharedPreferences prefs) {
    final rawScale = prefs.getDouble(AppearancePrefsKeys.fontScale);
    final scale = rawScale == null
        ? AppearanceSettings.defaultFontScale
        : _quantizeScale(_clampScale(rawScale));
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

  /// Round to 2 decimal places to keep stored values stable across reads
  /// (avoids tiny float drift like 1.1500000000000001 from slider drags).
  static double _quantizeScale(double v) => (v * 100).round() / 100;

  Future<void> setFontScale(double value) async {
    _userTouched = true;
    final quantized = _quantizeScale(_clampScale(value));
    state = state.copyWith(fontScale: quantized);
    final prefs = _prefs ?? await SharedPreferences.getInstance();
    _prefs = prefs;
    await prefs.setDouble(AppearancePrefsKeys.fontScale, quantized);
  }

  Future<void> setReduceMotion(bool value) async {
    _userTouched = true;
    state = state.copyWith(reduceMotion: value);
    final prefs = _prefs ?? await SharedPreferences.getInstance();
    _prefs = prefs;
    await prefs.setBool(AppearancePrefsKeys.reduceMotion, value);
  }

  Future<void> setCursorBlink(bool value) async {
    _userTouched = true;
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
