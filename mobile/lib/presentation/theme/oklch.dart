import 'dart:math' as math;
import 'dart:ui' show Color;

/// OKLCH color representation matching the backend's OKLCHColor interface.
class OKLCHColor {
  final double l; // Lightness: 0-1
  final double c; // Chroma: 0-0.4
  final double h; // Hue: 0-360
  final double a; // Alpha: 0-1

  const OKLCHColor(this.l, this.c, this.h, [this.a = 1.0]);
}

/// Convert OKLCH to Flutter Color.
///
/// This is an exact port of `oklchToHex()` from
/// `src/lib/color-schemes.ts:45-88`. The math MUST match exactly because
/// the color values in the scheme definitions were tuned with this specific
/// conversion producing the correct output.
Color oklchToColor(OKLCHColor color) {
  final hRad = color.h * math.pi / 180;

  // OKLCH to OKLAB
  final a_ = color.c * math.cos(hRad);
  final b_ = color.c * math.sin(hRad);

  // OKLAB to linear sRGB (via LMS intermediate)
  final l_ = color.l + 0.3963377774 * a_ + 0.2158037573 * b_;
  final m_ = color.l - 0.1055613458 * a_ - 0.0638541728 * b_;
  final s_ = color.l - 0.0894841775 * a_ - 1.291485548 * b_;

  // LMS cone response (cube)
  final l = l_ * l_ * l_;
  final m = m_ * m_ * m_;
  final s = s_ * s_ * s_;

  // LMS to linear sRGB
  var r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  var g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  var b = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;

  // Clamp to [0, 1]
  r = r.clamp(0.0, 1.0);
  g = g.clamp(0.0, 1.0);
  b = b.clamp(0.0, 1.0);

  // Apply sRGB gamma correction
  r = _toSrgb(r);
  g = _toSrgb(g);
  b = _toSrgb(b);

  return Color.fromARGB(
    (color.a * 255).round(),
    (r * 255).round(),
    (g * 255).round(),
    (b * 255).round(),
  );
}

/// sRGB gamma correction — piecewise function matching the TS version.
double _toSrgb(double c) {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * math.pow(c, 1 / 2.4) - 0.055;
}

/// Parse a hex color string (#RRGGBB or #RRGGBBAA) to a Flutter Color.
Color hexToColor(String hex) {
  final cleaned = hex.replaceFirst('#', '');
  if (cleaned.length == 6) {
    return Color(int.parse('FF$cleaned', radix: 16));
  } else if (cleaned.length == 8) {
    // CSS format is RRGGBBAA, Flutter expects AARRGGBB
    final rgb = cleaned.substring(0, 6);
    final alpha = cleaned.substring(6, 8);
    return Color(int.parse('$alpha$rgb', radix: 16));
  }
  return const Color(0xFF000000);
}
