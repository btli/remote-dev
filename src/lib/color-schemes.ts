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
    // Light mode uses Nord dark palette for better terminal readability
    // Official Nord colors: https://www.nordtheme.com/
    background: "#2e3440",     // Nord0 - Polar Night
    foreground: "#d8dee9",     // Nord4 - Snow Storm
    cursor: "#d8dee9",
    cursorAccent: "#2e3440",
    selectionBackground: "#434c5e", // Nord2
    black: "#3b4252",          // Nord1
    red: "#bf616a",            // Nord11 - Aurora Red
    green: "#a3be8c",          // Nord14 - Aurora Green
    yellow: "#ebcb8b",         // Nord13 - Aurora Yellow
    blue: "#81a1c1",           // Nord9 - Frost
    magenta: "#b48ead",        // Nord15 - Aurora Purple
    cyan: "#88c0d0",           // Nord8 - Frost
    white: "#e5e9f0",          // Nord5 - Snow Storm
    brightBlack: "#4c566a",    // Nord3
    brightRed: "#bf616a",      // Nord11
    brightGreen: "#a3be8c",    // Nord14
    brightYellow: "#ebcb8b",   // Nord13
    brightBlue: "#81a1c1",     // Nord9
    brightMagenta: "#b48ead",  // Nord15
    brightCyan: "#8fbcbb",     // Nord7 - Frost
    brightWhite: "#eceff4",    // Nord6 - Snow Storm
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
    // Light mode uses Monokai dark palette for better terminal readability
    // Official Monokai colors: https://monokai.pro/
    background: "#272822",     // Monokai background
    foreground: "#f8f8f2",     // Monokai foreground
    cursor: "#f8f8f2",
    cursorAccent: "#272822",
    selectionBackground: "#49483e",
    black: "#272822",
    red: "#f92672",            // Monokai pink/red
    green: "#a6e22e",          // Monokai green
    yellow: "#f4bf75",         // Monokai yellow
    blue: "#66d9ef",           // Monokai blue/cyan
    magenta: "#ae81ff",        // Monokai purple
    cyan: "#a1efe4",           // Monokai cyan
    white: "#f8f8f2",
    brightBlack: "#75715e",    // Monokai comment
    brightRed: "#f92672",
    brightGreen: "#a6e22e",
    brightYellow: "#f4bf75",
    brightBlue: "#66d9ef",
    brightMagenta: "#ae81ff",
    brightCyan: "#a1efe4",
    brightWhite: "#f9f8f5",
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
    // Light mode uses Dracula dark palette for better terminal readability
    // Official Dracula colors: https://draculatheme.com/
    background: "#282a36",     // Dracula background
    foreground: "#f8f8f2",     // Dracula foreground
    cursor: "#f8f8f2",
    cursorAccent: "#282a36",
    selectionBackground: "#44475a", // Dracula selection
    black: "#21222c",
    red: "#ff5555",            // Dracula red
    green: "#50fa7b",          // Dracula green
    yellow: "#f1fa8c",         // Dracula yellow
    blue: "#bd93f9",           // Dracula purple (used as blue)
    magenta: "#ff79c6",        // Dracula pink
    cyan: "#8be9fd",           // Dracula cyan
    white: "#f8f8f2",
    brightBlack: "#6272a4",    // Dracula comment
    brightRed: "#ff6e6e",
    brightGreen: "#69ff94",
    brightYellow: "#ffffa5",
    brightBlue: "#d6acff",
    brightMagenta: "#ff92df",
    brightCyan: "#a4ffff",
    brightWhite: "#ffffff",
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
    // Light mode uses Tokyo Night dark palette for better terminal readability
    // Official Tokyo Night colors: https://github.com/enkia/tokyo-night-vscode-theme
    background: "#1a1b26",     // Tokyo Night background
    foreground: "#a9b1d6",     // Tokyo Night foreground
    cursor: "#c0caf5",
    cursorAccent: "#1a1b26",
    selectionBackground: "#33467c",
    black: "#32344a",
    red: "#f7768e",            // Tokyo Night red
    green: "#9ece6a",          // Tokyo Night green
    yellow: "#e0af68",         // Tokyo Night yellow
    blue: "#7aa2f7",           // Tokyo Night blue
    magenta: "#ad8ee6",        // Tokyo Night magenta
    cyan: "#449dab",           // Tokyo Night cyan
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
    // Light mode uses Arctic dark palette for better terminal readability
    // Based on Tailwind Slate colors: https://tailwindcss.com/docs/customizing-colors
    background: "#0f172a",     // slate-900
    foreground: "#e2e8f0",     // slate-200
    cursor: "#38bdf8",         // sky-400
    cursorAccent: "#0f172a",
    selectionBackground: "#334155", // slate-700
    black: "#1e293b",          // slate-800
    red: "#f87171",            // red-400
    green: "#4ade80",          // green-400
    yellow: "#facc15",         // yellow-400
    blue: "#60a5fa",           // blue-400
    magenta: "#c084fc",        // purple-400
    cyan: "#22d3ee",           // cyan-400
    white: "#f1f5f9",          // slate-100
    brightBlack: "#475569",    // slate-600
    brightRed: "#fca5a5",      // red-300
    brightGreen: "#86efac",    // green-300
    brightYellow: "#fde047",   // yellow-300
    brightBlue: "#93c5fd",     // blue-300
    brightMagenta: "#d8b4fe",  // purple-300
    brightCyan: "#67e8f9",     // cyan-300
    brightWhite: "#ffffff",
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
    // Light mode uses Rose dark palette for better terminal readability
    // Based on Tailwind Rose/Pink colors: https://tailwindcss.com/docs/customizing-colors
    background: "#1c0a14",     // Deep rose-tinted black
    foreground: "#fce7f3",     // pink-100
    cursor: "#f472b6",         // pink-400
    cursorAccent: "#1c0a14",
    selectionBackground: "#4c0519", // rose-950
    black: "#500724",          // rose-900
    red: "#fb7185",            // rose-400
    green: "#4ade80",          // green-400
    yellow: "#facc15",         // yellow-400
    blue: "#60a5fa",           // blue-400
    magenta: "#f472b6",        // pink-400
    cyan: "#22d3ee",           // cyan-400
    white: "#fce7f3",          // pink-100
    brightBlack: "#9f1239",    // rose-800
    brightRed: "#fda4af",      // rose-300
    brightGreen: "#86efac",    // green-300
    brightYellow: "#fde047",   // yellow-300
    brightBlue: "#93c5fd",     // blue-300
    brightMagenta: "#f9a8d4",  // pink-300
    brightCyan: "#67e8f9",     // cyan-300
    brightWhite: "#ffffff",
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
    // Light mode uses Amber dark palette for better terminal readability
    // Based on Tailwind Amber/Yellow colors: https://tailwindcss.com/docs/customizing-colors
    background: "#1c1208",     // Deep amber-tinted black
    foreground: "#fef3c7",     // amber-100
    cursor: "#fbbf24",         // amber-400
    cursorAccent: "#1c1208",
    selectionBackground: "#451a03", // amber-950
    black: "#451a03",          // orange-950
    red: "#f87171",            // red-400
    green: "#4ade80",          // green-400
    yellow: "#fbbf24",         // amber-400
    blue: "#60a5fa",           // blue-400
    magenta: "#e879f9",        // fuchsia-400
    cyan: "#22d3ee",           // cyan-400
    white: "#fef3c7",          // amber-100
    brightBlack: "#92400e",    // amber-800
    brightRed: "#fca5a5",      // red-300
    brightGreen: "#86efac",    // green-300
    brightYellow: "#fcd34d",   // amber-300
    brightBlue: "#93c5fd",     // blue-300
    brightMagenta: "#f0abfc",  // fuchsia-300
    brightCyan: "#67e8f9",     // cyan-300
    brightWhite: "#ffffff",
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
    // Light mode uses Mono dark palette for better terminal readability
    // Based on Tailwind Neutral colors: https://tailwindcss.com/docs/customizing-colors
    background: "#0a0a0a",     // neutral-950
    foreground: "#e5e5e5",     // neutral-200
    cursor: "#a3a3a3",         // neutral-400
    cursorAccent: "#0a0a0a",
    selectionBackground: "#262626", // neutral-800
    black: "#171717",          // neutral-900
    red: "#f87171",            // red-400
    green: "#4ade80",          // green-400
    yellow: "#fbbf24",         // amber-400
    blue: "#60a5fa",           // blue-400
    magenta: "#e879f9",        // fuchsia-400
    cyan: "#22d3ee",           // cyan-400
    white: "#f5f5f5",          // neutral-100
    brightBlack: "#525252",    // neutral-600
    brightRed: "#fca5a5",      // red-300
    brightGreen: "#86efac",    // green-300
    brightYellow: "#fcd34d",   // amber-300
    brightBlue: "#93c5fd",     // blue-300
    brightMagenta: "#f0abfc",  // fuchsia-300
    brightCyan: "#67e8f9",     // cyan-300
    brightWhite: "#ffffff",
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
// Catppuccin Theme (Mocha variant)
// Soothing pastel colors - comfortable for long coding sessions
// https://github.com/catppuccin/catppuccin
// =============================================================================

const catppuccinLight: ModePalette = {
  semantic: {
    background: oklch(0.97, 0.01, 260),
    foreground: oklch(0.28, 0.03, 260),
    card: oklch(0.95, 0.015, 260),
    cardForeground: oklch(0.28, 0.03, 260),
    popover: oklch(0.97, 0.01, 260),
    popoverForeground: oklch(0.28, 0.03, 260),
    primary: oklch(0.6, 0.18, 260),
    primaryForeground: oklch(0.97, 0.01, 260),
    secondary: oklch(0.9, 0.02, 260),
    secondaryForeground: oklch(0.28, 0.03, 260),
    muted: oklch(0.92, 0.015, 260),
    mutedForeground: oklch(0.45, 0.025, 260),
    accent: oklch(0.7, 0.15, 180),
    accentForeground: oklch(0.97, 0.01, 260),
    destructive: oklch(0.6, 0.2, 15),
    border: oklch(0.86, 0.015, 260),
    input: oklch(0.88, 0.012, 260),
    ring: oklch(0.6, 0.18, 260),
  },
  terminal: {
    // Light mode uses dark terminal palette for readability
    background: "#1e1e2e",
    foreground: "#cdd6f4",
    cursor: "#f5e0dc",
    cursorAccent: "#1e1e2e",
    selectionBackground: "#45475a",
    black: "#45475a",
    red: "#f38ba8",
    green: "#a6e3a1",
    yellow: "#f9e2af",
    blue: "#89b4fa",
    magenta: "#f5c2e7",
    cyan: "#94e2d5",
    white: "#bac2de",
    brightBlack: "#585b70",
    brightRed: "#f38ba8",
    brightGreen: "#a6e3a1",
    brightYellow: "#f9e2af",
    brightBlue: "#89b4fa",
    brightMagenta: "#f5c2e7",
    brightCyan: "#94e2d5",
    brightWhite: "#a6adc8",
  },
};

const catppuccinDark: ModePalette = {
  semantic: {
    background: oklch(0.18, 0.02, 260),
    foreground: oklch(0.85, 0.02, 260),
    card: oklch(0.22, 0.02, 260),
    cardForeground: oklch(0.85, 0.02, 260),
    popover: oklch(0.22, 0.02, 260),
    popoverForeground: oklch(0.85, 0.02, 260),
    primary: oklch(0.7, 0.15, 260),
    primaryForeground: oklch(0.15, 0.02, 260),
    secondary: oklch(0.28, 0.02, 260),
    secondaryForeground: oklch(0.85, 0.02, 260),
    muted: oklch(0.25, 0.02, 260),
    mutedForeground: oklch(0.6, 0.02, 260),
    accent: oklch(0.7, 0.12, 180),
    accentForeground: oklch(0.15, 0.02, 260),
    destructive: oklch(0.65, 0.2, 15),
    border: oklch(1, 0, 0, 0.1),
    input: oklch(1, 0, 0, 0.15),
    ring: oklch(0.7, 0.15, 260),
  },
  terminal: {
    // Catppuccin Mocha terminal colors
    background: "#1e1e2e",
    foreground: "#cdd6f4",
    cursor: "#f5e0dc",
    cursorAccent: "#1e1e2e",
    selectionBackground: "#45475a",
    black: "#45475a",
    red: "#f38ba8",
    green: "#a6e3a1",
    yellow: "#f9e2af",
    blue: "#89b4fa",
    magenta: "#f5c2e7",
    cyan: "#94e2d5",
    white: "#bac2de",
    brightBlack: "#585b70",
    brightRed: "#f38ba8",
    brightGreen: "#a6e3a1",
    brightYellow: "#f9e2af",
    brightBlue: "#89b4fa",
    brightMagenta: "#f5c2e7",
    brightCyan: "#94e2d5",
    brightWhite: "#a6adc8",
  },
};

// =============================================================================
// Solarized Theme (Dark variant)
// Precision colors designed for optimal readability
// https://ethanschoonover.com/solarized/
// =============================================================================

const solarizedLight: ModePalette = {
  semantic: {
    background: oklch(0.97, 0.01, 80),
    foreground: oklch(0.35, 0.04, 200),
    card: oklch(0.95, 0.015, 80),
    cardForeground: oklch(0.35, 0.04, 200),
    popover: oklch(0.97, 0.01, 80),
    popoverForeground: oklch(0.35, 0.04, 200),
    primary: oklch(0.55, 0.15, 210),
    primaryForeground: oklch(0.97, 0.01, 80),
    secondary: oklch(0.9, 0.02, 80),
    secondaryForeground: oklch(0.35, 0.04, 200),
    muted: oklch(0.92, 0.015, 80),
    mutedForeground: oklch(0.5, 0.03, 200),
    accent: oklch(0.6, 0.12, 200),
    accentForeground: oklch(0.97, 0.01, 80),
    destructive: oklch(0.55, 0.2, 25),
    border: oklch(0.86, 0.015, 80),
    input: oklch(0.88, 0.012, 80),
    ring: oklch(0.55, 0.15, 210),
  },
  terminal: {
    // Light mode uses dark terminal palette for readability
    background: "#002b36",
    foreground: "#839496",
    cursor: "#93a1a1",
    cursorAccent: "#002b36",
    selectionBackground: "#073642",
    black: "#073642",
    red: "#dc322f",
    green: "#859900",
    yellow: "#b58900",
    blue: "#268bd2",
    magenta: "#d33682",
    cyan: "#2aa198",
    white: "#eee8d5",
    brightBlack: "#002b36",
    brightRed: "#cb4b16",
    brightGreen: "#586e75",
    brightYellow: "#657b83",
    brightBlue: "#839496",
    brightMagenta: "#6c71c4",
    brightCyan: "#93a1a1",
    brightWhite: "#fdf6e3",
  },
};

const solarizedDark: ModePalette = {
  semantic: {
    background: oklch(0.2, 0.03, 200),
    foreground: oklch(0.65, 0.02, 200),
    card: oklch(0.24, 0.03, 200),
    cardForeground: oklch(0.65, 0.02, 200),
    popover: oklch(0.24, 0.03, 200),
    popoverForeground: oklch(0.65, 0.02, 200),
    primary: oklch(0.6, 0.12, 210),
    primaryForeground: oklch(0.15, 0.02, 200),
    secondary: oklch(0.28, 0.025, 200),
    secondaryForeground: oklch(0.65, 0.02, 200),
    muted: oklch(0.26, 0.025, 200),
    mutedForeground: oklch(0.55, 0.02, 200),
    accent: oklch(0.6, 0.12, 200),
    accentForeground: oklch(0.15, 0.02, 200),
    destructive: oklch(0.55, 0.2, 25),
    border: oklch(1, 0, 0, 0.1),
    input: oklch(1, 0, 0, 0.15),
    ring: oklch(0.6, 0.12, 210),
  },
  terminal: {
    // Solarized Dark terminal colors
    background: "#002b36",
    foreground: "#839496",
    cursor: "#93a1a1",
    cursorAccent: "#002b36",
    selectionBackground: "#073642",
    black: "#073642",
    red: "#dc322f",
    green: "#859900",
    yellow: "#b58900",
    blue: "#268bd2",
    magenta: "#d33682",
    cyan: "#2aa198",
    white: "#eee8d5",
    brightBlack: "#002b36",
    brightRed: "#cb4b16",
    brightGreen: "#586e75",
    brightYellow: "#657b83",
    brightBlue: "#839496",
    brightMagenta: "#6c71c4",
    brightCyan: "#93a1a1",
    brightWhite: "#fdf6e3",
  },
};

// =============================================================================
// One Dark Theme (Atom-inspired)
// Popular dark theme with vibrant syntax colors
// https://github.com/atom/one-dark-syntax
// =============================================================================

const oneDarkLight: ModePalette = {
  semantic: {
    background: oklch(0.98, 0.005, 240),
    foreground: oklch(0.28, 0.02, 240),
    card: oklch(0.96, 0.008, 240),
    cardForeground: oklch(0.28, 0.02, 240),
    popover: oklch(0.98, 0.005, 240),
    popoverForeground: oklch(0.28, 0.02, 240),
    primary: oklch(0.6, 0.15, 220),
    primaryForeground: oklch(0.98, 0.005, 240),
    secondary: oklch(0.92, 0.01, 240),
    secondaryForeground: oklch(0.28, 0.02, 240),
    muted: oklch(0.94, 0.008, 240),
    mutedForeground: oklch(0.45, 0.02, 240),
    accent: oklch(0.65, 0.12, 260),
    accentForeground: oklch(0.98, 0.005, 240),
    destructive: oklch(0.55, 0.2, 25),
    border: oklch(0.88, 0.01, 240),
    input: oklch(0.9, 0.008, 240),
    ring: oklch(0.6, 0.15, 220),
  },
  terminal: {
    // Light mode uses dark terminal palette for readability
    background: "#282c34",
    foreground: "#abb2bf",
    cursor: "#528bff",
    cursorAccent: "#282c34",
    selectionBackground: "#3e4451",
    black: "#5c6370",
    red: "#e06c75",
    green: "#98c379",
    yellow: "#e5c07b",
    blue: "#61afef",
    magenta: "#c678dd",
    cyan: "#56b6c2",
    white: "#abb2bf",
    brightBlack: "#4b5263",
    brightRed: "#be5046",
    brightGreen: "#98c379",
    brightYellow: "#d19a66",
    brightBlue: "#61afef",
    brightMagenta: "#c678dd",
    brightCyan: "#56b6c2",
    brightWhite: "#ffffff",
  },
};

const oneDarkDark: ModePalette = {
  semantic: {
    background: oklch(0.2, 0.015, 240),
    foreground: oklch(0.78, 0.02, 240),
    card: oklch(0.24, 0.015, 240),
    cardForeground: oklch(0.78, 0.02, 240),
    popover: oklch(0.24, 0.015, 240),
    popoverForeground: oklch(0.78, 0.02, 240),
    primary: oklch(0.65, 0.15, 220),
    primaryForeground: oklch(0.15, 0.015, 240),
    secondary: oklch(0.28, 0.015, 240),
    secondaryForeground: oklch(0.78, 0.02, 240),
    muted: oklch(0.26, 0.012, 240),
    mutedForeground: oklch(0.55, 0.015, 240),
    accent: oklch(0.65, 0.12, 260),
    accentForeground: oklch(0.15, 0.015, 240),
    destructive: oklch(0.6, 0.2, 15),
    border: oklch(1, 0, 0, 0.1),
    input: oklch(1, 0, 0, 0.15),
    ring: oklch(0.65, 0.15, 220),
  },
  terminal: {
    // One Dark terminal colors
    background: "#282c34",
    foreground: "#abb2bf",
    cursor: "#528bff",
    cursorAccent: "#282c34",
    selectionBackground: "#3e4451",
    black: "#5c6370",
    red: "#e06c75",
    green: "#98c379",
    yellow: "#e5c07b",
    blue: "#61afef",
    magenta: "#c678dd",
    cyan: "#56b6c2",
    white: "#abb2bf",
    brightBlack: "#4b5263",
    brightRed: "#be5046",
    brightGreen: "#98c379",
    brightYellow: "#d19a66",
    brightBlue: "#61afef",
    brightMagenta: "#c678dd",
    brightCyan: "#56b6c2",
    brightWhite: "#ffffff",
  },
};

// =============================================================================
// Gruvbox Theme (Retro groove)
// Warm, retro colors designed for comfortable coding
// https://github.com/morhetz/gruvbox
// =============================================================================

const gruvboxLight: ModePalette = {
  semantic: {
    background: oklch(0.96, 0.02, 80),
    foreground: oklch(0.28, 0.04, 60),
    card: oklch(0.94, 0.025, 80),
    cardForeground: oklch(0.28, 0.04, 60),
    popover: oklch(0.96, 0.02, 80),
    popoverForeground: oklch(0.28, 0.04, 60),
    primary: oklch(0.55, 0.15, 40),
    primaryForeground: oklch(0.96, 0.02, 80),
    secondary: oklch(0.9, 0.03, 80),
    secondaryForeground: oklch(0.28, 0.04, 60),
    muted: oklch(0.92, 0.025, 80),
    mutedForeground: oklch(0.45, 0.03, 60),
    accent: oklch(0.6, 0.15, 100),
    accentForeground: oklch(0.96, 0.02, 80),
    destructive: oklch(0.55, 0.2, 25),
    border: oklch(0.85, 0.025, 80),
    input: oklch(0.88, 0.02, 80),
    ring: oklch(0.55, 0.15, 40),
  },
  terminal: {
    // Light mode uses dark terminal palette for readability
    background: "#282828",
    foreground: "#ebdbb2",
    cursor: "#ebdbb2",
    cursorAccent: "#282828",
    selectionBackground: "#504945",
    black: "#282828",
    red: "#cc241d",
    green: "#98971a",
    yellow: "#d79921",
    blue: "#458588",
    magenta: "#b16286",
    cyan: "#689d6a",
    white: "#a89984",
    brightBlack: "#928374",
    brightRed: "#fb4934",
    brightGreen: "#b8bb26",
    brightYellow: "#fabd2f",
    brightBlue: "#83a598",
    brightMagenta: "#d3869b",
    brightCyan: "#8ec07c",
    brightWhite: "#ebdbb2",
  },
};

const gruvboxDark: ModePalette = {
  semantic: {
    background: oklch(0.2, 0.03, 60),
    foreground: oklch(0.88, 0.04, 80),
    card: oklch(0.24, 0.03, 60),
    cardForeground: oklch(0.88, 0.04, 80),
    popover: oklch(0.24, 0.03, 60),
    popoverForeground: oklch(0.88, 0.04, 80),
    primary: oklch(0.75, 0.15, 80),
    primaryForeground: oklch(0.15, 0.02, 60),
    secondary: oklch(0.3, 0.03, 60),
    secondaryForeground: oklch(0.88, 0.04, 80),
    muted: oklch(0.28, 0.025, 60),
    mutedForeground: oklch(0.6, 0.03, 80),
    accent: oklch(0.65, 0.15, 100),
    accentForeground: oklch(0.15, 0.02, 60),
    destructive: oklch(0.6, 0.2, 25),
    border: oklch(1, 0, 0, 0.1),
    input: oklch(1, 0, 0, 0.15),
    ring: oklch(0.75, 0.15, 80),
  },
  terminal: {
    // Gruvbox Dark terminal colors
    background: "#282828",
    foreground: "#ebdbb2",
    cursor: "#ebdbb2",
    cursorAccent: "#282828",
    selectionBackground: "#504945",
    black: "#282828",
    red: "#cc241d",
    green: "#98971a",
    yellow: "#d79921",
    blue: "#458588",
    magenta: "#b16286",
    cyan: "#689d6a",
    white: "#a89984",
    brightBlack: "#928374",
    brightRed: "#fb4934",
    brightGreen: "#b8bb26",
    brightYellow: "#fabd2f",
    brightBlue: "#83a598",
    brightMagenta: "#d3869b",
    brightCyan: "#8ec07c",
    brightWhite: "#ebdbb2",
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
  {
    id: "catppuccin",
    name: "Catppuccin",
    description: "Soothing pastel colors - comfortable for long sessions",
    category: "neutral",
    light: catppuccinLight,
    dark: catppuccinDark,
    isBuiltIn: true,
    sortOrder: 8,
  },
  {
    id: "solarized",
    name: "Solarized",
    description: "Precision colors for optimal readability",
    category: "neutral",
    light: solarizedLight,
    dark: solarizedDark,
    isBuiltIn: true,
    sortOrder: 9,
  },
  {
    id: "oneDark",
    name: "One Dark",
    description: "Atom-inspired theme with vibrant syntax colors",
    category: "cool",
    light: oneDarkLight,
    dark: oneDarkDark,
    isBuiltIn: true,
    sortOrder: 10,
  },
  {
    id: "gruvbox",
    name: "Gruvbox",
    description: "Retro warm colors for comfortable coding",
    category: "warm",
    light: gruvboxLight,
    dark: gruvboxDark,
    isBuiltIn: true,
    sortOrder: 11,
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
