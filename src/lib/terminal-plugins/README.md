# Terminal Type Plugins

Plugin-based architecture for different terminal session types (shell, agent,
file viewer, browser, loop agent). Each terminal type describes:

- **Server lifecycle** — how sessions are created, what happens when the
  process exits, how to restart, how to validate input.
- **Client rendering** — which React component renders the session, which
  Lucide icon shows up in the sidebar and tabs, which exit screen to show.

## Server / client split (task A0)

The original `TerminalTypePlugin` interface (see `src/types/terminal-type.ts`)
mixed both halves in a single object. That meant any server code that
imported a plugin transitively pulled in Lucide icons and every plugin's
React modules — a problem once `session-service.ts` starts calling
`plugin.createSession()` for real.

The new layout splits the interface in two:

| Concern | Type | Registry | Init |
|---|---|---|---|
| Server lifecycle | `TerminalTypeServerPlugin` (`src/types/terminal-type-server.ts`) | `TerminalTypeServerRegistry` (`./server.ts`) | `initializeServerPlugins()` (`./init-server.ts`) |
| React rendering | `TerminalTypeClientPlugin` (`src/types/terminal-type-client.ts`) | `TerminalTypeClientRegistry` (`./client.ts`) | `initializeClientPlugins()` (`./init-client.ts`) |

Each built-in plugin now lives in two files, e.g.
`plugins/shell-plugin-server.ts` + `plugins/shell-plugin-client.tsx`. The old
combined files (`plugins/shell-plugin.tsx`, etc.) still exist as deprecated
shims that compose both halves into the legacy `TerminalTypePlugin` shape.

## Migration path (A0 → A2)

- **A0 (done — this task)** — Introduce the split interfaces, new
  registries, new initializers, split every built-in plugin. Keep the legacy
  registry and combined plugin objects working as a back-compat shim so no
  existing consumer breaks. Behavior is unchanged.

- **A1 (next)** — Start calling `TerminalTypeServerRegistry.get(type)` from
  `session-service.ts` and its use cases. `session-service.ts` must import
  only from `./server.ts` and `./init-server.ts`; the lint guard and a CI
  check will enforce that no React/Lucide modules end up in the server
  bundle.

- **A2 (final)** — Replace the hard-coded switch in
  `components/terminal/TerminalTypeRenderer.tsx` and `SessionManager.tsx`
  with `TerminalTypeClientRegistry.get(type).component`. At that point the
  legacy combined `TerminalTypePlugin`, `TerminalTypeRegistry`, and the
  `plugins/*-plugin.tsx` shim files can be deleted.

## Using the new registries

```ts
// Server-side (e.g. session-service.ts)
import { TerminalTypeServerRegistry } from "@/lib/terminal-plugins/server";
import { initializeServerPlugins } from "@/lib/terminal-plugins/init-server";

initializeServerPlugins();
const plugin = TerminalTypeServerRegistry.getRequired(session.terminalType);
const config = await plugin.createSession(input, partialSession);
```

```tsx
// Client-side (e.g. SessionManager.tsx, after A2)
import { TerminalTypeClientRegistry } from "@/lib/terminal-plugins/client";
import { initializeClientPlugins } from "@/lib/terminal-plugins/init-client";

initializeClientPlugins();
const plugin = TerminalTypeClientRegistry.getRequired(session.terminalType);
const Component = plugin.component;
return <Component session={session} {...terminalRenderProps} />;
```

## Adding a new terminal type

1. Create `plugins/<name>-plugin-server.ts` exporting a
   `TerminalTypeServerPlugin` object with `createSession` and any lifecycle
   hooks you need. No React/Lucide imports allowed here.
2. Create `plugins/<name>-plugin-client.tsx` exporting a
   `TerminalTypeClientPlugin` object with `component`, `icon`,
   `displayName`, and `description`.
3. Register both in `init-server.ts` / `init-client.ts`.
4. Optionally add a deprecated combined shim at `plugins/<name>-plugin.tsx`
   if you want the legacy registry to know about it too.

## Persistence and cleanup contract

Sessions are durable: they live as rows in `terminal_session` and are
reconstructed across reloads, tab-switches, and server restarts. Every
terminal type — even the purely-UI ones (`settings`, `profiles`, `issues`,
`prs`, `recordings`) — therefore follows the same rule: **persist across
reloads like other sessions, and define explicit cleanup hooks per type**.
This section documents where each lifecycle stage runs and what each
built-in plugin does in it.

### Lifecycle stages a plugin can hook

- **`validateInput(input)`** — server. First thing `createSession` runs;
  reject malformed input before any row is inserted. Return a string with
  the error message or `null` to proceed.
- **`createSession(input, partialSession)`** — server. Seeds the session's
  initial `SessionConfig` (shell command / environment / metadata). No I/O
  beyond what's strictly needed to compute the config. All persistent
  metadata MUST start life here, not later from the client — the server is
  the source of truth.
- **Component mount / unmount** — client. The plugin component owns the UI
  and any client-side cleanup (xterm dispose, WebSocket detach, editor
  flush, listener removal). `SessionManager` renders the plugin component
  as `<PluginComponent key={session.id} ... />` in both active and
  background panes, so the component **is remounted whenever the session
  id changes** — closing and reopening a session via the same tab slot, or
  switching to a different session — AND when the tab is torn down. This
  is the only hook UI-only types (`settings`, `profiles`, `issues`, `prs`,
  `recordings`) have for cleanup.
- **`onSessionExit(session, exitCode)`** — server. Fired by the terminal
  server when a PTY-backed session's main process exits. Drives the exit
  screen (`showExitScreen`, `canRestart`, `autoClose`, `exitMessage`).
  UI-only types should return a behavior with `showExitScreen: false` and
  are effectively never called in practice because they have no process.
- **`onSessionRestart(session)`** — server. Fired when the user clicks
  "Restart" on the exit screen. Return a fresh `SessionConfig` or `null`
  to refuse. Only meaningful for process-backed types (`shell`, `agent`,
  `loop`).
- **`onSessionClose(session)`** — server. Called once by
  `session-service.ts` when the session transitions to `closed` (either
  via `DELETE /api/sessions/:id` or an explicit close). Runs **after** the
  tmux kill (if the type uses tmux) and **before** the row is marked
  closed. Errors are caught and logged — they never block the close from
  completing. This is where process-/OS-backed types release resources
  (e.g. the browser plugin closes its Playwright context).

### Persistent-tab invariant

Sessions persist across reloads; tabs and panes are rehydrated from the DB
on mount. Any plugin UI state that must survive a reload MUST be written
through the session via

```ts
updateSession(session.id, { typeMetadataPatch: { ...fields } });
```

The PATCH `/api/sessions/:id` route only accepts `typeMetadataPatch`; if
you send a full `typeMetadata` blob it is silently dropped by the route
body schema. Each patch is shallow-merged on top of the existing stored
metadata, so keys not mentioned in the patch are preserved.

UI state that is purely transient (hover highlights, unsaved form fields,
scroll offsets, the currently-focused tab within a view) stays in React
state and is lost on the `key={session.id}` remount. That's intentional —
don't try to make it survive unless it's worth the round-trip.

### Per-built-in-plugin cleanup table

| Plugin | Mount/unmount cleanup | Server hooks implemented | Persistent metadata |
|---|---|---|---|
| `shell` | `Terminal.tsx` disposes xterm + webgl/image addons and tears down the WebSocket (via `TerminalWithKeyboard`) on unmount | `onSessionExit` (tmux kill triggers exit message) | none beyond shared session fields |
| `agent` | same as `shell` + `AgentExitScreen` state | `onSessionExit`, `onSessionRestart` | `AgentSessionMetadata` (`exitState`, `exitCode`, `exitedAt`, `restartCount`, `lastStartedAt`) |
| `loop` | `LoopChatPane` manages its own chat-stream subscription and xterm-drawer lifecycle | `onSessionExit`, `onSessionRestart` | `LoopAgentMetadata` (`agentProvider`, `loopConfig`, `currentIteration`, `terminalVisible`) |
| `file` | `CodeMirrorEditor` unmount flushes any unsaved buffer via `navigator.sendBeacon("/api/files/write", ...)` and clears its autosave timer | `onSessionExit` (autoClose), `onSessionClose` (log only) | `FileViewerMetadata` (`filePath`, `fileName`, `isAgentConfig`, `lastSavedAt`, `isDirty`) |
| `browser` | `BrowserPane` cleans up its screenshot blob URL; the Playwright context is server-side | `onSessionExit` (autoClose), `onSessionClose` closes the Playwright browser via `BrowserService.closeBrowserSession` | `BrowserSessionMetadata` (`currentUrl`, `viewportWidth`, `viewportHeight`, `lastScreenshotAt`) |
| `issues` | no dedicated dispose; issues data comes from `useRepositoryIssues` context which the plugin does not own | `onSessionExit` (autoClose), `onSessionClose` (log only) | `IssuesSessionMetadata` (`repositoryId`, `repositoryName`, `repositoryUrl`, `selectedIssueNumber`) |
| `prs` | no dedicated dispose; PR data comes from `useGitHubStats` plus per-PR fetches | `onSessionExit` (autoClose), `onSessionClose` (log only) | `PRsSessionMetadata` (`repositoryId`, `repositoryName`, `repositoryUrl`, `selectedPrNumber`) |
| `recordings` | `RecordingPlayer` disposes its own xterm in its cleanup; switching `selectedRecordingId` remounts the player (via its `key=`) so the previous xterm is disposed and a fresh one is created | `onSessionExit` (keep view alive, no screen), `onSessionClose` (log only) | `RecordingsSessionMetadata` (`selectedRecordingId`) |
| `profiles` | form inputs only — no xterm, no CodeMirror, no long-lived resource; remount discards local React state | `onSessionExit` (autoClose), `onSessionClose` (log only) | `ProfilesSessionMetadata` (`activeProfileId`, `activeTab`) |
| `settings` | no dedicated dispose; `SettingsView` owns its own scroll regions and keyboard handler | `onSessionExit` (autoClose), `onSessionClose` (log only) | `SettingsSessionMetadata` (`activeTab`) |

Notes on the table above:

- `shell`, `agent`, and `loop` do NOT implement `onSessionClose`. Their
  cleanup is the tmux kill that `session-service.ts` performs before
  invoking the plugin hook — there's nothing for the plugin to add.
- For `file`, `browser`, `issues`, `prs`, `recordings`, `profiles`, and
  `settings`, `onSessionClose` is implemented but most of them only log.
  Only `browser` releases external resources (Playwright).
- The `agent` plugin does NOT clear or reset its restart counters on
  close. The counters live on the row and go away when the row's status
  flips to `closed`; no explicit scrub is needed.

### Rules for future plugins

- Put xterm, CodeMirror, WebSockets, and any other long-lived resource
  behind a component that disposes it in a `useEffect` cleanup. Don't
  hold these handles on the plugin object — the plugin is a singleton,
  but its component is mounted and unmounted per session.
- Assume your component WILL be unmounted and remounted when
  `session.id` changes (closing + reopening a tab in the same slot, for
  example). Don't rely on singleton lifetime inside the component.
- Every write to `typeMetadata` goes through
  `updateSession(id, { typeMetadataPatch: { ... } })`. Never send a full
  `typeMetadata` blob from the client — the PATCH route only reads the
  `typeMetadataPatch` field and silently drops everything else.
- If your server half opens OS resources (files, sockets, subprocesses,
  Playwright contexts), implement `onSessionClose` and release them
  there. Wrap the release in `try/catch` and log via
  `createLogger("YourNs")` — throwing will NOT abort the close (the
  service catches it), but it does surface as an error log and can
  leave resources stranded.
- Pure-UI plugins (no tmux, no process) should still return a sensible
  `ExitBehavior` from `onSessionExit` even though it's effectively
  unreachable — future tooling may simulate exits (e.g. for testing).
  `autoClose: true` with `showExitScreen: false` is the conventional
  default for these.

### Known limitations / follow-ups

- `updateSession(id, { typeMetadataPatch: ... })` is fire-and-forget from
  the client. Rapid consecutive calls (e.g. spamming nav buttons in the
  issues or profiles view) can race on the server — last-write-wins, but
  without ordering guarantees between two in-flight PATCHes. Defer to
  later hardening.
- None of the current built-ins debounce-persist in-progress editor
  state (e.g. a partially-composed comment in a PR or issue view).
  Plugins that add such affordances should debounce a
  `typeMetadataPatch` every few seconds so a mid-edit crash recovers.
- The `key={session.id}` remount in `SessionManager` is load-bearing for
  the persistence contract. Removing it — e.g. to optimise tab switches —
  would require plugin components to handle prop-driven session changes
  internally, which none of the built-ins currently do.
