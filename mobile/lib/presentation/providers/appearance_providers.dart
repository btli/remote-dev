import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:remote_dev/presentation/theme/terminal_theme.dart';

/// Terminal color palette, defaults to Tokyo Night dark.
final terminalPaletteProvider = StateProvider<TerminalPalette>((ref) {
  return TerminalPalette.defaultDark;
});
