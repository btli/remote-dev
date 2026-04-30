---
name: Remote Dev
description: Web-based terminal interface with persistent tmux sessions, multi-agent CLIs, and a quiet, gesture-literate mobile surface
colors:
  bg-light: "oklch(1 0 0)"
  bg-dark: "oklch(0.145 0 0)"
  fg-light: "oklch(0.145 0 0)"
  fg-dark: "oklch(0.985 0 0)"
  surface-card-light: "oklch(1 0 0)"
  surface-card-dark: "oklch(0.205 0 0)"
  primary-light: "oklch(0.205 0 0)"
  primary-dark: "oklch(0.922 0 0)"
  muted-fg-light: "oklch(0.556 0 0)"
  muted-fg-dark: "oklch(0.708 0 0)"
  border-light: "oklch(0.922 0 0)"
  border-dark: "oklch(1 0 0 / 0.10)"
  ring-light: "oklch(0.708 0 0)"
  ring-dark: "oklch(0.556 0 0)"
  destructive: "oklch(0.577 0.245 27.325)"
  destructive-dark: "oklch(0.704 0.191 22.216)"
  signal-attention: "oklch(0.6 0.2 250 / 0.8)"
  midnight-primary: "oklch(0.55 0.18 270)"
  midnight-accent: "oklch(0.65 0.15 250)"
  terminal-tokyo-bg: "#1a1b26"
  terminal-tokyo-fg: "#a9b1d6"
  terminal-tokyo-cursor: "#c0caf5"
  terminal-tokyo-blue: "#7aa2f7"
  terminal-tokyo-cyan: "#449dab"
  terminal-tokyo-green: "#9ece6a"
  terminal-tokyo-magenta: "#ad8ee6"
  terminal-tokyo-red: "#f7768e"
  terminal-tokyo-yellow: "#e0af68"
typography:
  display:
    fontFamily: "var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif"
    fontWeight: 600
    lineHeight: 1.2
  body:
    fontFamily: "var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    letterSpacing: "0.01em"
  mono:
    fontFamily: "JetBrainsMono Nerd Font Mono, var(--font-geist-mono), ui-monospace, monospace"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.4
rounded:
  sm: "0.25rem"
  md: "0.375rem"
  lg: "0.625rem"
  xl: "0.875rem"
  pill: "9999px"
spacing:
  xs: "0.25rem"
  sm: "0.5rem"
  md: "0.75rem"
  lg: "1rem"
  xl: "1.5rem"
components:
  button-primary:
    backgroundColor: "{colors.primary-light}"
    textColor: "{colors.bg-light}"
    rounded: "{rounded.md}"
    height: "2.25rem"
    padding: "0 0.75rem"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.fg-light}"
    rounded: "{rounded.md}"
    height: "2.25rem"
    padding: "0 0.75rem"
  button-destructive:
    backgroundColor: "{colors.destructive}"
    textColor: "{colors.bg-light}"
    rounded: "{rounded.md}"
    height: "2.25rem"
    padding: "0 0.75rem"
  card:
    backgroundColor: "{colors.surface-card-light}"
    textColor: "{colors.fg-light}"
    rounded: "{rounded.xl}"
    padding: "1.5rem"
  input:
    backgroundColor: "transparent"
    textColor: "{colors.fg-light}"
    rounded: "{rounded.md}"
    height: "2.25rem"
    padding: "0 0.75rem"
  dialog:
    backgroundColor: "{colors.surface-card-light}"
    textColor: "{colors.fg-light}"
    rounded: "{rounded.lg}"
    padding: "1.5rem"
---

# Design System: Remote Dev

> **Baseline document.** This captures the system as it stands at the point of mobile redesign. The Do's and Don'ts already encode the direction the redesign is taking; expect the Components and Color sections to evolve as the redesign lands. Re-run `$impeccable document` after the new mobile UI ships.

## 1. Overview

**Creative North Star: "The Quiet Workshop"**

Remote Dev is a tool for people who already know how to use their tools. The interface is the workbench, not the work. Surfaces are calm and uncluttered so the terminal output, agent feedback, and notifications can carry the room. Color and motion are spent on signal (running, stuck, error, new message), never on decoration.

The current system is achromatic neutral by default (a Linear-grade neutral ramp from `oklch(1 0 0)` to `oklch(0.145 0 0)` across both themes), with Tokyo Night living inside the user-selectable "midnight" scheme rather than as the ambient brand. Light and dark are both built deliberately, with their own contrast and chroma decisions; theme follows OS by default. Density is welcome where it earns it (modal forms, list rows, terminal toolbars at 28-32px); padding is generous where it relieves cognitive load (cards, dialogs at 24px).

The redesign of mobile is the live edge. Mobile must read as gesture-literate and native, not as a shrunken desktop. Glassmorphism on chrome (header, sidebar, mobile toolbars) is a current artifact, not a target. Expect that to fall away.

**Key Characteristics:**
- Quiet by default; expressive on demand.
- Two themes, both first-class. Neither is faked.
- Type-driven hierarchy. Color is a signal, not a decoration.
- Gesture is a primary affordance on mobile (swipe, long-press, pull); keyboard is the primary affordance on desktop.
- Density without crowding: dense rows pair with generous container padding.

### Surfaces

This system covers three implementations of two design surfaces:

- **Desktop** — Next.js web (and Electron wrapper). Tailwind v4 with the CSS custom properties in `globals.css` as the source of truth.
- **Mobile PWA** — Same Next.js codebase at small breakpoints, installable via the service worker.
- **Mobile Flutter** — Native iOS/Android app at `/mobile`. Consumes the same tokens from this DESIGN.md, mapped into Flutter `ThemeData` (color tokens → `ColorScheme`, typography → `TextTheme`, radius → `BorderRadius` constants).

**The two mobile implementations must read as one product.** Identical IA, identical primary affordances, identical visual identity. The Flutter app is not a separate design; it is the same design rendered through Flutter widgets.

**Desktop and mobile share visual identity but are not the same composition.** Same Geist Sans family, same color tokens, same signal language, same notification halo. Different layouts, different primary input modes, different density.

## 2. Colors

The palette is achromatic neutral by default with one signal accent (notification-attention blue). The "midnight" appearance scheme adds a purple-blue identity for users who want it; the terminal palette inside the editor is always Tokyo Night for legibility.

### Primary
- **Ink** (light: `oklch(0.205 0 0)` / dark: `oklch(0.922 0 0)`): Used for primary buttons, headlines, the deepest text. Inverts cleanly between themes; never colored.

### Neutral (the Workshop ramp)
- **Page** (light: `oklch(1 0 0)` / dark: `oklch(0.145 0 0)`): Page background. Both ends are tinted neutral; never raw `#fff` or `#000`.
- **Surface** (light: `oklch(1 0 0)` / dark: `oklch(0.205 0 0)`): Cards, dialogs, popovers. Light theme stays at white; dark theme lifts one step off page.
- **Muted text** (light: `oklch(0.556 0 0)` / dark: `oklch(0.708 0 0)`): Secondary copy, metadata, helper text. Always tested against AA.
- **Border** (light: `oklch(0.922 0 0)` / dark: `oklch(1 0 0 / 0.10)`): Hairline divisions. Dark theme uses a 10% white alpha so borders read on tinted surfaces.

### Signal (the only chromatic colors in app chrome)
- **Attention Blue** (`oklch(0.6 0.2 250 / 0.8)`): Pulses around agent sessions waiting for input (notification ring halo). The single decoratively-colored value in the chrome.
- **Destructive** (`oklch(0.577 0.245 27.325)`): Errors, destructive confirmations only. Not for "primary action" buttons.

### Terminal (always dark, never themed by app theme)
- Tokyo Night palette (`#1a1b26` background through `#a9b1d6` foreground, with the standard ANSI 8). Lives inside the terminal viewport regardless of app theme. Treat as content, not chrome.

### Optional Identity (user-selectable)
- **Midnight scheme**: a purple-blue OKLCH palette (`oklch(0.55 0.18 270)` primary, `oklch(0.65 0.15 250)` accent) the user can switch to per-profile. Not the default. Never the only path to identity.

### Named Rules

**The Achromatic-Default Rule.** Default chrome carries no chroma. Color enters chrome only as signal (attention, destructive, or user-selected scheme). If a new screen needs a tint to "look interesting," it doesn't.

**The One Voice Rule.** The signal accent appears on ≤5% of any screen. If three things on a screen are using accent color, two of them are wrong.

**The Terminal-Is-Content Rule.** The terminal viewport keeps its own palette. App theme never overrides the Tokyo Night colors inside a running session.

**The One Source of Truth Rule.** Every color token in this DESIGN.md frontmatter resolves to the same OKLCH value in three places: Tailwind v4 `@theme` (`globals.css`), Flutter `ColorScheme` constants (`/mobile`), and any future surface. If a Flutter screen's blue and a web screen's blue don't match, the Flutter screen is wrong.

## 3. Typography

**Display Font:** Geist Sans (with `ui-sans-serif`, `system-ui`, `sans-serif` fallback)
**Body Font:** Geist Sans (same family, different weights and tracking)
**Mono Font:** JetBrainsMono Nerd Font Mono (with `var(--font-geist-mono)`, `ui-monospace`, `monospace` fallback). 22 Nerd Font families are self-hosted as WOFF2 for terminal use.

**Character:** A single sans family carries both display and body roles, with weight and scale doing the work of contrast. Geist's tight letterforms read as tool-grade rather than editorial. Mono is reserved for the terminal viewport, code, and identifiers; never for UI labels or prose.

### Hierarchy
- **Display** (600, ~1.5rem-2rem clamped, line-height 1.2): Modal titles, page headers. Used sparingly; most surfaces don't need a display step.
- **Title** (600, 1.125rem, line-height 1.25): Dialog titles, sidebar section headers.
- **Body** (400, 0.875rem, line-height 1.5): Default UI copy, list rows, form labels' siblings. Capped at ~70ch for long-form prose.
- **Label** (500, 0.75rem, letter-spacing 0.01em): Form labels, chip text, tab labels.
- **Helper** (400, 0.625rem, muted-fg color): Metadata, timestamps, "press ⌘K to" hints. Keep AA at 0.625rem.
- **Mono** (400, 0.875rem, line-height 1.4): Terminal viewport, command snippets, identifiers in error messages. Never used for UI labels.

### Named Rules

**The Single-Family Rule.** UI uses Geist Sans only. No serif, no display face, no second sans. Mono lives inside the terminal and code blocks, nowhere else.

**The Weight-Over-Size Rule.** Hierarchy on dense rows is 500 vs 400 at the same size, not a size step. Reach for size steps only at the section/dialog/page level.

## 4. Elevation

The system is **flat at rest, lifted on response**. Default surfaces have no shadow. Cards rest at `shadow-sm` only when they're standalone objects on a busy page (rare in this app). Dialogs lift to `shadow-lg` because they're modal foreground. Hover and focus do not raise elevation; they shift color and ring weight instead.

The current build uses `backdrop-filter: blur()` on the desktop header (~3px), sidebar (~6px), mobile input bar, mobile keyboard, and the floating "Latest" pill. **Treat this as a current artifact, not a target.** The redesign moves toward solid surfaces with hairline borders for chrome, reserving any real backdrop blur for a single deliberate spot (e.g. a system sheet over live terminal output) where the blur communicates state, not style.

### Shadow Vocabulary
- **shadow-sm** (`0 1px 2px 0 rgb(0 0 0 / 0.05)`): Standalone cards. Optional.
- **shadow-lg** (`0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)`): Modal dialogs only.
- **Notification ring halo** (animated `box-shadow` pulsing at `oklch(0.6 0.2 250 / 0.8)`, 2s ease-in-out): The one decorative shadow. Reserved for agent-needs-attention state, never decorative.

### Named Rules

**The Flat-By-Default Rule.** Surfaces are flat at rest. Shadows appear as a response to elevation (modal lift) or state (notification halo), never as decoration.

**The Glass-Earns-Its-Place Rule.** `backdrop-filter: blur()` is used only when blurring out live content beneath a transient overlay communicates that the underlying state is paused. If the only reason for blur is "looks premium," remove it.

## 5. Components

### Buttons
- **Shape:** rounded-md (0.375rem). 2.25rem default height (`h-9`), 2rem `sm`, 2.5rem `lg`.
- **Primary:** `bg-primary` text on `bg-primary` (Ink on Page color-inverted). 0.75rem horizontal padding, 0.875rem text, 500 weight.
- **Ghost:** transparent at rest, `hover:bg-accent` on hover. Default control variant for inline rows.
- **Outline / Secondary:** 1px border, transparent fill, ghost-like hover.
- **Destructive:** `bg-destructive` only. Not used for confirmations of routine actions.
- **Focus:** 3px ring at `ring-ring/50`. Currently heavier than typical shadcn defaults; review during mobile redesign.

### Cards
- **Corner Style:** rounded-xl (0.875rem).
- **Background:** `surface-card`. Border `1px` at `border` token.
- **Shadow Strategy:** `shadow-sm` only when the card stands alone. Never nested.
- **Internal Padding:** 1.5rem (24px) all sides; 1.5rem gap between header / content / footer.

### Inputs / Fields
- **Style:** 1px border at `border-input`. Background transparent in light, `bg-input/30` in dark.
- **Shape:** rounded-md (0.375rem). 2.25rem height.
- **Focus:** 3px `ring-ring/50` outside the border, plus border color shift to `ring`.
- **Error:** `border-destructive` and `ring-destructive/50`. Helper text below in `destructive` color.

### Dialog
- **Overlay:** flat `bg-black/50`. No blur (intentional flat foreground).
- **Content:** rounded-lg (0.625rem), 1.5rem padding, `shadow-lg`. Centered, max-width `sm:max-w-lg`.
- **Animation:** zoom-in-95 + fade-in via `tw-animate-css`. ~150ms.

### Mobile Toolbars (current — being redesigned)
The mobile experience currently uses a stack of pinned-bottom toolbars: status strip → terminal scroll panel → input bar (`MobileInputBar`) → optional keyboard surface (`MobileKeyboard`). Both bars currently use `bg-popover/95 backdrop-blur-sm border-t`. iOS safe-area is handled via `env(safe-area-inset-bottom)` and `.pb-safe-bottom`. There is no native bottom-sheet/drawer pattern, no tab bar, no swipe gesture for project/session navigation. The redesign target is to remove the stacked-toolbar pattern and introduce gesture-first navigation; this section will be rewritten when that lands.

### Notification Surface (preserved)
The notification system is the one piece of the current mobile experience that meets the bar. The pulsing attention-blue halo (`notification-ring-pulse`, line 679 of globals.css) is the canonical "agent needs you" affordance. Any redesign preserves this signal and its color.

### Named Rules

**The No Side-Stripe Rule.** The current `border-l-2` colored stripes (DirectoryBrowser selected row, NotificationPanel unread state) are wrong by impeccable's bans and will be replaced. Selected and unread states use background tints, weight changes, or leading dots, not colored side-borders.

## 6. Do's and Don'ts

### Do:
- **Do** treat the two mobile implementations (PWA + Flutter) as a single design surface. Same IA, same affordances, same tokens. Differences exist only where platform idioms genuinely require them (push permission, share sheet, biometric).
- **Do** keep desktop and mobile as separate compositions that share identity. Same family, same tokens, same signal language; different layouts and density.
- **Do** keep the chrome achromatic by default. Color enters chrome as signal only.
- **Do** use weight contrast (500 vs 400) for hierarchy on dense rows; reach for size steps only at section/dialog/page boundaries.
- **Do** design light and dark deliberately. Both ship.
- **Do** preserve the notification attention-blue halo (`oklch(0.6 0.2 250 / 0.8)`) as the canonical "agent needs you" signal across all surfaces.
- **Do** treat gesture as a primary affordance on mobile: swipe between sessions, long-press to act on a notification, pull to refresh, drag to reorder.
- **Do** meet 44x44pt touch targets on mobile, including dense list rows.
- **Do** respect `prefers-reduced-motion` on every animation, including the notification halo.

### Don't:
- **Don't** use `border-left` or `border-right` greater than 1px as a colored accent (current violations: `DirectoryBrowser.tsx:298`, `NotificationPanel.tsx:81`). Replace with background tint, weight, or leading dot/pip.
- **Don't** add `backdrop-filter: blur()` to new chrome. Glassmorphism is a current artifact (header, sidebar, mobile toolbars), not a target. Reserve blur for transient overlays where blurring underlying live content communicates pause-state.
- **Don't** ship Tokyo Night as ambient brand. It lives inside the terminal viewport and inside the user-selectable "midnight" scheme; default chrome stays achromatic.
- **Don't** use neon, gamer-dark, RGB, or saturated cyan/magenta accents in chrome. The terminal palette is the only place those colors live.
- **Don't** use gradient text (`background-clip: text` on a gradient) anywhere.
- **Don't** rasterize UI text. Type stays semantic.
- **Don't** ship desktop chrome shrunk to phone. Mobile is its own composition with its own affordances.
- **Don't** use the hero-metric template (big number + small label + supporting stats + gradient) on any dashboard or status surface.
- **Don't** wrap every list row in a card. Cards are objects, not row decorations. Nested cards are always wrong.
- **Don't** use modal dialogs for things that could be inline disclosures, sheets, or progressive panels. Modal-as-first-thought is laziness.
- **Don't** add a second UI typeface. Geist Sans only for chrome; mono lives in the terminal and code blocks.
- **Don't** soften the tool with marketing-grade decoration: no pastel illustrations, no rounded blob mascots, no "friendly" gradient backgrounds.
- **Don't** let the Flutter app and the PWA drift visually. If a button radius, color, or motion token differs between them, one of them is wrong.
- **Don't** import the desktop layout into mobile (or vice versa). Each composition is designed for its surface.
