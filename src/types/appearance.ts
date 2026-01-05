/**
 * Appearance Type Definitions
 *
 * Site-wide theming system with:
 * - Light/Dark mode with system preference detection
 * - Color schemes that apply to both site UI and terminal
 * - Separate scheme selection for light and dark modes
 */

/**
 * Appearance mode selection
 * - light: Always use light mode
 * - dark: Always use dark mode
 * - system: Follow OS preference
 */
export type AppearanceMode = "light" | "dark" | "system";

/**
 * Resolved mode (never "system" - resolved to actual light/dark)
 */
export type ResolvedMode = "light" | "dark";

/**
 * Built-in color scheme identifiers
 */
export type ColorSchemeId =
  | "ocean" // Cool blues and teals
  | "forest" // Greens and earthy tones
  | "sunset" // Warm oranges and purples
  | "midnight" // Deep purples and blues (Tokyo Night-inspired)
  | "arctic" // Cool grays and blues (Nord-inspired)
  | "rose" // Pinks and magentas
  | "amber" // Warm yellows and oranges
  | "mono" // Grayscale minimal
  | "catppuccin" // Catppuccin Mocha - pastel colors
  | "solarized" // Solarized Dark - precise lab colors
  | "oneDark" // One Dark - Atom-inspired
  | "gruvbox"; // Gruvbox - retro warm

/**
 * Color scheme category for grouping in UI
 */
export type ColorSchemeCategory = "cool" | "warm" | "neutral";

/**
 * OKLCH color definition
 * Using OKLCH for perceptually uniform colors
 */
export interface OKLCHColor {
  /** Lightness: 0-1 */
  l: number;
  /** Chroma: 0-0.4 (saturation) */
  c: number;
  /** Hue: 0-360 (color wheel angle) */
  h: number;
  /** Alpha: 0-1 (optional, defaults to 1) */
  a?: number;
}

/**
 * Semantic color palette for site UI
 * Maps to CSS variables in globals.css
 */
export interface SemanticPalette {
  // Backgrounds
  background: OKLCHColor;
  foreground: OKLCHColor;
  card: OKLCHColor;
  cardForeground: OKLCHColor;
  popover: OKLCHColor;
  popoverForeground: OKLCHColor;

  // Interactive elements
  primary: OKLCHColor;
  primaryForeground: OKLCHColor;
  secondary: OKLCHColor;
  secondaryForeground: OKLCHColor;
  muted: OKLCHColor;
  mutedForeground: OKLCHColor;
  accent: OKLCHColor;
  accentForeground: OKLCHColor;

  // Status
  destructive: OKLCHColor;

  // Borders and inputs
  border: OKLCHColor;
  input: OKLCHColor;
  ring: OKLCHColor;
}

/**
 * Terminal color palette (ANSI colors)
 * Used by xterm.js ITheme interface
 */
export interface TerminalPalette {
  background: string;
  foreground: string;
  cursor: string;
  cursorAccent: string;
  selectionBackground: string;

  // Standard ANSI colors
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;

  // Bright ANSI colors
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

/**
 * Color definitions for a single mode (light or dark)
 */
export interface ModePalette {
  semantic: SemanticPalette;
  terminal: TerminalPalette;
}

/**
 * Complete color scheme definition
 */
export interface ColorScheme {
  id: ColorSchemeId;
  name: string;
  description: string;
  category: ColorSchemeCategory;
  /** Light mode palette */
  light: ModePalette;
  /** Dark mode palette */
  dark: ModePalette;
  /** Whether this is a built-in scheme */
  isBuiltIn: boolean;
  /** Sort order in UI */
  sortOrder: number;
}

/**
 * Database model for color_scheme table
 */
export interface ColorSchemeRecord {
  id: string;
  name: string;
  description: string | null;
  category: ColorSchemeCategory;
  /** JSON-encoded ColorDefinitions */
  colorDefinitions: string;
  /** JSON-encoded terminal palette override (optional) */
  terminalPalette: string | null;
  isBuiltIn: boolean;
  sortOrder: number;
  createdAt: Date;
}

/**
 * User appearance settings (database model)
 */
export interface AppearanceSettings {
  id: string;
  userId: string;
  /** User's mode preference */
  appearanceMode: AppearanceMode;
  /** Color scheme for light mode */
  lightColorScheme: ColorSchemeId;
  /** Color scheme for dark mode */
  darkColorScheme: ColorSchemeId;
  /** Terminal background opacity (0-100) */
  terminalOpacity: number;
  /** Terminal backdrop blur in pixels */
  terminalBlur: number;
  /** Terminal cursor style */
  terminalCursorStyle: "block" | "underline" | "bar";
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Resolved appearance state (computed from settings + system preference)
 */
export interface ResolvedAppearance {
  /** Effective mode (resolved from system if needed) */
  mode: ResolvedMode;
  /** Active color scheme based on current mode */
  colorScheme: ColorScheme;
  /** Whether mode was determined by system preference */
  isSystemMode: boolean;
  /** Terminal appearance settings */
  terminalOpacity: number;
  terminalBlur: number;
  terminalCursorStyle: "block" | "underline" | "bar";
}

/**
 * Input for updating appearance settings
 */
export interface UpdateAppearanceInput {
  appearanceMode?: AppearanceMode;
  lightColorScheme?: ColorSchemeId;
  darkColorScheme?: ColorSchemeId;
  terminalOpacity?: number;
  terminalBlur?: number;
  terminalCursorStyle?: "block" | "underline" | "bar";
}

/**
 * API response for appearance settings
 */
export interface AppearanceResponse {
  settings: AppearanceSettings;
  schemes: ColorScheme[];
}

/**
 * Default appearance settings
 */
export const DEFAULT_APPEARANCE: Omit<AppearanceSettings, "id" | "userId" | "createdAt" | "updatedAt"> = {
  appearanceMode: "system",
  lightColorScheme: "ocean",
  darkColorScheme: "midnight",
  terminalOpacity: 100,
  terminalBlur: 0,
  terminalCursorStyle: "block",
};

/**
 * All available color scheme IDs
 */
export const COLOR_SCHEME_IDS: readonly ColorSchemeId[] = [
  "ocean",
  "forest",
  "sunset",
  "midnight",
  "arctic",
  "rose",
  "amber",
  "mono",
  "catppuccin",
  "solarized",
  "oneDark",
  "gruvbox",
] as const;

/**
 * Validate if a string is a valid color scheme ID
 */
export function isValidColorSchemeId(id: string): id is ColorSchemeId {
  return COLOR_SCHEME_IDS.includes(id as ColorSchemeId);
}

/**
 * Validate if a string is a valid appearance mode
 */
export function isValidAppearanceMode(mode: string): mode is AppearanceMode {
  return mode === "light" || mode === "dark" || mode === "system";
}
