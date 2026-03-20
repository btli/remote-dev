import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:remote_dev/presentation/theme/app_theme.dart';
import 'package:remote_dev/presentation/theme/terminal_theme.dart';

/// Terminal color palette, defaults to Tokyo Night dark.
final terminalPaletteProvider = StateProvider<TerminalPalette>((ref) {
  return TerminalPalette.defaultDark;
});

/// Terminal font family.
final terminalFontProvider = StateProvider<String>((ref) {
  return NerdFonts.defaultFont;
});

/// Terminal font size.
final terminalFontSizeProvider = StateProvider<double>((ref) {
  return 14.0;
});
