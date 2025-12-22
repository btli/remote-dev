/**
 * Shell Framework and Theme Definitions
 *
 * Supports multiple shell customization frameworks:
 * - Oh My Zsh: Popular zsh framework with 150+ themes
 * - Starship: Cross-shell prompt with presets
 * - Powerlevel10k: Fast zsh theme with configuration wizard
 * - None: Plain shell (no framework)
 */

import type { ShellFramework } from "@/types/preferences";

export interface ShellFrameworkInfo {
  id: ShellFramework;
  name: string;
  description: string;
  detectPath?: string;
  configFile?: string;
  website: string;
}

export interface ShellTheme {
  id: string;
  name: string;
  description: string;
  /** Whether this theme requires additional fonts (e.g., powerline/nerd fonts) */
  requiresFonts?: boolean;
}

/**
 * Shell framework definitions
 */
export const SHELL_FRAMEWORKS: ShellFrameworkInfo[] = [
  {
    id: "oh-my-zsh",
    name: "Oh My Zsh",
    description: "Popular zsh framework with 150+ themes and plugins",
    detectPath: "~/.oh-my-zsh",
    configFile: "~/.zshrc",
    website: "https://ohmyz.sh",
  },
  {
    id: "starship",
    name: "Starship",
    description: "Minimal, fast, cross-shell prompt with presets",
    detectPath: "~/.config/starship.toml",
    configFile: "~/.config/starship.toml",
    website: "https://starship.rs",
  },
  {
    id: "powerlevel10k",
    name: "Powerlevel10k",
    description: "Fast zsh theme with instant prompt and configuration wizard",
    detectPath: "~/.p10k.zsh",
    configFile: "~/.p10k.zsh",
    website: "https://github.com/romkatv/powerlevel10k",
  },
  {
    id: "none",
    name: "None / Custom",
    description: "Plain shell or custom PS1 configuration",
    website: "",
  },
];

/**
 * Oh My Zsh themes
 * Reference: https://github.com/ohmyzsh/ohmyzsh/wiki/Themes
 */
export const OH_MY_ZSH_THEMES: ShellTheme[] = [
  { id: "robbyrussell", name: "Robby Russell", description: "Default - clean and minimal" },
  { id: "agnoster", name: "Agnoster", description: "Powerline-style with git status", requiresFonts: true },
  { id: "af-magic", name: "AF Magic", description: "Double-line with virtualenv support" },
  { id: "avit", name: "Avit", description: "Clean two-line with timestamps" },
  { id: "bira", name: "Bira", description: "Two-line with user@host and git" },
  { id: "bureau", name: "Bureau", description: "Clean git-focused theme" },
  { id: "candy", name: "Candy", description: "Colorful with full path display" },
  { id: "clean", name: "Clean", description: "Simple and minimal" },
  { id: "cloud", name: "Cloud", description: "Cloud-decorated minimal" },
  { id: "dst", name: "DST", description: "Minimal with git branch display" },
  { id: "eastwood", name: "Eastwood", description: "Minimal single-line" },
  { id: "fino", name: "Fino", description: "Clean two-line" },
  { id: "fino-time", name: "Fino Time", description: "Fino with timestamp" },
  { id: "fishy", name: "Fishy", description: "Fish shell inspired" },
  { id: "frontcube", name: "Frontcube", description: "Modern minimal" },
  { id: "gallois", name: "Gallois", description: "Clean with rvm/rbenv support" },
  { id: "gentoo", name: "Gentoo", description: "Gentoo Linux inspired" },
  { id: "gnzh", name: "GNZH", description: "Two-line with extensive info" },
  { id: "half-life", name: "Half-Life", description: "Lambda symbol theme" },
  { id: "jonathan", name: "Jonathan", description: "Two-line with hostname" },
  { id: "josh", name: "Josh", description: "Git-focused minimal" },
  { id: "kafeitu", name: "Kafeitu", description: "Detailed two-line" },
  { id: "kennethreitz", name: "Kenneth Reitz", description: "Minimal Python-friendly" },
  { id: "lambda", name: "Lambda", description: "Lambda symbol minimal" },
  { id: "minimal", name: "Minimal", description: "Extremely minimal" },
  { id: "muse", name: "Muse", description: "Creative minimal" },
  { id: "norm", name: "Norm", description: "Normal simple" },
  { id: "pygmalion", name: "Pygmalion", description: "Detailed info" },
  { id: "refined", name: "Refined", description: "Clean modern" },
  { id: "simple", name: "Simple", description: "Ultra-simple" },
  { id: "sorin", name: "Sorin", description: "Clean minimal" },
  { id: "steeef", name: "Steeef", description: "Detailed two-line" },
  { id: "sunrise", name: "Sunrise", description: "Colorful with time" },
  { id: "ys", name: "YS", description: "Detailed developer theme" },
  { id: "random", name: "Random", description: "Random theme each session" },
];

/**
 * Starship presets
 * Reference: https://starship.rs/presets/
 */
export const STARSHIP_PRESETS: ShellTheme[] = [
  { id: "default", name: "Default", description: "Standard Starship prompt" },
  { id: "nerd-font-symbols", name: "Nerd Font Symbols", description: "Uses Nerd Font symbols", requiresFonts: true },
  { id: "bracketed-segments", name: "Bracketed Segments", description: "Segments in brackets" },
  { id: "plain-text-symbols", name: "Plain Text", description: "No special symbols needed" },
  { id: "no-runtime-versions", name: "No Runtime Versions", description: "Hides language versions" },
  { id: "pure-preset", name: "Pure", description: "Minimal like Pure prompt" },
  { id: "pastel-powerline", name: "Pastel Powerline", description: "Soft colors with powerline", requiresFonts: true },
  { id: "tokyo-night", name: "Tokyo Night", description: "Tokyo Night color scheme" },
  { id: "gruvbox-rainbow", name: "Gruvbox Rainbow", description: "Gruvbox colors with rainbow", requiresFonts: true },
  { id: "jetpack", name: "Jetpack", description: "Space-inspired theme", requiresFonts: true },
];

/**
 * Powerlevel10k configurations
 * These are configuration styles from the p10k wizard
 */
export const POWERLEVEL10K_STYLES: ShellTheme[] = [
  { id: "lean", name: "Lean", description: "Minimal, no special fonts needed" },
  { id: "classic", name: "Classic", description: "Traditional powerline style", requiresFonts: true },
  { id: "rainbow", name: "Rainbow", description: "Colorful powerline segments", requiresFonts: true },
  { id: "pure", name: "Pure", description: "Pure-like minimal prompt" },
];

/**
 * Get themes for a specific shell framework
 */
export function getThemesForFramework(framework: ShellFramework): ShellTheme[] {
  switch (framework) {
    case "oh-my-zsh":
      return OH_MY_ZSH_THEMES;
    case "starship":
      return STARSHIP_PRESETS;
    case "powerlevel10k":
      return POWERLEVEL10K_STYLES;
    case "none":
      return [];
    default:
      return [];
  }
}

/**
 * Get framework info by ID
 */
export function getFrameworkInfo(framework: ShellFramework): ShellFrameworkInfo | undefined {
  return SHELL_FRAMEWORKS.find((f) => f.id === framework);
}

/**
 * Get default theme for a framework
 */
export function getDefaultTheme(framework: ShellFramework): string {
  switch (framework) {
    case "oh-my-zsh":
      return "robbyrussell";
    case "starship":
      return "default";
    case "powerlevel10k":
      return "lean";
    case "none":
      return "";
    default:
      return "";
  }
}

/**
 * Generate the shell command to apply a theme based on framework
 */
export function getThemeApplyCommand(
  framework: ShellFramework,
  theme: string
): string | null {
  switch (framework) {
    case "oh-my-zsh":
      // Export ZSH_THEME and reload zsh config
      return `export ZSH_THEME="${theme}" && source ~/.zshrc 2>/dev/null || true`;

    case "starship":
      // Starship uses presets, apply via starship preset command
      if (theme === "default") {
        return null; // Default doesn't need a command
      }
      return `starship preset ${theme} -o ~/.config/starship.toml 2>/dev/null || true`;

    case "powerlevel10k":
      // P10k doesn't support runtime theme changes easily
      // Would need to re-run the configuration wizard
      return null;

    case "none":
      return null;

    default:
      return null;
  }
}

/**
 * Get environment variables to set for a new session
 */
export function getThemeEnvironment(
  framework: ShellFramework,
  theme: string
): Record<string, string> {
  switch (framework) {
    case "oh-my-zsh":
      return { ZSH_THEME: theme };
    case "starship":
      // Starship reads from config file, no env var needed
      return {};
    case "powerlevel10k":
      // P10k uses config file
      return {};
    case "none":
      return {};
    default:
      return {};
  }
}
