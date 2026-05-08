import 'package:flutter_test/flutter_test.dart';

import 'package:remote_dev/presentation/theme/app_theme.dart';

void main() {
  test('NerdFonts only resolves to bundled font families', () {
    final resolvedFamilies = NerdFonts.fontMap.values.toSet();
    final bundledFamilies = NerdFonts.bundledFonts.toSet();

    expect(resolvedFamilies.difference(bundledFamilies), isEmpty);
  });

  test('unsupported Nerd Font aliases fall back to the default bundled font', () {
    expect(NerdFonts.resolve('Hack Nerd Font Mono'), NerdFonts.defaultFont);
    expect(
      NerdFonts.resolve('CaskaydiaCove Nerd Font Mono'),
      NerdFonts.defaultFont,
    );
  });
}
