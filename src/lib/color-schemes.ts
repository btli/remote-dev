/**
 * Color Scheme Definitions
 *
 * 8 built-in color schemes with light and dark mode palettes.
 * Each scheme includes semantic UI colors and terminal ANSI colors.
 *
 * Schemes are categorized as:
 * - cool: Blues, greens, cyans (Ocean, Arctic, Forest)
 * - warm: Reds, oranges, yellows (Sunset, Rose, Amber)
 * - neutral: Grays, purples (Midnight, Mono)
 */

import type {
  ColorScheme,
  ColorSchemeId,
  OKLCHColor,
  ModePalette,
} from "@/types/appearance";

// =============================================================================
// OKLCH Color Utilities
// =============================================================================

/**
 * Create an OKLCH color object
 */
function oklch(l: number, c: number, h: number, a?: number): OKLCHColor {
  return a !== undefined ? { l, c, h, a } : { l, c, h };
}

/**
 * Convert OKLCH to CSS string
 */
export function oklchToCSS(color: OKLCHColor): string {
  if (color.a !== undefined && color.a < 1) {
    return `oklch(${color.l} ${color.c} ${color.h} / ${color.a})`;
  }
  return `oklch(${color.l} ${color.c} ${color.h})`;
}

/**
 * Convert OKLCH to hex (approximate - for terminal compatibility)
 * This is a simplified conversion for terminal colors
 */
export function oklchToHex(color: OKLCHColor): string {
  // Simplified OKLCH to sRGB conversion
  // For production, consider using a proper color library like culori
  const L = color.l;
  const C = color.c;
  const H = (color.h * Math.PI) / 180;

  // Approximate conversion (simplified)
  const a = C * Math.cos(H);
  const b = C * Math.sin(H);

  // OKLAB to linear sRGB (approximate)
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;

  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;

  let r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  let g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  let bl = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;

  // Clamp and convert to 8-bit
  r = Math.max(0, Math.min(1, r));
  g = Math.max(0, Math.min(1, g));
  bl = Math.max(0, Math.min(1, bl));

  // Apply sRGB gamma correction
  const toSRGB = (c: number) =>
    c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;

  r = toSRGB(r);
  g = toSRGB(g);
  bl = toSRGB(bl);

  const toHex = (c: number) =>
    Math.round(c * 255)
      .toString(16)
      .padStart(2, "0");

  return `#${toHex(r)}${toHex(g)}${toHex(bl)}`;
}

// =============================================================================
// Ocean Theme (Nord-inspired)
// Cool blues and teals - calm and professional
// =============================================================================

const oceanLight: ModePalette = {
  semantic: {
    background: oklch(0.98, 0.005, 220),
    foreground: oklch(0.25, 0.02, 240),
    card: oklch(0.96, 0.008, 220),
    cardForeground: oklch(0.25, 0.02, 240),
    popover: oklch(0.98, 0.005, 220),
    popoverForeground: oklch(0.25, 0.02, 240),
    primary: oklch(0.55, 0.15, 240),
    primaryForeground: oklch(0.98, 0.005, 220),
    secondary: oklch(0.92, 0.02, 220),
    secondaryForeground: oklch(0.25, 0.02, 240),
    muted: oklch(0.94, 0.01, 220),
    mutedForeground: oklch(0.45, 0.02, 240),
    accent: oklch(0.6, 0.12, 200),
    accentForeground: oklch(0.98, 0.005, 220),
    destructive: oklch(0.55, 0.2, 25),
    border: oklch(0.88, 0.015, 220),
    input: oklch(0.9, 0.012, 220),
    ring: oklch(0.55, 0.15, 240),
  },
  terminal: {
    background: "#eceff4",
    foreground: "#2e3440",
    cursor: "#5e81ac",
    cursorAccent: "#eceff4",
    selectionBackground: "#d8dee9",
    black: "#3b4252",
    red: "#a5545c",            // Muted dusty rose (was #bf616a)
    green: "#7a9a6d",          // Muted sage green (was #a3be8c)
    yellow: "#b8975a",         // Muted gold (was #ebcb8b)
    blue: "#5e81ac",
    magenta: "#9a7a9a",        // Muted mauve (was #b48ead)
    cyan: "#6a9aa8",           // Muted teal (was #88c0d0)
    white: "#4c566a",
    brightBlack: "#434c5e",
    brightRed: "#b5646c",      // Slightly brighter muted rose
    brightGreen: "#8aaa7d",    // Slightly brighter sage
    brightYellow: "#c8a76a",
    brightBlue: "#81a1c1",
    brightMagenta: "#aa8aaa",
    brightCyan: "#7aaab8",
    brightWhite: "#3b4252",
  },
};

const oceanDark: ModePalette = {
  semantic: {
    background: oklch(0.22, 0.02, 240),
    foreground: oklch(0.9, 0.01, 220),
    card: oklch(0.26, 0.02, 240),
    cardForeground: oklch(0.9, 0.01, 220),
    popover: oklch(0.26, 0.02, 240),
    popoverForeground: oklch(0.9, 0.01, 220),
    primary: oklch(0.7, 0.12, 240),
    primaryForeground: oklch(0.15, 0.02, 240),
    secondary: oklch(0.3, 0.02, 240),
    secondaryForeground: oklch(0.9, 0.01, 220),
    muted: oklch(0.28, 0.02, 240),
    mutedForeground: oklch(0.65, 0.02, 220),
    accent: oklch(0.65, 0.1, 200),
    accentForeground: oklch(0.15, 0.02, 240),
    destructive: oklch(0.6, 0.18, 25),
    border: oklch(1, 0, 0, 0.1),
    input: oklch(1, 0, 0, 0.15),
    ring: oklch(0.7, 0.12, 240),
  },
  terminal: {
    background: "#2e3440",
    foreground: "#d8dee9",
    cursor: "#d8dee9",
    cursorAccent: "#2e3440",
    selectionBackground: "#434c5e",
    black: "#3b4252",
    red: "#bf616a",
    green: "#a3be8c",
    yellow: "#ebcb8b",
    blue: "#81a1c1",
    magenta: "#b48ead",
    cyan: "#88c0d0",
    white: "#e5e9f0",
    brightBlack: "#4c566a",
    brightRed: "#bf616a",
    brightGreen: "#a3be8c",
    brightYellow: "#ebcb8b",
    brightBlue: "#81a1c1",
    brightMagenta: "#b48ead",
    brightCyan: "#8fbcbb",
    brightWhite: "#eceff4",
  },
};

// =============================================================================
// Forest Theme (Monokai-inspired)
// Greens and earthy tones - natural and focused
// =============================================================================

const forestLight: ModePalette = {
  semantic: {
    background: oklch(0.97, 0.01, 120),
    foreground: oklch(0.25, 0.03, 100),
    card: oklch(0.95, 0.015, 120),
    cardForeground: oklch(0.25, 0.03, 100),
    popover: oklch(0.97, 0.01, 120),
    popoverForeground: oklch(0.25, 0.03, 100),
    primary: oklch(0.55, 0.15, 140),
    primaryForeground: oklch(0.97, 0.01, 120),
    secondary: oklch(0.9, 0.03, 100),
    secondaryForeground: oklch(0.25, 0.03, 100),
    muted: oklch(0.92, 0.02, 100),
    mutedForeground: oklch(0.45, 0.03, 100),
    accent: oklch(0.7, 0.18, 110),
    accentForeground: oklch(0.2, 0.03, 100),
    destructive: oklch(0.55, 0.2, 25),
    border: oklch(0.85, 0.02, 100),
    input: oklch(0.88, 0.015, 100),
    ring: oklch(0.55, 0.15, 140),
  },
  terminal: {
    background: "#f5f5dc",
    foreground: "#272822",
    cursor: "#7a9a5a",
    cursorAccent: "#f5f5dc",
    selectionBackground: "#e0dcc8",
    black: "#272822",
    red: "#b8525a",            // Muted rose (was #f92672 neon pink)
    green: "#6a8a4a",          // Muted olive green (was #a6e22e neon)
    yellow: "#a8884a",         // Muted amber (was #f4bf75)
    blue: "#5a8aaa",           // Muted blue (was #66d9ef)
    magenta: "#8a6a9a",        // Muted purple (was #ae81ff)
    cyan: "#5a9a8a",           // Muted teal (was #a1efe4)
    white: "#49483e",
    brightBlack: "#75715e",
    brightRed: "#c8626a",
    brightGreen: "#7a9a5a",
    brightYellow: "#b8985a",
    brightBlue: "#6a9aba",
    brightMagenta: "#9a7aaa",
    brightCyan: "#6aaa9a",
    brightWhite: "#272822",
  },
};

const forestDark: ModePalette = {
  semantic: {
    background: oklch(0.18, 0.02, 100),
    foreground: oklch(0.92, 0.01, 100),
    card: oklch(0.22, 0.02, 100),
    cardForeground: oklch(0.92, 0.01, 100),
    popover: oklch(0.22, 0.02, 100),
    popoverForeground: oklch(0.92, 0.01, 100),
    primary: oklch(0.75, 0.2, 110),
    primaryForeground: oklch(0.15, 0.02, 100),
    secondary: oklch(0.28, 0.02, 100),
    secondaryForeground: oklch(0.92, 0.01, 100),
    muted: oklch(0.25, 0.02, 100),
    mutedForeground: oklch(0.6, 0.02, 100),
    accent: oklch(0.7, 0.18, 110),
    accentForeground: oklch(0.15, 0.02, 100),
    destructive: oklch(0.65, 0.22, 350),
    border: oklch(1, 0, 0, 0.1),
    input: oklch(1, 0, 0, 0.15),
    ring: oklch(0.75, 0.2, 110),
  },
  terminal: {
    background: "#272822",
    foreground: "#f8f8f2",
    cursor: "#f8f8f2",
    cursorAccent: "#272822",
    selectionBackground: "#49483e",
    black: "#272822",
    red: "#f92672",
    green: "#a6e22e",
    yellow: "#f4bf75",
    blue: "#66d9ef",
    magenta: "#ae81ff",
    cyan: "#a1efe4",
    white: "#f8f8f2",
    brightBlack: "#75715e",
    brightRed: "#f92672",
    brightGreen: "#a6e22e",
    brightYellow: "#f4bf75",
    brightBlue: "#66d9ef",
    brightMagenta: "#ae81ff",
    brightCyan: "#a1efe4",
    brightWhite: "#f9f8f5",
  },
};

// =============================================================================
// Sunset Theme (Dracula-inspired)
// Warm oranges and purples - creative and vibrant
// =============================================================================

const sunsetLight: ModePalette = {
  semantic: {
    background: oklch(0.97, 0.01, 320),
    foreground: oklch(0.25, 0.03, 280),
    card: oklch(0.95, 0.015, 320),
    cardForeground: oklch(0.25, 0.03, 280),
    popover: oklch(0.97, 0.01, 320),
    popoverForeground: oklch(0.25, 0.03, 280),
    primary: oklch(0.6, 0.2, 340),
    primaryForeground: oklch(0.97, 0.01, 320),
    secondary: oklch(0.9, 0.03, 300),
    secondaryForeground: oklch(0.25, 0.03, 280),
    muted: oklch(0.92, 0.02, 300),
    mutedForeground: oklch(0.45, 0.03, 280),
    accent: oklch(0.7, 0.15, 30),
    accentForeground: oklch(0.2, 0.03, 280),
    destructive: oklch(0.55, 0.22, 25),
    border: oklch(0.85, 0.02, 300),
    input: oklch(0.88, 0.015, 300),
    ring: oklch(0.6, 0.2, 340),
  },
  terminal: {
    background: "#fcf5f5",
    foreground: "#282a36",
    cursor: "#9a6a8a",
    cursorAccent: "#fcf5f5",
    selectionBackground: "#e8dfe0",
    black: "#21222c",
    red: "#b5525a",            // Muted rose (was #ff5555 neon red)
    green: "#5a9a6a",          // Muted green (was #50fa7b neon)
    yellow: "#a89a5a",         // Muted gold (was #f1fa8c neon)
    blue: "#7a6a9a",           // Muted purple-blue (was #bd93f9)
    magenta: "#9a5a7a",        // Muted magenta (was #ff79c6)
    cyan: "#5a8a9a",           // Muted cyan (was #8be9fd)
    white: "#44475a",
    brightBlack: "#6272a4",
    brightRed: "#c5626a",
    brightGreen: "#6aaa7a",
    brightYellow: "#b8aa6a",
    brightBlue: "#8a7aaa",
    brightMagenta: "#aa6a8a",
    brightCyan: "#6a9aaa",
    brightWhite: "#282a36",
  },
};

const sunsetDark: ModePalette = {
  semantic: {
    background: oklch(0.2, 0.025, 280),
    foreground: oklch(0.92, 0.01, 280),
    card: oklch(0.24, 0.025, 280),
    cardForeground: oklch(0.92, 0.01, 280),
    popover: oklch(0.24, 0.025, 280),
    popoverForeground: oklch(0.92, 0.01, 280),
    primary: oklch(0.7, 0.2, 340),
    primaryForeground: oklch(0.15, 0.02, 280),
    secondary: oklch(0.3, 0.025, 280),
    secondaryForeground: oklch(0.92, 0.01, 280),
    muted: oklch(0.28, 0.02, 280),
    mutedForeground: oklch(0.6, 0.02, 280),
    accent: oklch(0.75, 0.15, 30),
    accentForeground: oklch(0.15, 0.02, 280),
    destructive: oklch(0.65, 0.22, 25),
    border: oklch(1, 0, 0, 0.1),
    input: oklch(1, 0, 0, 0.15),
    ring: oklch(0.7, 0.2, 340),
  },
  terminal: {
    background: "#282a36",
    foreground: "#f8f8f2",
    cursor: "#f8f8f2",
    cursorAccent: "#282a36",
    selectionBackground: "#44475a",
    black: "#21222c",
    red: "#ff5555",
    green: "#50fa7b",
    yellow: "#f1fa8c",
    blue: "#bd93f9",
    magenta: "#ff79c6",
    cyan: "#8be9fd",
    white: "#f8f8f2",
    brightBlack: "#6272a4",
    brightRed: "#ff6e6e",
    brightGreen: "#69ff94",
    brightYellow: "#ffffa5",
    brightBlue: "#d6acff",
    brightMagenta: "#ff92df",
    brightCyan: "#a4ffff",
    brightWhite: "#ffffff",
  },
};

// =============================================================================
// Midnight Theme (Tokyo Night-inspired)
// Deep purples and blues - elegant and modern
// =============================================================================

const midnightLight: ModePalette = {
  semantic: {
    background: oklch(0.97, 0.008, 260),
    foreground: oklch(0.25, 0.025, 260),
    card: oklch(0.95, 0.012, 260),
    cardForeground: oklch(0.25, 0.025, 260),
    popover: oklch(0.97, 0.008, 260),
    popoverForeground: oklch(0.25, 0.025, 260),
    primary: oklch(0.55, 0.18, 270),
    primaryForeground: oklch(0.97, 0.008, 260),
    secondary: oklch(0.9, 0.02, 260),
    secondaryForeground: oklch(0.25, 0.025, 260),
    muted: oklch(0.92, 0.015, 260),
    mutedForeground: oklch(0.45, 0.025, 260),
    accent: oklch(0.65, 0.15, 250),
    accentForeground: oklch(0.97, 0.008, 260),
    destructive: oklch(0.6, 0.2, 15),
    border: oklch(0.85, 0.015, 260),
    input: oklch(0.88, 0.012, 260),
    ring: oklch(0.55, 0.18, 270),
  },
  terminal: {
    background: "#f0f0f5",
    foreground: "#1a1b26",
    cursor: "#6a8ac0",
    cursorAccent: "#f0f0f5",
    selectionBackground: "#d8d8e0",
    black: "#32344a",
    red: "#b5606a",            // Muted rose (was #f7768e)
    green: "#6a9a5a",          // Muted sage (was #9ece6a)
    yellow: "#a8885a",         // Muted amber (was #e0af68)
    blue: "#5a7aaa",           // Muted blue (was #7aa2f7)
    magenta: "#8a6a9a",        // Muted purple (was #ad8ee6)
    cyan: "#4a7a8a",           // Muted teal (was #449dab)
    white: "#565a6e",
    brightBlack: "#444b6a",
    brightRed: "#c5707a",
    brightGreen: "#7aaa6a",
    brightYellow: "#b8986a",
    brightBlue: "#6a8aba",
    brightMagenta: "#9a7aaa",
    brightCyan: "#5a8a9a",
    brightWhite: "#343b58",
  },
};

const midnightDark: ModePalette = {
  semantic: {
    background: oklch(0.17, 0.02, 260),
    foreground: oklch(0.85, 0.02, 250),
    card: oklch(0.21, 0.02, 260),
    cardForeground: oklch(0.85, 0.02, 250),
    popover: oklch(0.21, 0.02, 260),
    popoverForeground: oklch(0.85, 0.02, 250),
    primary: oklch(0.7, 0.15, 250),
    primaryForeground: oklch(0.15, 0.02, 260),
    secondary: oklch(0.28, 0.02, 260),
    secondaryForeground: oklch(0.85, 0.02, 250),
    muted: oklch(0.25, 0.02, 260),
    mutedForeground: oklch(0.6, 0.02, 250),
    accent: oklch(0.7, 0.12, 280),
    accentForeground: oklch(0.15, 0.02, 260),
    destructive: oklch(0.7, 0.18, 15),
    border: oklch(1, 0, 0, 0.1),
    input: oklch(1, 0, 0, 0.15),
    ring: oklch(0.7, 0.15, 250),
  },
  terminal: {
    background: "#1a1b26",
    foreground: "#a9b1d6",
    cursor: "#c0caf5",
    cursorAccent: "#1a1b26",
    selectionBackground: "#33467c",
    black: "#32344a",
    red: "#f7768e",
    green: "#9ece6a",
    yellow: "#e0af68",
    blue: "#7aa2f7",
    magenta: "#ad8ee6",
    cyan: "#449dab",
    white: "#787c99",
    brightBlack: "#444b6a",
    brightRed: "#ff7a93",
    brightGreen: "#b9f27c",
    brightYellow: "#ff9e64",
    brightBlue: "#7da6ff",
    brightMagenta: "#bb9af7",
    brightCyan: "#0db9d7",
    brightWhite: "#acb0d0",
  },
};

// =============================================================================
// Arctic Theme
// Cool grays with icy blue accents - clean and minimal
// =============================================================================

const arcticLight: ModePalette = {
  semantic: {
    background: oklch(0.98, 0.003, 220),
    foreground: oklch(0.3, 0.015, 220),
    card: oklch(0.96, 0.005, 220),
    cardForeground: oklch(0.3, 0.015, 220),
    popover: oklch(0.98, 0.003, 220),
    popoverForeground: oklch(0.3, 0.015, 220),
    primary: oklch(0.6, 0.12, 220),
    primaryForeground: oklch(0.98, 0.003, 220),
    secondary: oklch(0.93, 0.008, 220),
    secondaryForeground: oklch(0.3, 0.015, 220),
    muted: oklch(0.95, 0.005, 220),
    mutedForeground: oklch(0.5, 0.01, 220),
    accent: oklch(0.65, 0.1, 200),
    accentForeground: oklch(0.98, 0.003, 220),
    destructive: oklch(0.55, 0.18, 20),
    border: oklch(0.9, 0.008, 220),
    input: oklch(0.92, 0.006, 220),
    ring: oklch(0.6, 0.12, 220),
  },
  terminal: {
    background: "#f8fafc",
    foreground: "#334155",
    cursor: "#5a8aaa",
    cursorAccent: "#f8fafc",
    selectionBackground: "#e2e8f0",
    black: "#1e293b",
    red: "#b54a4a",            // Muted red (was #ef4444)
    green: "#4a8a5a",          // Muted green (was #22c55e)
    yellow: "#a89040",         // Muted gold (was #eab308)
    blue: "#4a6aaa",           // Muted blue (was #3b82f6)
    magenta: "#7a5a9a",        // Muted purple (was #a855f7)
    cyan: "#4a8a9a",           // Muted cyan (was #06b6d4)
    white: "#475569",
    brightBlack: "#64748b",
    brightRed: "#c55a5a",
    brightGreen: "#5a9a6a",
    brightYellow: "#b8a050",
    brightBlue: "#5a7aba",
    brightMagenta: "#8a6aaa",
    brightCyan: "#5a9aaa",
    brightWhite: "#334155",
  },
};

const arcticDark: ModePalette = {
  semantic: {
    background: oklch(0.16, 0.01, 220),
    foreground: oklch(0.92, 0.005, 220),
    card: oklch(0.2, 0.012, 220),
    cardForeground: oklch(0.92, 0.005, 220),
    popover: oklch(0.2, 0.012, 220),
    popoverForeground: oklch(0.92, 0.005, 220),
    primary: oklch(0.7, 0.12, 200),
    primaryForeground: oklch(0.15, 0.01, 220),
    secondary: oklch(0.25, 0.012, 220),
    secondaryForeground: oklch(0.92, 0.005, 220),
    muted: oklch(0.22, 0.01, 220),
    mutedForeground: oklch(0.6, 0.008, 220),
    accent: oklch(0.65, 0.1, 200),
    accentForeground: oklch(0.15, 0.01, 220),
    destructive: oklch(0.6, 0.18, 20),
    border: oklch(1, 0, 0, 0.08),
    input: oklch(1, 0, 0, 0.12),
    ring: oklch(0.7, 0.12, 200),
  },
  terminal: {
    background: "#0f172a",
    foreground: "#e2e8f0",
    cursor: "#38bdf8",
    cursorAccent: "#0f172a",
    selectionBackground: "#334155",
    black: "#1e293b",
    red: "#f87171",
    green: "#4ade80",
    yellow: "#facc15",
    blue: "#60a5fa",
    magenta: "#c084fc",
    cyan: "#22d3ee",
    white: "#f1f5f9",
    brightBlack: "#475569",
    brightRed: "#fca5a5",
    brightGreen: "#86efac",
    brightYellow: "#fde047",
    brightBlue: "#93c5fd",
    brightMagenta: "#d8b4fe",
    brightCyan: "#67e8f9",
    brightWhite: "#ffffff",
  },
};

// =============================================================================
// Rose Theme
// Pinks and magentas - expressive and bold
// =============================================================================

const roseLight: ModePalette = {
  semantic: {
    background: oklch(0.98, 0.008, 350),
    foreground: oklch(0.25, 0.025, 340),
    card: oklch(0.96, 0.012, 350),
    cardForeground: oklch(0.25, 0.025, 340),
    popover: oklch(0.98, 0.008, 350),
    popoverForeground: oklch(0.25, 0.025, 340),
    primary: oklch(0.6, 0.2, 350),
    primaryForeground: oklch(0.98, 0.008, 350),
    secondary: oklch(0.92, 0.02, 350),
    secondaryForeground: oklch(0.25, 0.025, 340),
    muted: oklch(0.94, 0.015, 350),
    mutedForeground: oklch(0.45, 0.02, 340),
    accent: oklch(0.65, 0.18, 330),
    accentForeground: oklch(0.98, 0.008, 350),
    destructive: oklch(0.55, 0.2, 20),
    border: oklch(0.88, 0.015, 350),
    input: oklch(0.9, 0.012, 350),
    ring: oklch(0.6, 0.2, 350),
  },
  terminal: {
    background: "#fdf2f8",
    foreground: "#831843",
    cursor: "#9a4a6a",
    cursorAccent: "#fdf2f8",
    selectionBackground: "#fce7f3",
    black: "#500724",
    red: "#a53a4a",            // Muted rose (was #e11d48)
    green: "#4a7a5a",          // Muted green (was #16a34a)
    yellow: "#9a7040",         // Muted gold (was #ca8a04)
    blue: "#4a5a8a",           // Muted blue (was #2563eb)
    magenta: "#9a4a6a",        // Muted magenta (was #db2777)
    cyan: "#4a7a8a",           // Muted cyan (was #0891b2)
    white: "#9f1239",
    brightBlack: "#be185d",
    brightRed: "#b54a5a",
    brightGreen: "#5a8a6a",
    brightYellow: "#aa8050",
    brightBlue: "#5a6a9a",
    brightMagenta: "#aa5a7a",
    brightCyan: "#5a8a9a",
    brightWhite: "#831843",
  },
};

const roseDark: ModePalette = {
  semantic: {
    background: oklch(0.16, 0.02, 340),
    foreground: oklch(0.92, 0.01, 350),
    card: oklch(0.2, 0.022, 340),
    cardForeground: oklch(0.92, 0.01, 350),
    popover: oklch(0.2, 0.022, 340),
    popoverForeground: oklch(0.92, 0.01, 350),
    primary: oklch(0.7, 0.2, 350),
    primaryForeground: oklch(0.15, 0.02, 340),
    secondary: oklch(0.28, 0.022, 340),
    secondaryForeground: oklch(0.92, 0.01, 350),
    muted: oklch(0.25, 0.02, 340),
    mutedForeground: oklch(0.6, 0.015, 350),
    accent: oklch(0.65, 0.18, 330),
    accentForeground: oklch(0.15, 0.02, 340),
    destructive: oklch(0.6, 0.2, 20),
    border: oklch(1, 0, 0, 0.1),
    input: oklch(1, 0, 0, 0.15),
    ring: oklch(0.7, 0.2, 350),
  },
  terminal: {
    background: "#1c0a14",
    foreground: "#fce7f3",
    cursor: "#f472b6",
    cursorAccent: "#1c0a14",
    selectionBackground: "#4c0519",
    black: "#500724",
    red: "#fb7185",
    green: "#4ade80",
    yellow: "#facc15",
    blue: "#60a5fa",
    magenta: "#f472b6",
    cyan: "#22d3ee",
    white: "#fce7f3",
    brightBlack: "#9f1239",
    brightRed: "#fda4af",
    brightGreen: "#86efac",
    brightYellow: "#fde047",
    brightBlue: "#93c5fd",
    brightMagenta: "#f9a8d4",
    brightCyan: "#67e8f9",
    brightWhite: "#ffffff",
  },
};

// =============================================================================
// Amber Theme
// Warm yellows and oranges - energetic and warm
// =============================================================================

const amberLight: ModePalette = {
  semantic: {
    background: oklch(0.98, 0.01, 80),
    foreground: oklch(0.25, 0.03, 60),
    card: oklch(0.96, 0.015, 80),
    cardForeground: oklch(0.25, 0.03, 60),
    popover: oklch(0.98, 0.01, 80),
    popoverForeground: oklch(0.25, 0.03, 60),
    primary: oklch(0.7, 0.18, 70),
    primaryForeground: oklch(0.2, 0.03, 60),
    secondary: oklch(0.92, 0.025, 80),
    secondaryForeground: oklch(0.25, 0.03, 60),
    muted: oklch(0.94, 0.02, 80),
    mutedForeground: oklch(0.45, 0.025, 60),
    accent: oklch(0.75, 0.15, 50),
    accentForeground: oklch(0.2, 0.03, 60),
    destructive: oklch(0.55, 0.2, 25),
    border: oklch(0.88, 0.02, 80),
    input: oklch(0.9, 0.015, 80),
    ring: oklch(0.7, 0.18, 70),
  },
  terminal: {
    background: "#fffbeb",
    foreground: "#78350f",
    cursor: "#9a7a40",
    cursorAccent: "#fffbeb",
    selectionBackground: "#fef3c7",
    black: "#451a03",
    red: "#a54a4a",            // Muted red (was #dc2626)
    green: "#4a7a5a",          // Muted green (was #16a34a)
    yellow: "#9a7a30",         // Muted gold (was #f59e0b)
    blue: "#4a5a8a",           // Muted blue (was #2563eb)
    magenta: "#8a4a9a",        // Muted purple (was #c026d3)
    cyan: "#4a7a8a",           // Muted cyan (was #0891b2)
    white: "#92400e",
    brightBlack: "#b45309",
    brightRed: "#b55a5a",
    brightGreen: "#5a8a6a",
    brightYellow: "#aa8a40",
    brightBlue: "#5a6a9a",
    brightMagenta: "#9a5aaa",
    brightCyan: "#5a8a9a",
    brightWhite: "#78350f",
  },
};

const amberDark: ModePalette = {
  semantic: {
    background: oklch(0.16, 0.02, 60),
    foreground: oklch(0.92, 0.015, 80),
    card: oklch(0.2, 0.022, 60),
    cardForeground: oklch(0.92, 0.015, 80),
    popover: oklch(0.2, 0.022, 60),
    popoverForeground: oklch(0.92, 0.015, 80),
    primary: oklch(0.75, 0.18, 70),
    primaryForeground: oklch(0.15, 0.02, 60),
    secondary: oklch(0.28, 0.022, 60),
    secondaryForeground: oklch(0.92, 0.015, 80),
    muted: oklch(0.25, 0.02, 60),
    mutedForeground: oklch(0.6, 0.015, 80),
    accent: oklch(0.75, 0.15, 50),
    accentForeground: oklch(0.15, 0.02, 60),
    destructive: oklch(0.6, 0.2, 25),
    border: oklch(1, 0, 0, 0.1),
    input: oklch(1, 0, 0, 0.15),
    ring: oklch(0.75, 0.18, 70),
  },
  terminal: {
    background: "#1c1208",
    foreground: "#fef3c7",
    cursor: "#fbbf24",
    cursorAccent: "#1c1208",
    selectionBackground: "#451a03",
    black: "#451a03",
    red: "#f87171",
    green: "#4ade80",
    yellow: "#fbbf24",
    blue: "#60a5fa",
    magenta: "#e879f9",
    cyan: "#22d3ee",
    white: "#fef3c7",
    brightBlack: "#92400e",
    brightRed: "#fca5a5",
    brightGreen: "#86efac",
    brightYellow: "#fcd34d",
    brightBlue: "#93c5fd",
    brightMagenta: "#f0abfc",
    brightCyan: "#67e8f9",
    brightWhite: "#ffffff",
  },
};

// =============================================================================
// Mono Theme
// Grayscale minimal - distraction-free
// =============================================================================

const monoLight: ModePalette = {
  semantic: {
    background: oklch(0.98, 0, 0),
    foreground: oklch(0.2, 0, 0),
    card: oklch(0.96, 0, 0),
    cardForeground: oklch(0.2, 0, 0),
    popover: oklch(0.98, 0, 0),
    popoverForeground: oklch(0.2, 0, 0),
    primary: oklch(0.3, 0, 0),
    primaryForeground: oklch(0.98, 0, 0),
    secondary: oklch(0.92, 0, 0),
    secondaryForeground: oklch(0.2, 0, 0),
    muted: oklch(0.94, 0, 0),
    mutedForeground: oklch(0.45, 0, 0),
    accent: oklch(0.5, 0, 0),
    accentForeground: oklch(0.98, 0, 0),
    destructive: oklch(0.5, 0.15, 25),
    border: oklch(0.88, 0, 0),
    input: oklch(0.9, 0, 0),
    ring: oklch(0.3, 0, 0),
  },
  terminal: {
    background: "#fafafa",
    foreground: "#171717",
    cursor: "#404040",
    cursorAccent: "#fafafa",
    selectionBackground: "#e5e5e5",
    black: "#171717",
    red: "#6a4040",            // Muted dark red (was #7f1d1d)
    green: "#3a5a40",          // Muted dark green (was #14532d)
    yellow: "#5a4a30",         // Muted dark gold (was #713f12)
    blue: "#3a4a6a",           // Muted dark blue (was #1e3a8a)
    magenta: "#5a3a5a",        // Muted dark magenta (was #701a75)
    cyan: "#3a5a5a",           // Muted dark cyan (was #164e63)
    white: "#525252",
    brightBlack: "#737373",
    brightRed: "#7a5050",
    brightGreen: "#4a6a50",
    brightYellow: "#6a5a40",
    brightBlue: "#4a5a7a",
    brightMagenta: "#6a4a6a",
    brightCyan: "#4a6a6a",
    brightWhite: "#262626",
  },
};

const monoDark: ModePalette = {
  semantic: {
    background: oklch(0.14, 0, 0),
    foreground: oklch(0.92, 0, 0),
    card: oklch(0.18, 0, 0),
    cardForeground: oklch(0.92, 0, 0),
    popover: oklch(0.18, 0, 0),
    popoverForeground: oklch(0.92, 0, 0),
    primary: oklch(0.85, 0, 0),
    primaryForeground: oklch(0.14, 0, 0),
    secondary: oklch(0.25, 0, 0),
    secondaryForeground: oklch(0.92, 0, 0),
    muted: oklch(0.22, 0, 0),
    mutedForeground: oklch(0.6, 0, 0),
    accent: oklch(0.6, 0, 0),
    accentForeground: oklch(0.14, 0, 0),
    destructive: oklch(0.6, 0.15, 25),
    border: oklch(1, 0, 0, 0.1),
    input: oklch(1, 0, 0, 0.15),
    ring: oklch(0.85, 0, 0),
  },
  terminal: {
    background: "#0a0a0a",
    foreground: "#e5e5e5",
    cursor: "#a3a3a3",
    cursorAccent: "#0a0a0a",
    selectionBackground: "#262626",
    black: "#171717",
    red: "#f87171",
    green: "#4ade80",
    yellow: "#fbbf24",
    blue: "#60a5fa",
    magenta: "#e879f9",
    cyan: "#22d3ee",
    white: "#f5f5f5",
    brightBlack: "#525252",
    brightRed: "#fca5a5",
    brightGreen: "#86efac",
    brightYellow: "#fcd34d",
    brightBlue: "#93c5fd",
    brightMagenta: "#f0abfc",
    brightCyan: "#67e8f9",
    brightWhite: "#ffffff",
  },
};

// =============================================================================
// Color Scheme Registry
// =============================================================================

export const COLOR_SCHEMES: ColorScheme[] = [
  {
    id: "ocean",
    name: "Ocean",
    description: "Cool blues and teals - calm and professional",
    category: "cool",
    light: oceanLight,
    dark: oceanDark,
    isBuiltIn: true,
    sortOrder: 0,
  },
  {
    id: "arctic",
    name: "Arctic",
    description: "Cool grays with icy blue accents - clean and minimal",
    category: "cool",
    light: arcticLight,
    dark: arcticDark,
    isBuiltIn: true,
    sortOrder: 1,
  },
  {
    id: "forest",
    name: "Forest",
    description: "Greens and earthy tones - natural and focused",
    category: "cool",
    light: forestLight,
    dark: forestDark,
    isBuiltIn: true,
    sortOrder: 2,
  },
  {
    id: "midnight",
    name: "Midnight",
    description: "Deep purples and blues - elegant and modern",
    category: "neutral",
    light: midnightLight,
    dark: midnightDark,
    isBuiltIn: true,
    sortOrder: 3,
  },
  {
    id: "mono",
    name: "Mono",
    description: "Grayscale minimal - distraction-free",
    category: "neutral",
    light: monoLight,
    dark: monoDark,
    isBuiltIn: true,
    sortOrder: 4,
  },
  {
    id: "sunset",
    name: "Sunset",
    description: "Warm oranges and purples - creative and vibrant",
    category: "warm",
    light: sunsetLight,
    dark: sunsetDark,
    isBuiltIn: true,
    sortOrder: 5,
  },
  {
    id: "rose",
    name: "Rose",
    description: "Pinks and magentas - expressive and bold",
    category: "warm",
    light: roseLight,
    dark: roseDark,
    isBuiltIn: true,
    sortOrder: 6,
  },
  {
    id: "amber",
    name: "Amber",
    description: "Warm yellows and oranges - energetic and warm",
    category: "warm",
    light: amberLight,
    dark: amberDark,
    isBuiltIn: true,
    sortOrder: 7,
  },
];

/**
 * Get a color scheme by ID
 */
export function getColorScheme(id: ColorSchemeId): ColorScheme {
  const scheme = COLOR_SCHEMES.find((s) => s.id === id);
  if (!scheme) {
    // Fallback to midnight
    return COLOR_SCHEMES.find((s) => s.id === "midnight")!;
  }
  return scheme;
}

/**
 * Get color schemes by category
 */
export function getSchemesByCategory(category: "cool" | "warm" | "neutral"): ColorScheme[] {
  return COLOR_SCHEMES.filter((s) => s.category === category);
}

/**
 * Map of color scheme IDs to schemes for quick lookup
 */
export const COLOR_SCHEME_MAP: Record<ColorSchemeId, ColorScheme> = Object.fromEntries(
  COLOR_SCHEMES.map((s) => [s.id, s])
) as Record<ColorSchemeId, ColorScheme>;
