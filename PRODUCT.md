# Product

## Register

product

## Users

Solo developers and power users who run multiple terminal sessions, AI coding agents (Claude Code, Codex, Gemini, OpenCode), and TUIs across long-lived tmux sessions. They live in the terminal at the desk and need that same access from a phone, in two distinct modes:

1. **Companion / on-the-go.** Glancing at agent progress, reading notifications, checking peer messages, sending a quick prompt or command nudge to a running session. Seconds-long interactions, often one-handed, often outside.
2. **Capable / deep-dive.** Fully interacting with a TUI, scrolling output, sending real input, recovering a stuck agent, doing substantive work without retreating to a laptop. Minutes-long focus sessions.

Both must work on the same mobile surface. The user is technical, fast, and impatient with decoration that gets between them and the terminal.

## Product Purpose

Remote Dev makes a developer's persistent shell, agent fleet, and project workspace reachable from anywhere, with first-class support for running multiple agent CLIs in isolated profiles, organizing them by project group, and coordinating between agents via channels and peer messages.

Success on mobile means: the user reaches for their phone instead of opening a laptop for the routine 80% of agent oversight, and never feels punished when they need the deeper 20%.

Success in general means: the tool disappears around the work. The terminal, the agent's output, and the notifications are the product. Everything else is connective tissue that should be quiet, fast, and trustworthy.

## Surfaces

Remote Dev ships across three implementations of two design surfaces:

| Surface | Implementations | Primary input | Primary use |
|---|---|---|---|
| **Desktop** | Next.js web at the desk; Electron wrapper for native window/tray | Keyboard + pointer | Long focus sessions, multi-pane work, full TUI interaction |
| **Mobile** | Mobile PWA (installable Next.js, same codebase) **and** Flutter native (iOS / Android in `/mobile`) | Touch + gesture | Companion oversight; deep-dive when away from desk |

The two mobile implementations (PWA + Flutter) must read as **one product**. Identical information architecture, identical primary affordances, identical visual identity, identical interaction patterns. A user moving from PWA to native (or vice versa) should not need to relearn anything. Where the platforms genuinely differ (push notification permission flows, share sheets, biometric auth), each implementation uses its native idiom; everywhere else, they converge.

Desktop and mobile share a visual identity (typography family, color tokens, signal language) but **are not the same composition**. Each is designed for its own ergonomics: keyboard density and multi-pane on desktop; gesture, full-bleed, and one-thumb reach on mobile. Mobile is not a desktop layout shrunk. Desktop is not a mobile layout zoomed.

## Brand Personality

Quiet, expert, gestural.

- **Quiet.** Calm surfaces, restrained color, almost no decoration. The interface doesn't compete with terminal content for attention. Emphasis is earned per interaction, not sprayed across the chrome.
- **Expert.** No tutorialese, no padding, no marketing tone. Defaults assume the user knows what tmux, a worktree, and a CLI agent are. Density is welcome where it earns it.
- **Gestural.** Especially on mobile, long-press, swipe, and pull are first-class affordances, not nice-to-haves bolted onto a desktop pattern. The hand is the primary input device on phone; the keyboard is the primary input device at the desk. Each surface is designed for its actual ergonomics.

The lineage: Things 3's calm and gesture literacy, applied to developer tooling with Linear's discipline.

## Anti-references

What this should explicitly NOT look like:

- **Glassmorphism / Tokyo Night cosplay.** The current "Tokyo Night theme with glassmorphism" reads as toy and decorative on mobile. Frosted panels, blurred backdrops, and neon accents on near-black are the exact aesthetic to leave behind.
- **Gamer-dark / neon-on-black.** Saturated cyans, magentas, lime greens used as decoration. Terminal-adjacent does not mean RGB.
- **Desktop chrome shrunk to phone.** Sidebars compressed into drawers, dense data tables forced into 375px, hover-only affordances. Mobile must be designed for the phone, not adapted to it.
- **Identical card grids.** Same-sized rectangles with icon + heading + body, repeated. The dashboard-of-tiles cliché.
- **Hero-metric template.** Big number, small label, supporting stats, gradient accent. SaaS dashboard reflex.
- **SaaS-cream / illustrated marketing aesthetic.** Pastel gradients, rounded blob illustrations, friendly mascot tone. This is a tool, not a product page.

## Design Principles

These principles cover all three implementations (desktop web, mobile PWA, mobile Flutter). Where a principle applies differently to desktop vs. mobile, it says so.

1. **Each surface is designed for its own ergonomics.**
   - **Desktop**: keyboard-first. Every action reachable without a mouse, with discoverable shortcuts. Multi-pane layouts welcome, density welcome, hover affordances OK. The user is sitting down with two hands.
   - **Mobile (both PWA and Flutter)**: gesture-first. One-thumb reach, full-bleed compositions, native-feeling input bars. Hover does not exist. The user is standing, walking, or one-hand-on-the-phone.
   - Mobile is a peer surface to desktop, not a degraded one. If a workflow can't be done on mobile, that's a deliberate decision; document it.

2. **The two mobile implementations converge.** PWA and Flutter must feel like the same product. Same IA, same primary affordances (swipe-between-sessions, pull-to-refresh, long-press-to-act), same visual identity, same notification language. Differences exist only where platform idioms genuinely require them (push permission, share sheet, biometric auth, file system access). Reuse design tokens across both: a token defined once in DESIGN.md is the source of truth for both web (Tailwind v4 / CSS variables) and Flutter (ThemeData mapping).

3. **Quiet by default, expressive on demand.** Restrained palette, single typeface family, sparing accent. Color and motion get spent on state changes that matter (running, stuck, error, new message), not on decoration. This applies identically across desktop and mobile.

4. **Gestures are real affordances on mobile, shortcuts are real affordances on desktop.** Swipe between sessions, long-press to act on a notification, pull to refresh, drag to reorder on mobile. Discoverable command palette, vim-style chord bindings, and keyboard navigation on desktop. Each surface earns its expert affordances; neither relies on hidden easter eggs.

5. **Trust the expert.** No empty-state coaching for users who have run terminals for fifteen years. No tooltips on obvious icons. No confirmation modals for actions that are reversible. Density and shortcuts welcome on both surfaces.

6. **Notifications are the contract.** They are how the user trusts running work. They must be reliable, scannable on a lock screen, actionable in two taps, and consistent between push (PWA web push, Flutter native push), in-app (toast, panel, channel), and the OS notification center. The current notification system is the one piece of the mobile experience that already meets the bar; the rest must rise to it. Keep the existing notification model, ladder, and visual language (the `oklch(0.6 0.2 250 / 0.8)` attention-blue halo) intact across the redesign.

## Accessibility & Inclusion

- **Light and dark are both first-class.** Both themes are designed deliberately, with their own contrast and chroma decisions. No "dark by default with a light afterthought." Theme follows OS by default; user override per profile.
- **WCAG AA contrast** for all text and UI controls is the floor, not the ceiling. No decorative-only color (color must always be paired with shape, position, weight, or text).
- **Touch targets** of 44x44pt minimum for any interactive control on mobile, including dense list rows.
- **Reduced motion** respected by all transitions; no state communicated by motion alone.
- **Keyboard parity** at the desk: every interaction reachable without a mouse, with discoverable shortcuts.
