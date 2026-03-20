import 'package:flutter/material.dart';

import 'package:remote_dev/presentation/theme/oklch.dart';
import 'package:remote_dev/presentation/theme/terminal_theme.dart';

/// Nerd Font family name constants matching pubspec.yaml declarations.
/// The key matches the server's fontFamily preference value.
class NerdFonts {
  static const defaultFont = 'JetBrainsMono Nerd Font';

  static const Map<String, String> fontMap = {
    'JetBrains Mono': 'JetBrainsMono Nerd Font',
    'JetBrainsMono Nerd Font Mono': 'JetBrainsMono Nerd Font',
    'Fira Code': 'FiraCode Nerd Font',
    'FiraCode Nerd Font Mono': 'FiraCode Nerd Font',
    'Hack': 'Hack Nerd Font',
    'Hack Nerd Font Mono': 'Hack Nerd Font',
    'Cascadia Code': 'CaskaydiaCove Nerd Font',
    'CaskaydiaCove Nerd Font Mono': 'CaskaydiaCove Nerd Font',
    'MesloLGS NF': 'MesloLGS Nerd Font',
    'MesloLGS Nerd Font Mono': 'MesloLGS Nerd Font',
    'Source Code Pro': 'SourceCodePro Nerd Font',
    'SauceCodePro Nerd Font Mono': 'SourceCodePro Nerd Font',
    'Ubuntu Mono': 'UbuntuMono Nerd Font',
    'UbuntuMono Nerd Font Mono': 'UbuntuMono Nerd Font',
    'Roboto Mono': 'RobotoMono Nerd Font',
    'RobotoMono Nerd Font Mono': 'RobotoMono Nerd Font',
    'Inconsolata': 'Inconsolata Nerd Font',
    'Inconsolata Nerd Font Mono': 'Inconsolata Nerd Font',
    'DejaVu Sans Mono': 'DejaVuSansMono Nerd Font',
    'DejaVuSansM Nerd Font Mono': 'DejaVuSansMono Nerd Font',
    'Droid Sans Mono': 'DroidSansMono Nerd Font',
    'DroidSansM Nerd Font Mono': 'DroidSansMono Nerd Font',
    'Noto Sans Mono': 'Noto Nerd Font',
    'NotoSansM Nerd Font Mono': 'Noto Nerd Font',
    'Space Mono': 'SpaceMono Nerd Font',
    'SpaceMono Nerd Font Mono': 'SpaceMono Nerd Font',
    'IBM Plex Mono': 'IBMPlexMono Nerd Font',
    'BlexMono Nerd Font Mono': 'IBMPlexMono Nerd Font',
    'Victor Mono': 'VictorMono Nerd Font',
    'VictorMono Nerd Font Mono': 'VictorMono Nerd Font',
    'Iosevka': 'Iosevka Nerd Font',
    'Iosevka Nerd Font Mono': 'Iosevka Nerd Font',
    'Anonymous Pro': 'AnonymousPro Nerd Font',
    'AnonymicePro Nerd Font Mono': 'AnonymousPro Nerd Font',
    'Fira Mono': 'FiraMono Nerd Font',
    'FiraMono Nerd Font Mono': 'FiraMono Nerd Font',
    'Geist Mono': 'GeistMono Nerd Font',
    'GeistMono Nerd Font Mono': 'GeistMono Nerd Font',
    'Commit Mono': 'CommitMono Nerd Font',
    'CommitMono Nerd Font Mono': 'CommitMono Nerd Font',
    'Monaspace Neon': 'Monaspace Nerd Font',
    'MonaspaceNeon Nerd Font Mono': 'Monaspace Nerd Font',
    '0xProto': '0xProto Nerd Font',
    '0xProto Nerd Font Mono': '0xProto Nerd Font',
  };

  /// Resolve a server font name to the Flutter font family name.
  static String resolve(String? serverFontName) {
    if (serverFontName == null) return defaultFont;
    return fontMap[serverFontName] ?? defaultFont;
  }
}

/// Build a Material 3 ThemeData from a terminal palette.
class AppTheme {
  /// Build theme from terminal palette (the palette already has resolved hex colors).
  static ThemeData fromPalette(TerminalPalette palette, {bool isDark = true}) {
    final bg = hexToColor(palette.background);
    final fg = hexToColor(palette.foreground);
    final primary = hexToColor(palette.blue);
    final error = hexToColor(palette.red);
    final surface = hexToColor(palette.background);

    final colorScheme = isDark
        ? ColorScheme.dark(
            primary: primary,
            onPrimary: bg,
            secondary: hexToColor(palette.cyan),
            onSecondary: bg,
            error: error,
            onError: bg,
            surface: surface,
            onSurface: fg,
          )
        : ColorScheme.light(
            primary: primary,
            onPrimary: fg,
            secondary: hexToColor(palette.cyan),
            onSecondary: fg,
            error: error,
            onError: fg,
            surface: surface,
            onSurface: bg,
          );

    return ThemeData(
      useMaterial3: true,
      colorScheme: colorScheme,
      brightness: isDark ? Brightness.dark : Brightness.light,
      scaffoldBackgroundColor: bg,
      appBarTheme: AppBarTheme(
        backgroundColor: bg,
        foregroundColor: fg,
        elevation: 0,
      ),
      drawerTheme: DrawerThemeData(
        backgroundColor: bg,
      ),
      cardTheme: CardThemeData(
        color: bg.withValues(alpha: 0.8),
        elevation: 0,
      ),
      dividerTheme: DividerThemeData(
        color: fg.withValues(alpha: 0.1),
      ),
      bottomSheetTheme: BottomSheetThemeData(
        backgroundColor: bg,
      ),
      fontFamily: NerdFonts.defaultFont,
    );
  }
}
