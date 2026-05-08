import 'package:flutter/material.dart';

import 'package:remote_dev/presentation/theme/oklch.dart';
import 'package:remote_dev/presentation/theme/terminal_theme.dart';

/// Nerd Font family name constants matching pubspec.yaml declarations.
/// The key matches the server's fontFamily preference value.
class NerdFonts {
  static const defaultFont = 'JetBrainsMono Nerd Font';
  static const bundledFonts = [
    'JetBrainsMono Nerd Font',
    'FiraCode Nerd Font',
    'MesloLGS Nerd Font',
  ];

  static const Map<String, String> fontMap = {
    'JetBrains Mono': 'JetBrainsMono Nerd Font',
    'JetBrainsMono Nerd Font Mono': 'JetBrainsMono Nerd Font',
    'Fira Code': 'FiraCode Nerd Font',
    'FiraCode Nerd Font Mono': 'FiraCode Nerd Font',
    'MesloLGS NF': 'MesloLGS Nerd Font',
    'MesloLGS Nerd Font Mono': 'MesloLGS Nerd Font',
  };

  /// Resolve a server font name to the Flutter font family name.
  static String resolve(String? serverFontName) {
    if (serverFontName == null) return defaultFont;
    return fontMap[serverFontName] ?? defaultFont;
  }
}

/// Build a Material 3 ThemeData from a terminal palette.
class AppTheme {
  static Color _mixColors(Color base, Color blend, double amount) {
    return Color.lerp(base, blend, amount)!;
  }

  static ThemeData fromPalette(TerminalPalette palette, {bool isDark = true}) {
    final bg = hexToColor(palette.background);
    final fg = hexToColor(palette.foreground);
    final primary = hexToColor(palette.blue);
    final error = hexToColor(palette.red);

    final surfaceContainerLow = _mixColors(bg, fg, 0.04);
    final surfaceContainer = _mixColors(bg, fg, 0.07);
    final surfaceContainerHigh = _mixColors(bg, fg, 0.11);

    final colorScheme = isDark
        ? ColorScheme.dark(
            primary: primary,
            onPrimary: bg,
            secondary: hexToColor(palette.cyan),
            onSecondary: bg,
            error: error,
            onError: bg,
            surface: bg,
            onSurface: fg,
            surfaceContainerLowest: bg,
            surfaceContainerLow: surfaceContainerLow,
            surfaceContainer: surfaceContainer,
            surfaceContainerHigh: surfaceContainerHigh,
            surfaceContainerHighest: _mixColors(bg, fg, 0.14),
            outline: fg.withValues(alpha: 0.2),
            outlineVariant: fg.withValues(alpha: 0.1),
          )
        : ColorScheme.light(
            primary: primary,
            onPrimary: fg,
            secondary: hexToColor(palette.cyan),
            onSecondary: fg,
            error: error,
            onError: fg,
            surface: bg,
            onSurface: fg,
          );

    return ThemeData(
      useMaterial3: true,
      colorScheme: colorScheme,
      brightness: isDark ? Brightness.dark : Brightness.light,
      scaffoldBackgroundColor: bg,
      appBarTheme: AppBarTheme(
        backgroundColor: Colors.transparent,
        foregroundColor: fg,
        elevation: 0,
        scrolledUnderElevation: 0,
      ),
      drawerTheme: const DrawerThemeData(
        // Transparent — GlassmorphicContainer handles the frosted glass
        backgroundColor: Colors.transparent,
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.horizontal(right: Radius.circular(20)),
        ),
      ),
      cardTheme: CardThemeData(
        color: surfaceContainerLow,
        elevation: 0,
        clipBehavior: Clip.antiAlias,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(12),
        ),
      ),
      dividerTheme: DividerThemeData(
        color: fg.withValues(alpha: 0.1),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: surfaceContainer,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: BorderSide.none,
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: BorderSide.none,
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: BorderSide(color: primary),
        ),
        errorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: BorderSide(color: error),
        ),
        focusedErrorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: BorderSide(color: error, width: 2),
        ),
        contentPadding: const EdgeInsets.symmetric(
          horizontal: 16,
          vertical: 14,
        ),
      ),
      listTileTheme: ListTileThemeData(
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(12),
        ),
        contentPadding: const EdgeInsets.symmetric(horizontal: 16),
        iconColor: fg.withValues(alpha: 0.6),
      ),
      segmentedButtonTheme: SegmentedButtonThemeData(
        style: ButtonStyle(
          shape: WidgetStatePropertyAll(
            RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(12),
            ),
          ),
          side: WidgetStatePropertyAll(
            BorderSide(color: fg.withValues(alpha: 0.15)),
          ),
        ),
      ),
      popupMenuTheme: PopupMenuThemeData(
        color: surfaceContainer,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(12),
        ),
        elevation: 4,
      ),
      navigationDrawerTheme: NavigationDrawerThemeData(
        // Transparent — GlassmorphicContainer.drawer handles surface
        backgroundColor: Colors.transparent,
        elevation: 0,
        indicatorColor: primary.withValues(alpha: 0.12),
        indicatorShape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(12),
        ),
      ),
      bottomSheetTheme: BottomSheetThemeData(
        // Semi-transparent for frosted glass bottom sheets
        backgroundColor: surfaceContainerLow.withValues(alpha: 0.80),
        showDragHandle: true,
        dragHandleColor: fg.withValues(alpha: 0.2),
        shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
        ),
        elevation: 0,
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12),
          ),
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 14),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12),
          ),
          side: BorderSide(color: fg.withValues(alpha: 0.15)),
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 14),
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12),
          ),
        ),
      ),
      dialogTheme: DialogThemeData(
        // Semi-transparent for frosted glass dialogs
        backgroundColor: surfaceContainerHigh.withValues(alpha: 0.85),
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(20),
        ),
      ),
      sliderTheme: SliderThemeData(
        showValueIndicator: ShowValueIndicator.onlyForContinuous,
        trackHeight: 4,
        thumbShape: const RoundSliderThumbShape(enabledThumbRadius: 8),
        overlayShape: const RoundSliderOverlayShape(overlayRadius: 20),
        activeTrackColor: primary,
        inactiveTrackColor: fg.withValues(alpha: 0.1),
        thumbColor: primary,
        valueIndicatorColor: primary,
        valueIndicatorTextStyle: TextStyle(
          color: bg,
          fontWeight: FontWeight.w600,
        ),
      ),
      fontFamily: NerdFonts.defaultFont,
    );
  }
}
