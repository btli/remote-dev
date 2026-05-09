# Flutter App — Phase 2: Native Session-View Chrome + Sessions Tab

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development`. All implementation in worktrees branched off `feat/mobile-phase-2`. Steps use checkbox (`- [ ]`) syntax.

**Goal:** The biggest phase — replace the Phase 1.5 spike screen with a production session view. Native bottom tab bar, native Sessions list + sheets, and native chrome (status bar + smart keys + input bar + pinch zoom) layered around the embedded WebView terminal. All wired to `BridgeController` from P1.5.

**Architecture:** Native widgets own the surfaces around the terminal. The terminal canvas itself stays in the WebView (`/m/session/<id>` from Phase 0). Pattern from spec §2.1:

```
┌─────────────────────────────────────────────────┐
│ Native: SessionStatusBar (project · session)    │
├─────────────────────────────────────────────────┤
│                                                 │
│  WebView: terminal canvas only (xterm.js)       │
│   - listens for input via BridgeController      │
│   - native pinch-zoom wraps it                  │
│                                                 │
├─────────────────────────────────────────────────┤
│ Native: SmartKeyStrip                           │
│  Tab · Esc · Ctrl* · Alt* · ↑↓←→ · Pg · Home/End│
├─────────────────────────────────────────────────┤
│ Native: MobileInputBar                          │
│  real OS textarea → autocorrect/dictation/etc.  │
└─────────────────────────────────────────────────┘
```

**Tech Stack:** Flutter widgets (Cupertino + Material), Riverpod, the existing `BridgeController` from P1.5.2, the existing `RemoteDevClient` from P1.6, the `flutter_inappwebview` host from P1.4.

**Spec:** `docs/superpowers/specs/2026-05-08-flutter-app-redesign-design.md` §2.1 (surface split), §4 (bridge contract + keyboard layout), §12.5 (error surface).

**Out of scope (deferred):** push (Phase 3), notifications/channels/profile/deep-links (Phase 4), biometric/multi-server polish/recording/store metadata (Phase 5).

---

## Worktree strategy

Single feature branch `feat/mobile-phase-2` off `master`. Subagents work in parallel sub-worktrees and merge back to `feat/mobile-phase-2` between waves.

- **Wave 1 (sequential):** P2.1 bottom tab bar — foundational; provides the navigation skeleton.
- **Wave 2 (4 in parallel):** P2.2 Sessions list || P2.5 SessionStatusBar || P2.6 SmartKeyStrip || P2.7 MobileInputBar. Independent files.
- **Wave 3 (4 in parallel):** P2.3 Project tree sheet || P2.4 New-session sheet || P2.8 Pinch-zoom || P2.10 Error surface.
- **Wave 4 (sequential):** P2.9 Wire native chrome ↔ rdv-bridge end-to-end. Replaces the Phase 1.5 spike with a production session screen.

---

## File structure (after all 10 tasks land)

```
mobile/lib/
├── presentation/
│   ├── screens/
│   │   ├── shell/
│   │   │   └── home_shell.dart          # P2.1 — Material/Cupertino tab scaffold
│   │   ├── sessions/
│   │   │   ├── sessions_tab_screen.dart # P2.2
│   │   │   ├── new_session_sheet.dart   # P2.4
│   │   │   └── project_tree_sheet.dart  # P2.3
│   │   ├── session_view/
│   │   │   ├── session_view_screen.dart # P2.9 — replaces bridge_spike
│   │   │   ├── session_status_bar.dart  # P2.5
│   │   │   ├── smart_key_strip.dart     # P2.6
│   │   │   ├── mobile_input_bar.dart    # P2.7
│   │   │   ├── pinch_zoom_wrapper.dart  # P2.8
│   │   │   └── modifier_latch.dart      # P2.6 helper
│   │   └── error/
│   │       ├── server_unreachable_screen.dart  # P2.10
│   │       ├── reconnecting_banner.dart         # P2.10
│   │       └── version_mismatch_screen.dart     # P2.10
│   └── router/
│       └── app_router.dart              # modified across many tasks
└── infrastructure/
    └── webview/
        └── bridge_controller.dart       # extended in P2.9 (key, paste, scrollToBottom, etc)
```

---

## Architectural rules (every subagent respects)

1. **`addJavaScriptHandler` registrations in `onWebViewCreated` only.** P2.9 wires the full handler set; others don't touch handlers.
2. **All native→WebView calls go through `BridgeController`.** No direct `controller.evaluateJavascript` outside the bridge.
3. **Keyboard layout pattern (spec §4):** `Scaffold(resizeToAvoidBottomInset: false)` + manual `viewInsetsOf` math + `Stack + Positioned(bottom: keyboardInset)` for the input bar. WebView height fixed.
4. **No `print`; `debugPrint` in `presentation/`. Single quotes.**
5. **Native widgets are theme-aware** (`Theme.of(context)`) but default to the Tokyo Night palette.

---

## Task 1 (P2.1): Bottom tab bar

**Worktree:** `../remote-dev-flutter-p2-tabbar` on `feat/mobile-phase-2-tabbar`
**Files:**
- Create: `mobile/lib/presentation/screens/shell/home_shell.dart`
- Modify: `mobile/lib/presentation/router/app_route.dart` — `home` + `sessionsTab` etc.
- Modify: `mobile/lib/presentation/router/app_router.dart` — `ShellRoute` for tabs
- Create: `mobile/test/presentation/screens/shell/home_shell_test.dart`

### Goals

- Adaptive bottom tab bar: `CupertinoTabBar` on iOS, `NavigationBar` on Android. Use Flutter's `Theme.of(context).platform` switch.
- 4 tabs: Sessions, Channels, Notifications, Profile. Phase 2 only wires Sessions to a real screen (others can render a placeholder "Coming in Phase 4" Scaffold).
- Tab persistence: switching tabs preserves each tab's nav state (use `IndexedStack` for content; only Sessions tab actively maintains its routes).
- Badge support on Channels/Notifications tabs (Phase 4 wires real counts).
- System haptic on tap (`HapticFeedback.selectionClick()`).
- Sheet-style background blur on iOS — use `SystemUiOverlayStyle.light` for the status bar contrast.

### Step outline

1. Define `HomeShell` `ConsumerStatefulWidget` that manages `_activeTab` state.
2. Render an `AdaptiveBottomBar` widget that switches on `Theme.of(context).platform`.
3. Body uses `IndexedStack` over the 4 tab screens.
4. Sessions tab body: `SessionsTabScreen` (P2.2 fills it; for now, `Scaffold(body: Center(child: Text('Sessions — P2.2 wires this')))` is fine).
5. Other tabs: simple `Scaffold(body: Center(child: Text('Coming in Phase 4')))`.
6. Add the route: `/home` → `HomeShell`. Make `/home` the **new initial location** in `AppRouter._buildRouter`. Update `ServerPickerScreen.onSelect` (in router wiring) to navigate to `/home` after setActive.
7. Widget test: pumps `HomeShell`, verifies 4 tab labels + tap on each switches the IndexedStack child.

### Tests

5 widget tests:
- Renders 4 tabs with the right labels
- Initial tab is Sessions
- Tapping Channels switches the indexed body
- Tapping Notifications + Profile likewise
- Haptic feedback fires on tap (use `HapticFeedback.platform` mock or just verify the call doesn't throw)

### Commit

```
feat(mobile/shell): adaptive bottom tab bar (Sessions/Channels/Notifications/Profile)

- HomeShell with IndexedStack body + AdaptiveBottomBar
- CupertinoTabBar on iOS, NavigationBar on Android
- Haptic feedback on tab tap
- /home route + initial location
- Phase 4 fills the non-Sessions tabs

Plan: docs/superpowers/plans/2026-05-08-flutter-app-phase-2-session-view.md Task 1
Co-authored-by: Isaac
```

---

## Task 2 (P2.2): Sessions tab list

**Worktree:** `../remote-dev-flutter-p2-sessions` on `feat/mobile-phase-2-sessions`
**Files:**
- Create: `mobile/lib/presentation/screens/sessions/sessions_tab_screen.dart`
- Create: `mobile/lib/domain/session_summary.dart` (freezed model from `/api/sessions` response)
- Create: `mobile/lib/application/ports/sessions_port.dart`
- Create: `mobile/lib/infrastructure/api/sessions_api.dart`
- Modify: `mobile/lib/infrastructure/api/remote_dev_client.dart` — add `listSessions()`
- Tests for API + screen

### Goals

- Pulls `GET /api/sessions` via `RemoteDevClient`. Renders rows: name + project label + activity-status pip.
- Activity pip: 6 states (running / waiting / idle / error / disconnected / reconnecting). Use a small colored dot + optional label. State derives from session row's `agentActivityStatus` field (server already returns it).
- Pull-to-refresh.
- Native swipe actions per row: **Suspend** (orange) and **Close** (red). Use `Dismissible` with custom backgrounds + confirm dialog before close.
- Tap row → push `/home/session/<id>` (route added by P2.9).
- Empty state: "No sessions yet" + "New session" button (opens P2.4's sheet).
- AppBar action: + icon → opens P2.4's `NewSessionSheet`.

### Tests

- Renders empty state when API returns `[]`.
- Renders rows when API returns 2 sessions.
- Tap → router push.
- Swipe Suspend calls `POST /api/sessions/:id/suspend`.
- Swipe Close shows confirm; on confirm, calls `DELETE /api/sessions/:id`.

### Commit

```
feat(mobile/sessions): native sessions list with swipe actions + status pips

- SessionsTabScreen pulls /api/sessions via RemoteDevClient
- Activity pip (running/waiting/idle/error/disconnected/reconnecting)
- Native swipe-to-suspend / swipe-to-close (with confirm dialog)
- Pull-to-refresh; empty state with "New session" CTA
- AppBar + action opens NewSessionSheet (Phase 2 P2.4 wires)

Plan: docs/superpowers/plans/2026-05-08-flutter-app-phase-2-session-view.md Task 2
Co-authored-by: Isaac
```

---

## Task 3 (P2.3): Project tree sheet

**Worktree:** `../remote-dev-flutter-p2-projecttree` on `feat/mobile-phase-2-projecttree`
**Files:**
- Create: `mobile/lib/presentation/screens/sessions/project_tree_sheet.dart`
- Create: `mobile/lib/domain/group.dart` (freezed)
- Create: `mobile/lib/domain/project.dart` (freezed)
- Create: `mobile/lib/application/ports/project_tree_port.dart`
- Create: `mobile/lib/infrastructure/api/project_tree_api.dart`
- Tests

### Goals

- Modal bottom sheet (`showModalBottomSheet`).
- Pulls `/api/groups` and `/api/projects` and renders a tree (groups expandable, projects as leaves).
- Tap a project → returns its id via `Navigator.pop(context, projectId)`.
- Loading + empty states.

### Tests

- Renders nested tree from a 2-group / 4-project fixture.
- Tap project pops with the right id.

### Commit

```
feat(mobile/sessions): project tree sheet (group + project picker)
...
```

---

## Task 4 (P2.4): New-session sheet

**Worktree:** `../remote-dev-flutter-p2-newsession` on `feat/mobile-phase-2-newsession`
**Files:**
- Create: `mobile/lib/presentation/screens/sessions/new_session_sheet.dart`
- Modify: `mobile/lib/infrastructure/api/sessions_api.dart` — add `createSession(...)`
- Tests

### Goals

- Modal bottom sheet form: name, project (uses P2.3's `ProjectTreeSheet`), terminal type, initial command.
- POSTs to `/api/sessions`, on success returns the new session id; navigates to `/home/session/<id>`.
- Form validation; loading state on submit.

### Commit

```
feat(mobile/sessions): native new-session sheet with form + project picker
...
```

---

## Task 5 (P2.5): SessionStatusBar

**Worktree:** `../remote-dev-flutter-p2-statusbar` on `feat/mobile-phase-2-statusbar`
**Files:**
- Create: `mobile/lib/presentation/screens/session_view/session_status_bar.dart`
- Tests

### Goals

- Top bar above the WebView. Renders: project name · session name · activity pip.
- Stateless widget receives `projectName`, `sessionName`, `activity` enum as props.
- Tappable → opens session metadata sheet (Phase 2 stub: `Scaffold` placeholder; full content in Phase 5).
- Height ~44pt; matches Tokyo Night.

### Tests

- Renders all three labels + the right pip color per state.
- Tap fires `onTap`.

### Commit

```
feat(mobile/session-view): SessionStatusBar (project · session · activity pip)
...
```

---

## Task 6 (P2.6): SmartKeyStrip + modifier latch

**Worktree:** `../remote-dev-flutter-p2-smartkeys` on `feat/mobile-phase-2-smartkeys`
**Files:**
- Create: `mobile/lib/presentation/screens/session_view/smart_key_strip.dart`
- Create: `mobile/lib/presentation/screens/session_view/modifier_latch.dart`
- Tests for the latch + the strip

### Goals

- Horizontal scrollable row above the keyboard with these keys, in order: Esc, Tab, Ctrl*, Alt*, Shift*, Up, Down, Left, Right, PgUp, PgDn, Home, End.
- Asterisked (`Ctrl`, `Alt`, `Shift`) are **latching modifiers** with 3 states: off / single (consumed by next key, then reset) / locked (sticks until tapped again).
- `ModifierLatch` is a small state machine that the strip uses; see PWA's `useModifierLatch` for the behavior reference.
- Each key tap calls `onKeyPress(name, mods)` callback; the parent (P2.9) routes to `BridgeController.key(name, mods)`.
- Native haptic feedback on tap.

### Tests for `ModifierLatch`

- Initial state: all off.
- Tap Ctrl once → single. Tap a non-modifier → consumed → Ctrl off.
- Tap Ctrl twice → locked. Tap a non-modifier → still locked (does NOT consume).
- Tap a locked modifier → off.

### Tests for `SmartKeyStrip`

- Renders all 13 keys.
- Tap Tab → `onKeyPress('Tab', {})`.
- Tap Ctrl → tap `c` → `onKeyPress('c', {ctrl: true})` then Ctrl resets.
- Tap Ctrl twice → locked → tap `c` → `onKeyPress('c', {ctrl: true})`, Ctrl still locked.

### Commit

```
feat(mobile/session-view): SmartKeyStrip with modifier latch (off/single/locked)
...
```

---

## Task 7 (P2.7): Native MobileInputBar

**Worktree:** `../remote-dev-flutter-p2-inputbar` on `feat/mobile-phase-2-inputbar`
**Files:**
- Create: `mobile/lib/presentation/screens/session_view/mobile_input_bar.dart`
- Tests

### Goals (the user's headline ask)

- Native `TextField` with autocorrect, dictation, predictive text — full OS keyboard behavior.
- On submit (Enter / send button), fires `onSend(text)` callback; clears the field.
- Long-press → "paste without execute": pastes clipboard text into the field but does NOT submit.
- Light "send" icon button on the right.
- Send button disabled until text is non-empty.
- Multi-line support (auto-grows up to 4 lines, then scrolls inside the field).

### Tests

- Renders TextField + send button.
- Submit triggers onSend with the field text.
- Send button disabled when field empty.
- Long-press → calls onLongPressPaste callback (paste-without-execute hook for the parent).

### Commit

```
feat(mobile/session-view): MobileInputBar — native TextField with autocorrect/dictation
...
```

---

## Task 8 (P2.8): Pinch-zoom gesture wrapper

**Worktree:** `../remote-dev-flutter-p2-pinch` on `feat/mobile-phase-2-pinch`
**Files:**
- Create: `mobile/lib/presentation/screens/session_view/pinch_zoom_wrapper.dart`
- Tests

### Goals

- `PinchZoomWrapper` widget wraps the WebView and detects 2-finger pinch via `GestureDetector` (`onScaleUpdate`).
- Maps pinch scale → font-size delta (e.g., scale 1.2 → +1px, scale 0.8 → -1px). Clamp to 9–22px.
- Calls `onFontSizeChanged(int newPx)` callback. Persists via `shared_preferences` keyed by sessionId.
- Light-touch: don't double-handle the WebView's own touch events; use `behavior: HitTestBehavior.translucent`.

### Tests

- Pinch-out from scale 1.0 → 1.2 produces a callback with `+1`.
- Pinch-in from 1.0 → 0.8 produces `-1`.
- Bounds at 9 and 22.

### Commit

```
feat(mobile/session-view): PinchZoomWrapper for terminal font sizing
...
```

---

## Task 9 (P2.9): Wire native chrome ↔ rdv-bridge

**Worktree:** `../remote-dev-flutter-p2-wire` on `feat/mobile-phase-2-wire` (after Wave 3 lands)
**Files:**
- Create: `mobile/lib/presentation/screens/session_view/session_view_screen.dart` (replaces `bridge_spike_screen.dart`'s production role; spike screen stays for testing)
- Modify: `mobile/lib/infrastructure/webview/bridge_controller.dart` — add `paste()`, `setFontSize()`, `markUnready()` if not already
- Modify: `mobile/lib/presentation/router/app_router.dart` — `/home/session/:id` → `SessionViewScreen`
- Tests

### Goals

- `SessionViewScreen` is the production composition: `SessionStatusBar` + `PinchZoomWrapper(WebView)` + `SmartKeyStrip` + `MobileInputBar`, all wired via `BridgeController`.
- Bridge handlers registered in `onWebViewCreated`:
  - `onTerminalReady` → `bridge.markReady()` + clear splash
  - `onSelectionChange` → native action sheet with Copy
  - `onWantsPaste` → reads native clipboard, calls `bridge.paste(text)`
  - `onActivity` → updates the local activity state in StatusBar
  - `onLinkOpen` → opens external URL via `url_launcher` or `flutter_inappwebview` Chrome Custom Tabs
- `SmartKeyStrip.onKeyPress` → `bridge.key(name, mods)`
- `MobileInputBar.onSend` → `bridge.input(text)` then optional newline (`bridge.input("\r")`)
- `MobileInputBar.onLongPressPaste` → reads clipboard → `bridge.paste(text)` (paste WITHOUT executing)
- `PinchZoomWrapper.onFontSizeChanged` → `bridge.setFontSize(px)`

### Tests

- The screen mounts the 4 components.
- Sending input via the input bar fires `bridge.input` (via mocked controller).
- Smart key tap fires `bridge.key` with the right name + mods.

### Commit

```
feat(mobile/session-view): production session view wired to rdv-bridge

- SessionViewScreen: StatusBar + WebView + SmartKeys + InputBar
- BridgeController extended with paste, setFontSize
- All 5 outbound bridge events wired (onTerminalReady/onSelectionChange/
  onWantsPaste/onActivity/onLinkOpen)
- /home/session/:id router maps here

Plan: docs/superpowers/plans/2026-05-08-flutter-app-phase-2-session-view.md Task 9
Co-authored-by: Isaac
```

---

## Task 10 (P2.10): Error surface

**Worktree:** `../remote-dev-flutter-p2-errors` on `feat/mobile-phase-2-errors`
**Files:**
- Create: `mobile/lib/presentation/screens/error/server_unreachable_screen.dart`
- Create: `mobile/lib/presentation/screens/error/reconnecting_banner.dart`
- Create: `mobile/lib/presentation/screens/error/version_mismatch_screen.dart`
- Modify: `mobile/lib/presentation/router/app_router.dart` — routes for each
- Tests

### Goals (spec §12.5)

- **Server unreachable:** full-screen Tokyo Night error with retry + "Switch server" CTA.
- **Reconnecting banner:** Material `MaterialBanner` slid in over the smart-key strip via the `connectivity_plus` stream.
- **Bridge version mismatch:** full-screen "Update Remote Dev" with "Open store" CTA (placeholder URL for v1; Phase 5 wires the real store deep link).

### Tests

- Each screen renders + CTAs fire callbacks.

### Commit

```
feat(mobile/error): native error surface (server unreachable / reconnecting / version mismatch)
...
```

---

## Phase 2 ship gate

After all 10 tasks land on `feat/mobile-phase-2`:

- [ ] `cd mobile && flutter analyze` — 0 issues
- [ ] `cd mobile && flutter test` — all tests pass (target: 60+ unit/widget tests after this phase)
- [ ] `cd mobile && flutter build apk --debug` — produces a debug APK
- [ ] (Manual, post-merge) Install APK on a physical device. Verify:
  - Server picker → tap server → lands on Sessions tab (not bridge spike)
  - Sessions list renders (empty or populated depending on server)
  - Tap a session → SessionViewScreen renders with status bar + WebView + smart keys + input bar
  - Type into the input bar → text appears in the WebView terminal
  - Tap a smart key → its sequence is sent
  - Pinch the WebView → font size changes
- [ ] Open PR `feat/mobile-phase-2 → master`, title `feat(mobile): Phase 2 — native session-view chrome + Sessions tab`.

## Out of scope — deferred

- Push notifications (Phase 3)
- Notifications/Channels/Profile tab implementations (Phase 4)
- Universal Links / App Links + deep-link routing (Phase 4)
- Biometric lock + multi-server polish + recording playback + iOS CI (Phase 5)
