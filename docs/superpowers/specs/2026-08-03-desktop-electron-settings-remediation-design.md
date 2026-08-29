# Desktop, Electron, and Settings Remediation - Design Spec

**Date:** 2026-08-03
**Status:** Draft pending written review
**Groups:** E1, D1-D8
**Source audit:** `remote-dev-9vik.6`, `.7`, `.9-.20`, `.22-.25`

## 1. Goals

This work restores trustworthy desktop behavior after the global Settings and
terminal layout refactors. It covers Electron startup, compact layout, the
Settings host, keyboard and accessibility contracts, theme continuity, async
feedback, and tmux cleanup safety.

The central sizing objective is not to replace the terminal resize reconciler.
The audit confirmed xterm and tmux converge after ordinary window and sidebar
transitions. The defect is the composition around the central terminal: at the
supported 800 by 600 Electron minimum, app navigation, terminal padding, optional
sidebars, and a fixed Settings navigation column can leave almost no Settings
content width. Electron zoom can also cross the web mobile breakpoint and replace
the entire desktop terminal with mobile onboarding.

## 2. Non-goals

- Do not redesign terminal rendering, change terminal font metrics, or duplicate
  the refit work in draft PR #451.
- Do not alter the tmux client-attach capability and
  `TmuxAttachArgumentResolver` owned by draft PR #450. Renderer link parsing stays
  with draft PR #451.
- Do not create a new visual system. Reuse the semantic application tokens and
  established component primitives.
- Do not expose Settings as a separate top-level application or URL solely to
  escape its layout constraints.
- Do not use destructive cleanup to migrate legacy tmux sessions.

## 3. Layout and shell architecture

### 3.1 One shell decision

Shell selection becomes an explicit application decision rather than several
independent UA, JavaScript width, and CSS breakpoint decisions.

- Electron always uses the desktop shell. The synchronous discriminator is the
  existing preload-exposed `window.electron` capability, captured before shell
  selection. Browser zoom may change available CSS pixels and compact the layout,
  but it cannot select mobile onboarding or unmount an active terminal.
- An installed mobile PWA or mobile interaction mode uses the mobile shell and
  its adaptive navigation defined by M1.
- The ordinary web app uses the existing responsive selection through one shared
  selector. Child components consume the selected shell mode; they do not run
  their own contradictory mobile tests.
- Changing compact layout within a shell is a CSS/state transition. It preserves
  terminal component identity, WebSocket ownership, session selection, editor
  state, and pending input.

The selected shell mode is available before the first meaningful render so a
desktop Electron window never flashes mobile onboarding during startup or zoom.

### 3.2 Central pane width contract

Every horizontal layer participates in a single min-width contract:

1. App navigation declares fixed or collapsible width.
2. Optional Files, MCP, task, and related rails declare their open and collapsed
   widths.
3. The central pane uses `min-width: 0`, owns overflow, and receives the remaining
   width.
4. Plugin surfaces inside the central pane receive the actual content box. They
   cannot assume the full window width.
5. xterm remains mounted and receives a reconcile request only after the final
   measured box changes.

The layout must not produce document-level horizontal scroll. A local surface may
scroll only when the contained information truly requires it and the region is
named for assistive technology.

### 3.3 Settings compact composition

`SettingsView` remains a terminal plugin, but its navigation adapts to the central
pane rather than the window:

- At comfortable widths, retain the current persistent section navigation and
  content column.
- At compact widths, replace the fixed section column with one labeled section
  selector or disclosure at the top of the content. It must expose all 15
  sections, the current section, and keyboard navigation.
- The content column uses `min-width: 0`, bounded vertical scrolling, and
  breakpoint-aware form/action rows. Long IDs, hostnames, commands, and status
  values wrap or use a named local scroller.
- Settings does not ask outer terminal padding and inner Settings padding to both
  preserve desktop gutters when the available content box is narrow.
- Navigating into and out of Settings preserves the terminal session and restores
  focus to the invoker or selected section heading.
- If compact plugin mode temporarily collapses or overlays the saved 220-pixel
  primary and 320-pixel secondary sidebars, it snapshots their independent states
  and restores both exactly on exit. The compact mode does not persist those
  temporary widths as user choices.

Acceptance viewports include 800 by 600, 1024 by 600, 1024 by 768, and 1440 by
900, with Electron zoom at 100, 125, 150, and 200 percent. Reset Zoom remains
reachable in every compact state. Dimension verification uses the existing resize
boundary without modifying #451-owned `Terminal.tsx` or its refit/font-race tests.

### 3.4 New Session compact composition

`NewSessionWizard` receives a bounded dialog/sheet body with a scrollable form
region and a persistent, non-overlapping action region. The focused or invalid
field scrolls into view. The wizard remains operable at 800 by 600 and at 200%
text zoom, including advanced agent/profile/project choices. Fixed-height spacing
is not used to satisfy one fixture.

Wizard state and step content are presentation-independent. Desktop renders them
inside one Radix dialog; mobile renders them directly inside one bottom sheet with
safe-area padding. Mobile never portals a desktop dialog from inside a sheet.
Header, Back/Close, validation, and primary actions remain reachable at 390 by 667
and 390 by 844. Focus remains trapped in the one active layer, Escape or platform
Back closes the expected layer, and focus returns to the trigger.

## 4. Electron startup state machine

E1 replaces the startup spinner as an implicit state with an explicit state
machine:

| State | Meaning | Available action |
|---|---|---|
| `inspecting` | Installation and configuration are being checked. | Cancel window close only. |
| `setup_required` | Required first-run data or binaries are absent. | Open setup, choose configuration, or exit. |
| `starting` | The managed server process is launching and health is pending. | Show progress and bounded timeout. |
| `ready` | The server health contract passed. | Load the application URL. |
| `stopped` | Auto-start is disabled or the managed servers were deliberately stopped. | Start, change mode, reopen setup, or exit. |
| `failed` | Spawn, early exit, timeout, or health check failed. | Retry, open diagnostics, return to setup, or exit. |

The setup wizard is reachable from `setup_required` during normal application
startup, not only through a route that requires the server to have started. It
uses the existing installation/persistence work tracked by GitHub issue #171.
Fresh state opens the existing five-step wizard. Completion or the explicit Skip
path writes a validated `setup-config.json`; corrupt or incomplete config returns
to a recoverable setup state. Ports, working directory, auto-start, and update
choices are applied to the following start attempt. A deliberate Settings/menu
entry reopens setup after first run.

Electron uses a concrete two-phase renderer bootstrap so the React wizard does not
depend on the terminal server it configures:

1. An `ElectronBootstrapProcess` starts the packaged Next renderer only, on an
   ephemeral loopback port, with `RDV_ELECTRON_BOOTSTRAP_ONLY=1`. It is independent
   of configured application/terminal ports.
2. That mode serves `/electron-bootstrap` for inspecting/starting/stopped/failed
   states and `/setup` mounting the existing `SetupWizard`. Other application
   pages redirect to the bootstrap state; platform/configuration and recovery
   actions use the preload IPC bridge.
3. Complete or Skip validates and atomically persists configuration through
   `setup-config-store.ts`. Skip writes explicit validated defaults; it is not an
   in-memory flag.
4. Electron keeps the bootstrap process and recovery UI alive while it constructs
   immutable `RuntimeConfig`, constructs the normal `ProcessManager` and updater,
   and starts the managed servers. It navigates the same BrowserWindow to the
   normal application URL only after health succeeds, then stops the bootstrap
   process after the application load commits.
5. A second launch loads valid config before constructing either manager. When
   auto-start is enabled it may show the bootstrap Starting state until Ready; when
   disabled it keeps the bootstrap Stopped state with a Start action. A later child
   exit or start failure starts/reuses the bootstrap process and navigates the
   existing window to recoverable state. Reopen Setup intentionally stops normal
   servers, returns to bootstrap, and applies saved changes through a full managed
   restart.

Completing or skipping first-run setup always performs that one immediate managed
start and transitions without a manual application restart. The persisted
`autoStart` choice governs subsequent application launches only.

`RuntimeConfig` is dependency-injected instead of mutating the current global
object after imports. `nextPort` and `terminalPort` drive both child environments
and health URLs; `workingDirectory` becomes the validated default session/project
directory passed to the server; `autoStart` gates initial managed-server start;
`checkForUpdates` gates `AutoUpdater` initialization/check-on-startup; the selected
WSL distribution is passed only on supported Windows paths. Port ranges,
distinctness, directory existence/access, and platform-specific values are
validated before persistence.

A failed child process cannot leave an infinite spinner. The failure view presents
a sanitized cause, exit code where meaningful, log location, and recovery actions.
Retry creates a fresh process attempt and tears down listeners from the prior
attempt. Closing the window or quitting Electron terminates only the child process
owned by that app instance.

Tray start, restart, stop, and mode changes use the same state machine. Conflicting
tray actions are disabled while pending and failures bring the existing window to
the recoverable error state. Reopening a window attaches one persistent status
listener; it does not accumulate one-shot listeners or load the application URL
more than once for a Ready transition.

The still-valid automatic dependency-install/web-fallback work currently mixed
into GitHub #171 is moved to a linked follow-up issue. E1 does not claim or retain
that extra behavior while rewriting #171 around `.6` and `.22`.

## 5. Desktop interaction primitives

### 5.1 Named icon controls

D2 audits all icon-only controls in the main shell and gives each a task-oriented
accessible name. A shared icon-control primitive carries:

- Native `button` semantics.
- A required accessible label.
- Visible focus and disabled states.
- Optional tooltip that repeats, but does not replace, the accessible name.
- At least the established desktop target area and 44 by 44 when used on a
  coarse-pointer layout.

Decorative SVGs are hidden from the accessibility tree. Dynamic labels describe
the action, such as `Collapse files`, not the icon shape.

The audit covers header, desktop/mobile rails, project/session tree,
tasks/Beads/schedules, channels, notifications, GitHub, Files,
browser/editor/recording, and Electron-facing controls. Representative full-page
accessibility snapshots must contain no unnamed buttons. A test helper or lint rule
prevents a new icon-only button from being introduced without a name.

### 5.2 Collapsed rails

Collapsed Files and MCP controls become real disclosure buttons. Activating one
opens the owned rail, updates `aria-expanded`, preserves the previous internal
selection, and triggers terminal measurement after the width transition. The
collapsed control is not a decorative placeholder and cannot trap focus in hidden
content.

### 5.3 Row actions

Task, schedule, and GitHub row actions that are visually revealed on hover are
also revealed by `:focus-within` and remain reachable in logical tab order. Touch
layouts expose an explicit overflow/action control. Visibility never depends on a
hover-capable pointer.

## 6. Composite trees

D4 implements project and repository navigation as an ARIA tree rather than
nested buttons:

- The collection uses `role="tree"`; rows use `role="treeitem"` and accurate
  `aria-level`, `aria-expanded`, `aria-selected`, and set position metadata where
  needed.
- One row target participates in a roving tab stop. Secondary menus are sibling
  buttons, never descendants of another button.
- Up/Down move between visible rows; Home/End move to the bounds; Right expands or
  enters children; Left collapses or moves to the parent; Enter activates; Space
  selects where selection is distinct from activation; printable characters use
  typeahead over visible labels.
- Rename, create, drag, context menu, and destructive confirmation behavior remain
  available without invalid DOM nesting.
- Focus is repaired predictably when the focused row is removed, moved, filtered,
  or collapsed under its parent.

Pointer and touch drag behavior must not consume keyboard selection or create a
second competing focus model.

The GitHub repository expansion surface implements the equivalent list/tree
contract, including expanded state and keyboard navigation. One Tab enters and one
Tab exits each composite widget.

## 7. Platform shortcut model

D5 introduces one client-safe shortcut registry. A shortcut is stored as semantic
modifiers and key, not a preformatted glyph string. The same registry provides:

- Platform formatting: Command glyphs on macOS, `Ctrl` on Windows and Linux.
- Handler matching through one primary-modifier predicate.
- Command palette and help-panel labels.
- Inline hints and keycap rendering.
- `aria-keyshortcuts` values where supported.

Session previous/next handling accepts Ctrl plus bracket on Windows/Linux and
Command plus bracket on macOS. Tests inject a platform adapter instead of mutating
global browser identity unsafely.

## 8. Theme continuity

D6 makes semantic appearance available before route-specific UI renders.

- Root appearance precedence is: validated controlled-embed
  `rdvAppearance=light|dark`; authenticated database preference once available;
  validated `rdv_appearance` cookie/local mirror; then
  `prefers-color-scheme`. Login can therefore render correctly without calling the
  authenticated appearance API. When authentication loads a different database
  value, it becomes authoritative and refreshes the mirror for the next prepaint.
- A static CSP-hashed bootstrap applies the mirror/system value before React and
  accepts only `system`, `light`, or `dark`. AppShell-skipped login and channel,
  session, and recording embeds consume the same root result. Controlled Flutter
  embeds use the authority contract in M5 and cannot be overwritten by a later
  provider fetch.
- The no-preference default follows `prefers-color-scheme` without a dark flash.
- Browser `color-scheme`, focus rings, backgrounds, text, borders, and native form
  controls match the active mode.
- CodeMirror chooses a light or dark editor extension from the active semantic
  mode. Tokyo Night may remain the terminal/editor dark palette where deliberate,
  but it is not forced inside a light application theme.
- Route transitions and editor mounting do not reset unsaved editor content.

Login form, OIDC choices, error copy, mobile-app banner, channel list/view/thread,
and embed empty/loading/failure states receive computed-contrast and visual tests
in light/dark/system. CodeMirror tests retain source content, undo history, cursor,
selection, scroll, and rendered Markdown across live system changes. D6 bases on
D5 and preserves its platform-aware Save shortcut in the shared
`CodeMirrorEditor.tsx`.

## 9. Async feedback contract

D3 creates a small shared action-result contract for the audited high-value UI
actions. It standardizes state, not wording or layout:

```
idle -> pending -> succeeded
                 -> failed(retryable, message, action)
```

- Local form validation stays next to the field.
- A recoverable command failure stays near the initiating control and exposes a
  retry that reuses the preserved input.
- Global completion may use the existing toast system when the user can navigate
  away, but a toast is not the only record of a blocking failure.
- Pending disables only conflicting actions and prevents duplicate submission.
- Abort and stale-response handling prevent an earlier request from overwriting a
  later user choice.
- Errors are logged with diagnostic detail while user copy remains actionable and
  sanitized.

D3 applies this contract to worktree deletion, recording save, schedule Run now,
browser navigation/frame load, agent restart, worktree creation, and Settings
Trigger load/toggle/delete. Both rejected promises and non-OK HTTP responses are
failures. A rejected Trigger DELETE retains its row and can never display success.
D3 owns only those high-value paths named by `.16`; D8 applies the same contract
to its other Settings mutations.

## 10. Settings state integrity

### 10.1 Controlled section navigation

The Settings session metadata is authoritative. When an existing Settings tab is
opened with a new valid section, `SettingsView` updates its active section,
announces the heading, and focuses it when navigation originated outside the tab.
Invalid section IDs fall back safely and never leave the content and navigation
out of sync.

Every external open and direct user selection increments one monotonic
`settingsNavigationRevision` in optimistic SessionContext metadata. The visible
section applies the highest revision immediately. Persistence acknowledgements and
failures carry the originating revision; an older response cannot select, revert,
or overwrite a newer section. A failure on the current revision retains the local
selection and exposes Retry rather than silently rolling back. Rapid
Terminal -> SSH -> Logs therefore settles on Logs, while later direct user
navigation wins over stale singleton-open responses. Rendered SessionManager tests
exercise the existing-tab singleton fast path, not only the helper call.

### 10.2 Durable debounced values

Settings sliders and similar immediate controls use a shared pending-save
coordinator owned above lazily mounted sections and retained by the Settings
session until all work drains. It has these semantics:

1. The visual value updates locally.
2. A keyed debounce map schedules the latest value independently for every
   setting, so changing xterm scrollback and tmux history within one debounce
   interval persists both.
3. Explicit section navigation, Escape, X, Settings close, and session switch call
   an awaitable drain before unmount/release. Lazy child cleanup may enqueue its
   final value but is never expected to await network work or own retry UI.
4. A failed flush leaves the value visibly unsaved with Retry and Revert actions.
5. Each preference key serializes its requests and attaches a generation; an older
   response cannot replace a newer local value.

This controller is reused only for the same persistence semantics. Ordinary form
submission and unrelated toggles are not forced into a debounce abstraction.

### 10.3 Form semantics

Every Settings control has a stable programmatic name, description, error
association, and keyboard interaction. Selectable cards use native radio,
checkbox, or button semantics with visible selected and focus states. Group labels
do not rely on visual proximity.

### 10.4 Exactly-once SSH creation

Generated-key SSH creation is a guarded client `create -> success` state machine:

- The pending transition issues exactly one POST. Click, Enter, double-click, and
  component rerender cannot issue another request; no automatic POST retry occurs
  after an ambiguous network result.
- The submit action remains pending until the result is known and cannot be
  activated twice through click, Enter, or remount.
- Success clears sensitive transient fields only after the canonical record is
  available. The success step names the created connection, provides Copy public
  key and Done actions, and has no enabled Create action. Failure preserves
  correctable input and offers retry.
- Any edit after creation uses PATCH with the returned connection ID; it cannot
  implicitly issue another POST.

Request-count and list-integrity tests cover generated, pasted, and uploaded key
modes. Generated-key success proves Copy and Done behavior and exactly one new
connection/key identity in the list.

## 11. Instance-safe tmux ownership

D7 creates one random UUID atomically in the canonical data directory and persists
it in a versioned instance-identity file. Moving the entire data directory retains
identity; pointing Remote Dev at a different data directory creates a different
identity. Startup holds an OS-level exclusive lock keyed by UUID for the process
lifetime, so concurrently copied identity files fail with both canonical data
paths named rather than sharing a tmux server. Invalid identity files also fail
safely. A versioned,
tmux-safe label `rdv-v1-<encoded-uuid>` selects the instance's server through
`tmux -L` on every command.

New sessions always use that instance-scoped server. Both current creation
boundaries, `src/server/terminal.ts` and `src/services/tmux-service.ts`, plus the
application gateway, list API, and cleanup API receive the same
`TmuxEnvironment`; falling back to the process user's default server is not
permitted. Every new session also stores the identity in a tmux option for
diagnostics and defense in depth.

A durable `tmux_session_registry` closes the database-to-tmux deletion race. Rows
are keyed by tmux session name and store owner identity, lifecycle
`active|released|cleaning`, and a monotonic version. Creation/resume compare-and-
swaps the exact row to `active` in the same database transaction that establishes
the current terminal record. Ending a database session leaves a `released`
registry row.

Listing classifies sessions as:

- `managed-active`: exact owner match and a current database record.
- `managed-orphaned`: exact owner match and no current database record.
- `foreign`: a different owner fingerprint.
- `legacy-unknown`: no ownership option and no exact current database record.

Only `managed-orphaned` sessions with a matching `released` registry row on the
instance-scoped server are eligible for cleanup. Foreign and legacy-unknown
sessions may be reported as informational but never selected or killed. Existing
database records that point to legacy sessions on the default server may attach
through a narrow compatibility adapter by exact recorded name. They remain
ineligible for orphan cleanup and are not adopted or moved destructively; new and
restarted sessions use the scoped server. Name prefix alone is never ownership
proof.

Cleanup compare-and-swaps the candidate registry row from `released` to `cleaning`
with the listed version and confirms no current terminal record in the same
transaction. Creation or resume therefore wins the registry claim or observes
`cleaning` and cannot attach; cleanup cannot kill after a resume won. After the
claim, the endpoint revalidates the scoped tmux server and owner option, kills the
exact session, and records the result. Failed kills return the registry row to
`released`; success removes or marks it cleaned. The browser cannot supply an
arbitrary tmux server or unlisted name.

Regression tests point two temporary data directories at one uniquely named
disposable legacy `tmux -L` server to reproduce the original shared-server defect,
then verify ambiguous legacy sessions are fail-closed. Separate scoped labels prove
new-session isolation. A list -> resume/create -> bulk-delete race proves exactly
one registry claimant and no live-session kill.

D7 branches only after #450 is rebased on current `origin/master` and its
`TmuxAttachArgumentResolver`/hyperlink tests pass. D7 preserves that attach
capability and does not claim renderer link parsing from #451.

## 12. Group-specific acceptance

| Group | Required proof |
|---|---|
| E1 | Fresh install reaches the five-step setup; complete/skip persists and applies every setup choice; configured install starts; corrupt config, spawn exit, occupied port, missing executable, timeout, and child exit reach recovery; tray retry and window reopen do not leak processes or listeners. |
| D1 | New Session uses one accessible layer and remains usable at all named desktop/mobile sizes; all Settings sections remain usable at target compact viewports; temporary rail changes restore saved widths on exit; Electron zoom preserves terminal DOM/session identity, keeps Reset Zoom reachable, and returns correct xterm/tmux dimensions after settling. |
| D2 | Every audited icon control has a state-aware name; full-page AX snapshots contain no unnamed buttons; collapsed rails open by keyboard and pointer; named task/schedule/GitHub row actions appear on focus and touch; prevention tests reject regressions. |
| D3 | Every enumerated `.16` action handles rejected and 4xx/5xx outcomes and exposes pending, failure, retry, and success behavior with stale-response protection. |
| D4 | Accessibility-tree and interaction tests cover tree and repository composites, typeahead, focus repair, context/rename/create/drag behavior, and prove there are no nested interactive controls. |
| D5 | macOS and Windows/Linux labels, handlers, and accessibility metadata agree for every registered shortcut. |
| D6 | Login, channel/session/recording embeds, CodeMirror source/rendered modes, and main shell agree in light, dark, system, and runtime preference changes without content, selection, history, or scroll loss. |
| D7 | Two isolated Remote Dev instances under one OS user cannot classify or terminate each other's tmux sessions; unknown legacy sessions are fail-safe. |
| D8 | All controls across 15 Settings sections are named and keyboard-operable and active navigation is exposed; rapid deep links update an existing tab without stale rollback; independent pending saves survive every exit path; generated-key success has Copy/Done and repeated submission creates exactly one record while later edits PATCH it. |

## 13. Bead-to-test traceability

Every source Bead acceptance criterion remains normative. The implementation plans
may add proof, but they cannot replace these minimum cases with only the group
summary.

| Bead | Design section | Minimum focused proof |
|---|---|---|
| `.6` | 4 | Fresh/corrupt/complete config; five steps; complete and Skip defaults; second-launch bypass; reopen; both ports, working directory, auto-start, updater, and WSL application through injected runtime consumers. |
| `.7` | 3.4 | Every step at 800x600, 1024x600, 1024x768, 1440x900, 390x667, and 390x844; one dialog/sheet layer; internal scroll; header/actions; validation; focus trap; Escape/Back; focus return. |
| `.9` | 5.1 | Header, desktop/mobile rails, project/session tree, tasks/Beads/schedules, channels, notifications, GitHub, Files, browser/editor/recording, and Electron controls; state descriptions; full-page AX snapshots; prevention helper/lint. |
| `.10` | 6 | Multi-level groups/projects/sessions and repositories; one Tab in/out; arrows/Home/End/Enter/Space/typeahead; expansion/selection; no nested controls; context, rename/create, drag/drop, active and collapsed focus repair; mobile unchanged. |
| `.11` | 7 | macOS and Windows/Linux formatting/handlers for palette, help, inline hints, editor Save, and session brackets; `aria-keyshortcuts`; injected platform adapter. |
| `.12` | 8 | Login, OIDC, error/banner, channel list/view/thread, and embed empty/loading/failure in light/dark/system before paint; `/m/session` and `/m/recording` continuity; no auth 401 theme dependency or avoidable jump. |
| `.13` | 8 | Light/dark editor surface, gutters, selection, cursor, syntax, source/Markdown, and live System change with content/history/cursor/selection/scroll retained. |
| `.14` | 5.2 | Real unstubbed Files and MCP zero/nonzero states; click/Enter/Space; named expanded state; parity with adjacent rails. |
| `.15` | 5.3 | Task delete/subtask removal/issue-to-task, schedule run/delete, and PR worktree actions by keyboard/touch; visibility before focus; order; disabled/loading; destructive confirmation. |
| `.16` | 9 | Worktree delete, recording save, Run now, browser navigation/frame, agent restart, worktree creation, and Trigger load/toggle/delete; rejected promise and 4xx/5xx for each; retained context and retry; rejected delete retains row. |
| `.17` | 11 | Two databases under one user; identity relocation and concurrent copied-ID lock; shared legacy socket list/single/bulk fail-closed; scoped creation boundaries; restart; foreign/unowned rejection; exact list-to-resume/create-to-delete CAS race. |
| `.18` | 3.2, 3.3 | Start with saved 220/320 sidebars at 800x600, 1024x768, 1440x900; all nav/control bounds; no clipped/document overflow; exact restore; Profiles, Secrets, Logs, Terminal, Instances, System and worst-case strings. |
| `.19` | 3.1, 3.3 | Electron 800x600 at 100/125/150/200%; desktop selector, terminal/session/Settings identity, Reset Zoom; ordinary mobile browser still selects MobileApp; existing resize boundary converges. |
| `.20` | 10.3 | Computed names for every input/combobox/slider/switch across all 15 sections; active nav state; Project and Secrets cards by Tab/Enter/Space with selected state; no overlap with icon-button naming. |
| `.22` | 4 | Initial failure/retry success, occupied port, missing executable, child exit, timeout, stop/restart, tray failures, conflicting-action disable, persistent listener cleanup, close/reopen, repeated status events, one URL load per Ready. |
| `.23` | 10.1 | Existing singleton tab Terminal -> SSH -> Logs last-write-wins; user nav beats stale responses; persistence failure; invalid fallback; visible section and persisted metadata agree. |
| `.24` | 10.2 | Slider then section/Escape/X/session switch persists; xterm scrollback and tmux history within 500 ms both persist; repeated motion coalesces per key; failure Retry/Revert; fake timers and API state after unmount. |
| `.25` | 10.4 | Generated/pasted/uploaded modes; generated flow sends one POST; double-click/rerender/after-response cannot recreate; Copy/Done; exactly one list row/key identity; subsequent edit PATCHes returned ID. |

## 14. Verification matrix

Desktop verification includes focused Vitest suites, TypeScript typecheck, ESLint
for changed files, Electron TypeScript build for Electron changes, and the root
production build for route/theme changes. Runtime checks use Chromium and an
Electron development build at the target sizes and zoom levels.

Accessibility verification inspects the browser accessibility tree and exercises
keyboard-only flows. Tmux verification uses two temporary, explicitly named data
directories and disposable test sessions; it never runs cleanup against the
user's default tmux server or live repository sessions.
