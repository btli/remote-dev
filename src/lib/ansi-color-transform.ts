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
 * These transform saturated CLI colors to pastel/muted alternatives
 */
const LIGHT_MODE_FG_MAPPINGS: ColorMapping[] = [
  // White/near-white foreground → dark gray (readable on light backgrounds)
  {
    source: { r: [240, 255], g: [240, 255], b: [240, 255] },
    target: { r: 51, g: 51, b: 51 }, // #333333
  },
  // Bright/light foreground colors that are hard to see on light bg
  {
    source: { r: [200, 255], g: [200, 255], b: [200, 255] },
    target: { r: 68, g: 68, b: 68 }, // #444444
  },
];

const LIGHT_MODE_BG_MAPPINGS: ColorMapping[] = [
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
 * Find a replacement color for the given RGB values
 */
function findReplacement(
  r: number,
  g: number,
  b: number,
  mappings: ColorMapping[]
): { r: number; g: number; b: number } | null {
  for (const mapping of mappings) {
    if (colorInRange(r, g, b, mapping)) {
      return mapping.target;
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
 * Transform 24-bit true color ANSI sequences based on theme
 *
 * @param data - Raw terminal output containing ANSI sequences
 * @param themeMode - Current theme mode ("light" or "dark")
 * @returns Transformed terminal output with adjusted colors
 */
export function transformAnsiColors(data: string, themeMode: ThemeMode): string {
  // Skip transformation for dark mode if no mappings defined
  if (
    themeMode === "dark" &&
    DARK_MODE_FG_MAPPINGS.length === 0 &&
    DARK_MODE_BG_MAPPINGS.length === 0
  ) {
    return data;
  }

  const fgMappings =
    themeMode === "light" ? LIGHT_MODE_FG_MAPPINGS : DARK_MODE_FG_MAPPINGS;
  const bgMappings =
    themeMode === "light" ? LIGHT_MODE_BG_MAPPINGS : DARK_MODE_BG_MAPPINGS;

  // Transform each 24-bit color sequence
  return data.replace(ANSI_24BIT_REGEX, (match, type, r, g, b, extra) => {
    const rNum = parseInt(r, 10);
    const gNum = parseInt(g, 10);
    const bNum = parseInt(b, 10);

    // Determine if this is foreground (38) or background (48)
    const isForeground = type === "38";
    const mappings = isForeground ? fgMappings : bgMappings;

    const replacement = findReplacement(rNum, gNum, bNum, mappings);

    if (replacement) {
      // Rebuild the escape sequence with new color
      const newSequence = `\x1b[${type};2;${replacement.r};${replacement.g};${replacement.b}${extra}m`;
      return newSequence;
    }

    return match; // No replacement needed
  });
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
