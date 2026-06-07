/// Device-local appearance preferences for the mobile app.
///
/// These are non-sensitive UI prefs persisted via [SharedPreferences]. They
/// drive font scale, motion reduction, terminal cursor blink, and the
/// absolute terminal font size.
class AppearanceSettings {
  const AppearanceSettings({
    this.fontScale = 1.0,
    this.reduceMotion = false,
    this.cursorBlink = true,
    this.terminalFontSize = defaultTerminalFontSize,
  });

  /// Multiplier applied to app/embed chrome font sizes. Clamped to
  /// [minFontScale, maxFontScale] when written through the provider. Does
  /// NOT affect the terminal grid — that uses [terminalFontSize].
  final double fontScale;

  /// When true, animations should be shortened or disabled.
  final bool reduceMotion;

  /// When true, the terminal cursor blinks.
  final bool cursorBlink;

  /// Absolute terminal font size in px. Pushed to the embedded terminal via
  /// the rdv-bridge `setFontSize`, and kept in sync with pinch-zoom in the
  /// WebView via the `onFontSizeChanged` event. Clamped to
  /// [minTerminalFontSize, maxTerminalFontSize] when written through the
  /// provider. Mirrors the embed's FONT_SIZE_MIN/MAX/DEFAULT
  /// (src/components/mobile/embed/EmbeddedSessionView.tsx).
  final int terminalFontSize;

  static const double minFontScale = 0.85;
  static const double maxFontScale = 1.30;
  static const double defaultFontScale = 1.0;

  static const int minTerminalFontSize = 9;
  static const int maxTerminalFontSize = 22;
  static const int defaultTerminalFontSize = 12;

  AppearanceSettings copyWith({
    double? fontScale,
    bool? reduceMotion,
    bool? cursorBlink,
    int? terminalFontSize,
  }) =>
      AppearanceSettings(
        fontScale: fontScale ?? this.fontScale,
        reduceMotion: reduceMotion ?? this.reduceMotion,
        cursorBlink: cursorBlink ?? this.cursorBlink,
        terminalFontSize: terminalFontSize ?? this.terminalFontSize,
      );

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is AppearanceSettings &&
          other.fontScale == fontScale &&
          other.reduceMotion == reduceMotion &&
          other.cursorBlink == cursorBlink &&
          other.terminalFontSize == terminalFontSize;

  @override
  int get hashCode =>
      Object.hash(fontScale, reduceMotion, cursorBlink, terminalFontSize);

  @override
  String toString() =>
      'AppearanceSettings(fontScale: $fontScale, reduceMotion: $reduceMotion, '
      'cursorBlink: $cursorBlink, terminalFontSize: $terminalFontSize)';
}
