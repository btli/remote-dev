import 'package:xterm/xterm.dart' as xterm;

import 'package:remote_dev/presentation/theme/oklch.dart';

/// Terminal color palette matching the backend's TerminalPalette interface.
/// All colors are hex strings (#RRGGBB).
class TerminalPalette {
  final String background;
  final String foreground;
  final String cursor;
  final String cursorAccent;
  final String selectionBackground;
  final String black;
  final String red;
  final String green;
  final String yellow;
  final String blue;
  final String magenta;
  final String cyan;
  final String white;
  final String brightBlack;
  final String brightRed;
  final String brightGreen;
  final String brightYellow;
  final String brightBlue;
  final String brightMagenta;
  final String brightCyan;
  final String brightWhite;

  const TerminalPalette({
    required this.background,
    required this.foreground,
    required this.cursor,
    required this.cursorAccent,
    required this.selectionBackground,
    required this.black,
    required this.red,
    required this.green,
    required this.yellow,
    required this.blue,
    required this.magenta,
    required this.cyan,
    required this.white,
    required this.brightBlack,
    required this.brightRed,
    required this.brightGreen,
    required this.brightYellow,
    required this.brightBlue,
    required this.brightMagenta,
    required this.brightCyan,
    required this.brightWhite,
  });

  /// Default dark terminal palette (Tokyo Night-inspired).
  static const defaultDark = TerminalPalette(
    background: '#1a1b26',
    foreground: '#c0caf5',
    cursor: '#c0caf5',
    cursorAccent: '#1a1b26',
    selectionBackground: '#33467c',
    black: '#15161e',
    red: '#f7768e',
    green: '#9ece6a',
    yellow: '#e0af68',
    blue: '#7aa2f7',
    magenta: '#bb9af7',
    cyan: '#7dcfff',
    white: '#a9b1d6',
    brightBlack: '#414868',
    brightRed: '#f7768e',
    brightGreen: '#9ece6a',
    brightYellow: '#e0af68',
    brightBlue: '#7aa2f7',
    brightMagenta: '#bb9af7',
    brightCyan: '#7dcfff',
    brightWhite: '#c0caf5',
  );

  /// Create from a JSON map (e.g., from the API).
  factory TerminalPalette.fromJson(Map<String, dynamic> json) {
    return TerminalPalette(
      background: json['background'] as String? ?? '#1a1b26',
      foreground: json['foreground'] as String? ?? '#c0caf5',
      cursor: json['cursor'] as String? ?? '#c0caf5',
      cursorAccent: json['cursorAccent'] as String? ?? '#1a1b26',
      selectionBackground:
          json['selectionBackground'] as String? ?? '#33467c',
      black: json['black'] as String? ?? '#15161e',
      red: json['red'] as String? ?? '#f7768e',
      green: json['green'] as String? ?? '#9ece6a',
      yellow: json['yellow'] as String? ?? '#e0af68',
      blue: json['blue'] as String? ?? '#7aa2f7',
      magenta: json['magenta'] as String? ?? '#bb9af7',
      cyan: json['cyan'] as String? ?? '#7dcfff',
      white: json['white'] as String? ?? '#a9b1d6',
      brightBlack: json['brightBlack'] as String? ?? '#414868',
      brightRed: json['brightRed'] as String? ?? '#f7768e',
      brightGreen: json['brightGreen'] as String? ?? '#9ece6a',
      brightYellow: json['brightYellow'] as String? ?? '#e0af68',
      brightBlue: json['brightBlue'] as String? ?? '#7aa2f7',
      brightMagenta: json['brightMagenta'] as String? ?? '#bb9af7',
      brightCyan: json['brightCyan'] as String? ?? '#7dcfff',
      brightWhite: json['brightWhite'] as String? ?? '#c0caf5',
    );
  }

  /// Convert to xterm.dart TerminalTheme.
  xterm.TerminalTheme toXtermTheme() {
    final yellowColor = hexToColor(yellow);
    return xterm.TerminalTheme(
      cursor: hexToColor(cursor),
      selection: hexToColor(selectionBackground).withValues(alpha: 0.5),
      foreground: hexToColor(foreground),
      background: hexToColor(background),
      black: hexToColor(black),
      red: hexToColor(red),
      green: hexToColor(green),
      yellow: yellowColor,
      blue: hexToColor(blue),
      magenta: hexToColor(magenta),
      cyan: hexToColor(cyan),
      white: hexToColor(white),
      brightBlack: hexToColor(brightBlack),
      brightRed: hexToColor(brightRed),
      brightGreen: hexToColor(brightGreen),
      brightYellow: hexToColor(brightYellow),
      brightBlue: hexToColor(brightBlue),
      brightMagenta: hexToColor(brightMagenta),
      brightCyan: hexToColor(brightCyan),
      brightWhite: hexToColor(brightWhite),
      searchHitBackground: yellowColor.withValues(alpha: 0.3),
      searchHitBackgroundCurrent: yellowColor.withValues(alpha: 0.6),
      searchHitForeground: hexToColor(foreground),
    );
  }
}
