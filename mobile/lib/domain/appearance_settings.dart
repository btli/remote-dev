/// Device-local appearance preferences for the mobile app.
///
/// These are non-sensitive UI prefs persisted via [SharedPreferences]. They
/// drive font scale, motion reduction, and terminal cursor blink behavior.
class AppearanceSettings {
  const AppearanceSettings({
    this.fontScale = 1.0,
    this.reduceMotion = false,
    this.cursorBlink = true,
  });

  /// Multiplier applied to base font sizes. Clamped to [minFontScale,
  /// maxFontScale] when written through the provider.
  final double fontScale;

  /// When true, animations should be shortened or disabled.
  final bool reduceMotion;

  /// When true, the terminal cursor blinks.
  final bool cursorBlink;

  static const double minFontScale = 0.85;
  static const double maxFontScale = 1.30;
  static const double defaultFontScale = 1.0;

  AppearanceSettings copyWith({
    double? fontScale,
    bool? reduceMotion,
    bool? cursorBlink,
  }) =>
      AppearanceSettings(
        fontScale: fontScale ?? this.fontScale,
        reduceMotion: reduceMotion ?? this.reduceMotion,
        cursorBlink: cursorBlink ?? this.cursorBlink,
      );

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is AppearanceSettings &&
          other.fontScale == fontScale &&
          other.reduceMotion == reduceMotion &&
          other.cursorBlink == cursorBlink;

  @override
  int get hashCode => Object.hash(fontScale, reduceMotion, cursorBlink);

  @override
  String toString() =>
      'AppearanceSettings(fontScale: $fontScale, reduceMotion: $reduceMotion, '
      'cursorBlink: $cursorBlink)';
}
