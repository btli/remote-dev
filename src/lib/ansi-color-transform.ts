/**
 * ANSI Color Transformation Utility
 *
 * This module transforms 24-bit true color ANSI escape sequences to be more
 * readable on different theme backgrounds. CLI tools like Claude Code use
 * hardcoded RGB values that may clash with light or dark themes.
 *
 * Problem:
 * - CLI tools output 24-bit true color: \x1b[38;2;R;G;Bm (foreground) and \x1b[48;2;R;G;Bm (background)
 * - xterm.js themes only control the 16-color ANSI palette (colors 0-15)
 * - 24-bit colors bypass the theme entirely, using inline RGB values
 *
 * Solution:
 * - Intercept terminal output before rendering
 * - Parse 24-bit color sequences
 * - Remap specific problematic color ranges to theme-appropriate alternatives
 *
 * Example transformations for light mode:
 * - White text (255,255,255) on colored bg → dark gray text (readable on light bg)
 * - Saturated red background → pastel red (readable with dark text)
 * - Saturated green background → pastel green (readable with dark text)
 */

export type ThemeMode = "light" | "dark";

interface ColorMapping {
  /** Source color range to match (min/max for each channel) */
  source: {
    r: [number, number];
    g: [number, number];
    b: [number, number];
  };
  /** Target color to replace with */
  target: { r: number; g: number; b: number };
}

/**
 * Color mappings for light mode themes
 * Note: Light/white foreground colors are handled by luminance-based logic in findReplacement()
 * These mappings are for specific colors that need custom transformations
 */
const LIGHT_MODE_FG_MAPPINGS: ColorMapping[] = [
  // Additional specific foreground color mappings can be added here
];

const LIGHT_MODE_BG_MAPPINGS: ColorMapping[] = [
  // Note: Generic dark backgrounds are handled by luminance-based logic in findReplacement()
  // These mappings handle specific saturated colors that need custom transformations
  //
  // Saturated red background (Claude Code diff deletions) → pastel red
  // Original: ~rgb(92,34,34) to rgb(140,60,60)
  {
    source: { r: [80, 180], g: [20, 80], b: [20, 80] },
    target: { r: 252, g: 228, b: 228 }, // #fce4e4 - light pink
  },
  // Saturated green background (Claude Code diff additions) → pastel green
  // Original: ~rgb(34,92,43) to rgb(60,140,70)
  {
    source: { r: [20, 80], g: [70, 160], b: [20, 90] },
    target: { r: 228, g: 245, b: 228 }, // #e4f5e4 - light mint
  },
  // Dark blue background → lighter blue
  {
    source: { r: [20, 60], g: [20, 60], b: [100, 180] },
    target: { r: 228, g: 232, b: 245 }, // #e4e8f5 - light blue
  },
  // Dark magenta/purple background → lighter lavender
  {
    source: { r: [80, 140], g: [20, 60], b: [80, 140] },
    target: { r: 243, g: 228, b: 245 }, // #f3e4f5 - light lavender
  },
  // Dark cyan/teal background → lighter aqua
  {
    source: { r: [20, 60], g: [80, 140], b: [80, 140] },
    target: { r: 228, g: 243, b: 245 }, // #e4f3f5 - light aqua
  },
  // Dark yellow/amber background → lighter cream
  {
    source: { r: [100, 180], g: [80, 140], b: [20, 60] },
    target: { r: 253, g: 245, b: 224 }, // #fdf5e0 - light cream
  },
];

/**
 * Color mappings for dark mode themes
 * These are more subtle - mainly adjusting overly bright backgrounds
 */
const DARK_MODE_FG_MAPPINGS: ColorMapping[] = [
  // Keep most foreground colors as-is for dark mode
];

const DARK_MODE_BG_MAPPINGS: ColorMapping[] = [
  // Overly bright backgrounds can be toned down, but generally dark mode works well
];

/**
 * Calculate perceived luminance of a color (0-255 scale)
 * Uses the standard formula for relative luminance
 */
function getLuminance(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/**
 * Check if a color falls within a mapping's source range
 */
function colorInRange(
  r: number,
  g: number,
  b: number,
  mapping: ColorMapping
): boolean {
  return (
    r >= mapping.source.r[0] &&
    r <= mapping.source.r[1] &&
    g >= mapping.source.g[0] &&
    g <= mapping.source.g[1] &&
    b >= mapping.source.b[0] &&
    b <= mapping.source.b[1]
  );
}

/**
 * Semantic ANSI color codes that follow the xterm.js theme
 * Using these instead of 24-bit RGB means colors auto-update on theme change
 */
const SEMANTIC_COLORS = {
  // Foreground colors (30-37, 90-97)
  FG_DEFAULT: "\x1b[39m",      // Default foreground (follows theme)
  FG_BLACK: "\x1b[30m",        // ANSI color 0
  FG_WHITE: "\x1b[37m",        // ANSI color 7
  FG_BRIGHT_WHITE: "\x1b[97m", // ANSI color 15
  FG_BRIGHT_BLACK: "\x1b[90m", // ANSI color 8 (gray)
  // Background colors (40-47, 100-107)
  BG_DEFAULT: "\x1b[49m",      // Default background (follows theme)
  BG_BLACK: "\x1b[40m",        // ANSI color 0
  BG_WHITE: "\x1b[47m",        // ANSI color 7
  BG_BRIGHT_WHITE: "\x1b[107m", // ANSI color 15
  BG_BRIGHT_BLACK: "\x1b[100m", // ANSI color 8 (gray)
} as const;

/**
 * Result type for color replacement - can be RGB or semantic ANSI code
 */
type ColorReplacement =
  | { type: "rgb"; r: number; g: number; b: number }
  | { type: "semantic"; code: string };

/**
 * Find a replacement color for the given RGB values
 * Returns semantic ANSI codes for theme-following colors, or RGB for specific mappings
 *
 * Theme-specific logic:
 * - Light mode: Replace light foreground colors with dark (FG_DEFAULT), keep dark unchanged
 * - Dark mode: Replace dark foreground colors with light (FG_DEFAULT), keep light unchanged
 */
function findReplacement(
  r: number,
  g: number,
  b: number,
  mappings: ColorMapping[],
  isForeground: boolean,
  themeMode: ThemeMode
): ColorReplacement | null {
  const luminance = getLuminance(r, g, b);

  // Use semantic colors for colors with poor contrast against the theme background
  // These automatically follow the xterm.js theme on theme changes
  if (isForeground) {
    if (themeMode === "light") {
      // Light mode: Light foreground on light background = poor contrast
      // Replace colors with luminance > 130 (catches cyan, yellow, bright colors)
      if (luminance > 130) {
        return { type: "semantic", code: SEMANTIC_COLORS.FG_DEFAULT };
      }
      // Dark foreground colors are fine in light mode - good contrast
    } else {
      // Dark mode: Dark foreground on dark background = poor contrast
      // Replace colors with luminance < 70 (catches dark blues, purples, etc.)
      if (luminance < 70) {
        return { type: "semantic", code: SEMANTIC_COLORS.FG_DEFAULT };
      }
      // Light foreground colors are fine in dark mode - good contrast
    }
  } else {
    // Background color handling
    if (themeMode === "light") {
      // Light mode: Dark backgrounds clash with light theme
      if (luminance < 80) {
        return { type: "semantic", code: SEMANTIC_COLORS.BG_DEFAULT };
      }
      // Very light background is fine in light mode
    } else {
      // Dark mode: Very light backgrounds clash with dark theme
      if (luminance > 200) {
        return { type: "semantic", code: SEMANTIC_COLORS.BG_DEFAULT };
      }
      // Dark background is fine in dark mode
    }
  }

  // Fall back to explicit color mappings for specific colors (e.g., diff colors)
  for (const mapping of mappings) {
    if (colorInRange(r, g, b, mapping)) {
      return { type: "rgb", ...mapping.target };
    }
  }
  return null;
}

/**
 * Regular expression to match 24-bit color ANSI sequences
 *
 * Matches:
 * - \x1b[38;2;R;G;Bm - Set foreground color to RGB
 * - \x1b[48;2;R;G;Bm - Set background color to RGB
 *
 * Also handles combined sequences like \x1b[38;2;R;G;B;48;2;R;G;Bm
 */
const ANSI_24BIT_REGEX =
  /\x1b\[(?:([34]8);2;(\d{1,3});(\d{1,3});(\d{1,3}))((?:;(?:[34]8);2;\d{1,3};\d{1,3};\d{1,3})*)m/g;

/**
 * Regular expression to match 256-color palette ANSI sequences
 *
 * Matches:
 * - \x1b[38;5;Nm - Set foreground to 256-color palette index N
 * - \x1b[48;5;Nm - Set background to 256-color palette index N
 */
const ANSI_256_REGEX = /\x1b\[([34]8);5;(\d{1,3})m/g;

/**
 * Convert 256-color palette index to RGB
 * - 0-15: Standard 16 colors (return null to skip - handled by theme)
 * - 16-231: 6x6x6 RGB cube
 * - 232-255: 24 grayscale shades
 */
function palette256ToRgb(index: number): { r: number; g: number; b: number } | null {
  if (index < 16) {
    // Standard 16 colors - handled by xterm theme, skip transformation
    return null;
  }

  if (index < 232) {
    // 6x6x6 color cube (indices 16-231)
    const cubeIndex = index - 16;
    const r = Math.floor(cubeIndex / 36);
    const g = Math.floor((cubeIndex % 36) / 6);
    const b = cubeIndex % 6;
    // Convert 0-5 to actual RGB values: 0, 95, 135, 175, 215, 255
    const toRgb = (v: number) => (v === 0 ? 0 : 55 + v * 40);
    return { r: toRgb(r), g: toRgb(g), b: toRgb(b) };
  }

  // Grayscale (indices 232-255)
  // Values: 8, 18, 28, ..., 238 (24 shades)
  const gray = 8 + (index - 232) * 10;
  return { r: gray, g: gray, b: gray };
}

/**
 * Transform ANSI color sequences based on theme
 * Handles both 24-bit true color and 256-color palette formats
 *
 * @param data - Raw terminal output containing ANSI sequences
 * @param themeMode - Current theme mode ("light" or "dark")
 * @returns Transformed terminal output with adjusted colors
 */
export function transformAnsiColors(data: string, themeMode: ThemeMode): string {
  const fgMappings =
    themeMode === "light" ? LIGHT_MODE_FG_MAPPINGS : DARK_MODE_FG_MAPPINGS;
  const bgMappings =
    themeMode === "light" ? LIGHT_MODE_BG_MAPPINGS : DARK_MODE_BG_MAPPINGS;

  // First, transform 256-color palette sequences
  let result = data.replace(ANSI_256_REGEX, (match, type, colorIndex) => {
    const index = parseInt(colorIndex, 10);
    const rgb = palette256ToRgb(index);

    // Skip standard 16 colors (handled by xterm theme)
    if (!rgb) {
      return match;
    }

    const isForeground = type === "38";
    const mappings = isForeground ? fgMappings : bgMappings;
    const replacement = findReplacement(rgb.r, rgb.g, rgb.b, mappings, isForeground, themeMode);

    if (replacement) {
      if (replacement.type === "semantic") {
        return replacement.code;
      } else {
        // Convert to 24-bit RGB sequence for better precision
        return `\x1b[${type};2;${replacement.r};${replacement.g};${replacement.b}m`;
      }
    }

    return match;
  });

  // Then, transform 24-bit color sequences
  result = result.replace(ANSI_24BIT_REGEX, (match, type, r, g, b, extra) => {
    const rNum = parseInt(r, 10);
    const gNum = parseInt(g, 10);
    const bNum = parseInt(b, 10);

    // Determine if this is foreground (38) or background (48)
    const isForeground = type === "38";
    const mappings = isForeground ? fgMappings : bgMappings;

    const replacement = findReplacement(rNum, gNum, bNum, mappings, isForeground, themeMode);

    if (replacement) {
      if (replacement.type === "semantic") {
        // Use semantic ANSI code that follows the xterm.js theme
        // If there's an extra color in the sequence, we need to handle it
        if (extra) {
          // Parse and transform extra colors too
          return replacement.code.slice(0, -1) + extra + "m";
        }
        return replacement.code;
      } else {
        // Rebuild the escape sequence with new RGB color
        const newSequence = `\x1b[${type};2;${replacement.r};${replacement.g};${replacement.b}${extra}m`;
        return newSequence;
      }
    }

    return match; // No replacement needed
  });

  return result;
}

/**
 * Create a color transformer function bound to a specific theme mode
 * This is useful for memoizing the transformation function
 */
export function createColorTransformer(
  themeMode: ThemeMode
): (data: string) => string {
  return (data: string) => transformAnsiColors(data, themeMode);
}
