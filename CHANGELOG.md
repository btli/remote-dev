# Changelog

All notable changes to Remote Dev will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Chat channels and groups: Slack/Discord-style channel organization for peer chat
- Channel groups: "Channels" (default) and "Direct Messages" organizational containers
- Default `#general` channel auto-created per project folder
- Users and agents can create new channels via UI, rdv CLI, and MCP tools
- Slack-style thread support: inline reply counts, slide-in thread panel
- Full GFM markdown rendering in chat messages (headers, code blocks, links, tables)
- Channel sidebar replaces task sidebar when chat view is active
- DB-backed per-user unread tracking with `channel_read_state` table
- New rdv CLI commands: `rdv channel list`, `rdv channel create`, `rdv channel send`, `rdv channel messages`
- New MCP tools: `list_channels`, `create_channel`, `send_to_channel`, `read_channel`
- Permanent message persistence (removed 24h TTL)
- Channel migration script: `bun run db:migrate-channels`
- **RDV skill documentation**: Comprehensive rewrite of `skills/rdv/SKILL.md` covering all CLI commands — teams orchestration, terminal I/O (`send`, `screen`), session UI (`set-status`, `set-progress`, `log`), system management, and tmux compatibility layer. Organized into 13 categories with practical workflow examples.
- **Auto-inject RDV context into agent profiles**: All agent config files (CLAUDE.md, AGENTS.md, GEMINI.md, OPENCODE.md) now include an RDV quick-reference section with environment variables, a 16-command reference table, and a pointer to `rdv --help`. Agents spawned by Remote Dev immediately know about rdv capabilities without manual setup or plugin installation.
- **Intelligent agent session titles**: Agent sessions are now auto-titled with a 2-3 word summary derived from the first user message in the Claude Code `.jsonl` session file. Titles are applied once via `rdv` hooks and broadcast to all connected clients in real-time. Manual rename locks the title. The stable Claude session UUID is stored in `typeMetadata` and surfaced in peer discovery for richer agent-to-agent context.
- **Agent peer communication**: Folder-scoped inter-agent messaging via MCP server (`rdv-peers`). Agents in the same project folder can discover each other (`list_peers`), exchange messages (`send_message`/`check_messages`), and share work summaries (`set_summary`). Auto-registered in each agent's settings.json at session creation. Messages delivered via PreToolUse hook. Also available via `rdv peer` CLI for non-MCP agents.
- **Peer chat room UI**: Visual chat room interface for viewing and participating in inter-agent communication. Features a `FolderTabBar` with Terminal/Chat Room toggle and per-agent session tabs with activity status dots (running/waiting/compacting/error/idle). User can broadcast messages to all agents. Real-time message delivery via WebSocket with optimistic updates. Unread badge on Chat Room tab. Auto-scrolling message list with scroll-to-bottom button.
- **SessionEnd hook**: Agent sessions now install a `SessionEnd` hook that reports "ended" status when the session closes, enabling learning analysis triggers
- **Mobile toolbar backspace button**: ⌫ (DEL) button in both Keys and Nav toolbar modes for deleting characters in the terminal. Supports ALT+⌫ for delete-word.
- **Mobile type/send mode toggle**: Long-press the send button to switch between Send mode (text + `\r`) and Type mode (text only, no `\r`). Enables building up terminal input piece by piece before executing.
- **Auto-refresh expired CF tokens**: When the Cloudflare Access token expires, the mobile app automatically opens the browser for re-authentication and retries the failed request, instead of silently showing empty sessions.
- **Mobile scroll-to-bottom button**: Floating "Latest" pill button appears when the terminal is scrolled up into history on mobile. Tapping it scrolls back to the latest output.
- **`rdv session title` command**: Agents can set meaningful kebab-case session titles (3-5 words) for peer identification via `rdv session title <kebab-title>`
- **Auto-broadcast on git push**: Pushing to main/master automatically broadcasts a rebase alert to the peer chatroom so other agents know to pull latest changes
- **Auto-broadcast on session lifecycle**: Session start and stop events are automatically broadcast to the peer chatroom for situational awareness
- **Session title history**: Title changes are tracked in `typeMetadata` for context when titles are updated

### Changed

- **MCP server renamed from `rdv-peers` to `rdv` (v2.0.0)**: Slimmed tool set from 8 to 3 response-only tools (`send_message`, `send_to_channel`, `set_summary`). Read operations moved to rdv CLI. Stale `rdv-peers` entries auto-cleaned from settings.json and .mcp.json.
- **Real-time MCP push notifications**: Agents receive peer messages, channel messages, and @mentions instantly via Unix socket push from the terminal server, relayed through `sendLoggingMessage()`. PreToolUse hook remains as reliable fallback with dedup via sentinel file.
- Peer messages now scoped to channels (existing messages migrated to #general)
- Right sidebar dynamically swaps between task tracker and channel list based on active view
- Agent session auto-titles now use kebab-case format (e.g., "fix-login-bug" instead of "fix login bug")
- Auto-title stop-word stripping produces more meaningful titles (e.g., "fix-login-bug" instead of "fix-the-login")
- PreToolUse hook now shows full peer status digest (agent names, activity status, work summaries) alongside new messages
- Stop hook now clears peer summary and broadcasts "finished work" to peer chatroom

### Fixed

- **Mobile terminal scrollback**: Fixed touch scrollback by using `terminal.scrollLines()` API instead of direct `scrollTop` manipulation, which xterm.js v6's internal VS Code ScrollableElement silently overwrites. Added pixel-to-line delta accumulation, `touchcancel` handling, and improved momentum physics.
- **Mobile terminal CSS touch handling**: Added `touch-action: none` and `overscroll-behavior: contain` to xterm viewport and container to prevent browser interference (pull-to-refresh, rubber-band bounce) with terminal scrolling
- **Multi-client session support**: Web and mobile can now connect to the same terminal session simultaneously without triggering a reconnection loop. Each client gets its own PTY attached to the same tmux session. Newest connection controls terminal resize.
- **Stop hook silent failure on DB error**: `/internal/agent-stop-check` now returns a descriptive error message when the task database is unavailable, instead of silently allowing the agent to stop without checking tasks
- **Internal endpoint security**: Consolidated all `/internal/*` endpoint localhost restrictions into a single guard, covering previously unprotected `/agent-status`, `/agent-exit`, and `/notify` endpoints
- **Stop hook retry on network failure**: `rdv hook stop` now retries the task check once after 500ms on connection-level errors (refused, reset, timeout) before falling back to the error message
- **Hook validation visibility**: When agent hook validation fails and auto-repair also fails, a user-visible notification is now created instead of only logging server-side
- **Hook marker matching specificity**: Hook deduplication now inspects only the `command` field of hook entries, preventing false matches on user hooks that contain marker substrings in descriptions
- **stableId hash collisions**: Replaced 32-bit djb2 hash with dual-pass FNV-1a/Murmur (~52-bit) for task dedup keys, reducing collision risk for similar task subjects
- **Plugin hook naming**: Renamed misleading `session-start` PreToolUse hook command to `active` (same handler, clearer intent)
- **App-level error and 404 pages**: Added `error.tsx` and `not-found.tsx` with Tokyo Night glassmorphism styling, replacing raw Next.js error pages
- **Login page metadata**: Added page title and description via login layout for SEO and browser tab clarity
- **Stale APK download URL**: Changed hardcoded v0.3.0 APK link to version-independent releases page
- **Login error accessibility**: Added `role="alert"` to login error message for screen reader announcement
- **Server-side logger compliance**: Replaced `console.error/warn` with structured logger in `preferences.ts` and `environment.ts`
- **Port registry uniqueness**: Added unique index on `(userId, port, variableName)` to prevent duplicate port registrations
- **Tmux session name validation**: Tightened terminal server validation from permissive alphanumeric pattern to strict `rdv-{uuid}` format matching the domain layer
- **Schedule state sync after execution**: Schedules no longer show "Overdue" after firing — `executeNow()` now refreshes client state immediately
- **Auth timeout detection**: Expired sessions redirect to login instead of showing a blank/frozen page. All API calls in SessionContext detect 401 responses and redirect automatically. SessionProvider revalidates every 5 minutes and on tab focus.

## [0.3.6] - 2026-03-22

### Added

- **Mobile voice dictation**: Native text input bar in the Flutter app replaces xterm.dart's internal keyboard handler, enabling Android/iOS voice dictation, autocorrect, and predictive text. Autocorrect is enabled only for agent sessions (disabled for shell to preserve command case sensitivity)
- **Long-press send to type without executing**: Long-press the send button in both Flutter and PWA mobile input bars to insert text into the terminal without appending `\r`, enabling tab-completion workflows (type partial command, long-press, then TAB to autocomplete)
- **"ended" agent activity status**: Sessions whose Claude Code session ends now show "ended" status instead of falling through to "idle". Supported across web sidebar, loop status bar, mobile home screen, and browser notifications
- **Mobile session close**: Swipe-to-close gesture on session tiles in the Flutter drawer sidebar, matching the web app's swipe-to-close pattern. Agent exit overlay "Close" button now actually closes the session server-side (kills tmux) instead of just navigating away
- **Git credential suppression**: Automatically configure `gh` as the git credential helper in all terminal sessions, preventing macOS Keychain GUI prompts when agents run `git push/pull/fetch`. Profile sessions get `[credential]` in their `.gitconfig`; non-profile sessions get a session-scoped gitconfig with cleanup on close
- **Folder git identity override**: Per-folder pseudonymous git name/email in folder preferences, injected as `GIT_AUTHOR_NAME/EMAIL` and `GIT_COMMITTER_NAME/EMAIL` into session environment. Identity inherits child-first through folder hierarchy
- **Sensitive folder protection**: Mark folders as "sensitive" to require pseudonymous identity for commits and pushes. `isSensitive` flag propagates from any ancestor folder. Git guard API (`POST /api/folders/[id]/git-guard`) evaluates identity risk with `none/warn/block` levels
- **Git identity guard hook**: rdv CLI `PreToolUse` hook intercepts `git commit` and `git push` Bash commands, calls the git-guard API, and blocks tool use (exit 2) when identity would leak in a sensitive folder
- **Profile gitconfig migration**: `bun run db:migrate-profile-gitconfigs` adds `[credential]` section to existing profile `.gitconfig` files with idempotency checks
- **Two-mode mobile keyboard**: Switchable Keys/Nav modes in the mobile terminal toolbar — Keys mode has ESC, TAB, ^C, ^D, CTRL/ALT/SHIFT sticky modifiers; Nav mode has arrow keys, HOME/END, PGUP/PGDN, ENTER, SHIFT+ENTER
- **Sticky modifier keys**: CTRL/ALT/SHIFT toggles in the toolbar intercept the next keystroke typed in the text input, enabling Ctrl+C, Alt+key, and other combos on mobile
- **`useMobileModifiers` hook**: Shared modifier state between MobileKeyboard and MobileInputBar with IME composition guard and double-consumption protection
- **Light mode app icon**: New `icon-light.svg` variant for light mode contexts
- **Mobile folder filtering**: FolderTree integrated into the Flutter app's session drawer with collapsible hierarchy, session counts, and descendant folder filtering
- **Mobile image upload**: Camera/gallery button in keyboard toolbar uploads images via `image_picker` and pastes the server path into the terminal
- **Enriched session tiles**: Mobile drawer session tiles now show project path, git branch, agent provider, activity status colors, and suspended indicator
- **Folder subtree helper**: `Folder.subtreeIds()` static method for reusable folder hierarchy traversal

### Fixed

- **False agent exit detection on reconnect**: Race condition where old PTY async `onExit` handlers could fire after WebSocket reconnection, destroying the new session and showing a false "Agent completed" exit screen. Added PTY/WS identity guards and proper pre-cleanup on reconnect
- **Stale error status after session resume**: Resuming a suspended agent/loop session now resets `agentExitState`, `agentExitCode`, and `agentActivityStatus` so stale error indicators don't persist
- **Mobile session selection deadlock**: Tapping a session in the Flutter app drawer now correctly loads the terminal instead of showing "No active session"
- **Mobile sticky keys in NAV mode**: CTRL/ALT/SHIFT modifiers and ESC/^C/^D quick keys now appear in both keyboard modes, fixing sticky modifiers being inaccessible in NAV mode
- **Mobile nav button alignment**: Reorganize nav mode arrow keys into a d-pad cluster (↑ centered above ← ↓ →) with pure CSS flex layout, separate from other navigation keys
- **Mobile drawer close**: Replace `Navigator.maybePop()` with `closeDrawer()` for reliable drawer dismissal inside GoRouter ShellRoute
- **Mobile nested Scaffold**: Remove inner Scaffold/AppBar from TerminalScreen to fix double safe-area insets and status pill overlap
- **Mobile back navigation**: Add PopScope to clear active session on hardware back button / swipe-back
- **Mobile WebSocket lifecycle**: Add `_disposed` guard to prevent post-dispose crashes in `_doConnect`, `_onMessage`, `_onError`, `_onDone`, and `_scheduleReconnect`
- **Mobile terminal focus**: Add explicit FocusNode management to prevent keyboard dismiss when tapping toolbar keys
- **Mobile modifier state**: Clear modifiers on mode switch and app background to prevent stuck state
- **Folder session count reactivity**: Pass watched provider values as parameters instead of calling `ref.watch` inside helper methods
- **Folder filter descendants**: `filteredSessionsProvider` now includes sessions from child folders, matching the count badges in FolderTree
- **App icon corner artifacts**: Fix title bar bleeding into border stroke by using clipPath inset by stroke half-width instead of overlapping rounded rects
- **App icon consistency**: Regenerate all icon formats (PWA, favicon, electron) from corrected source SVG
- **Mobile IME composition**: Use `nativeEvent.isComposing` instead of synthetic event property for reliable CJK input on mobile browsers
- **Empty input submit**: Send button now works without text, sending bare `\r` to confirm terminal prompts
- **Ctrl+non-alpha keys**: CTRL modifier now correctly handles Ctrl+[ (ESC), Ctrl+\ (SIGQUIT), and other non-letter control codes
- **Mobile terminal screen**: Use server-scoped storage providers (`activeServerConfigProvider`, `serverScopedStorageProvider`) instead of legacy flat-key providers for multi-server compatibility
- **Mobile add server**: Omit port from server URL for Cloudflare Access and standard ports (443/80), preventing connection failures behind CF proxy
- **Mobile add server**: Store credentials before persisting server config in manual setup flow, preventing orphaned configs if credential storage fails

### Removed

- **Dead mobile code**: Delete orphaned `HomeScreen`, `AdaptiveScaffold`, `SessionSidebar`, `SessionListScreen`, and `_QuickActionsPanel` (~660 lines)

## [0.3.5] - 2026-03-21

### Added

- **Mobile app multi-server support**: Save and switch between multiple remote-dev server instances with per-server credential isolation via `ServerScopedStorage`
- **QR code server onboarding**: Scan a QR code from the web dashboard for zero-typing server setup using `mobile_scanner`
- **Edge drawer navigation**: Swipe from left edge for instant session switching (1 gesture vs 2-3 taps), with floating status pill and quick actions panel
- **Glassmorphism UI**: `GlassmorphicContainer` widget with frosted glass `BackdropFilter` surfaces on drawer, bottom sheets, and dialogs
- **Smart input widgets**: Port stepper `[-][6001][+]`, protocol dropdown (http/https), host input with recent history autocomplete
- **Credential auto-migration**: Existing single-server credentials automatically migrated to multi-server format on first launch

### Changed

- **Mobile terminal rendering**: Replaced ANSI-to-HTML renderer (`MobileTerminalView`) with xterm.js + native input overlay. xterm.js handles all rendering (colors, cursor, tmux, scrollback) while `MobileInputBar` provides native text input with autocorrect, voice dictation, and predictive text. Special keys toolbar (ESC, TAB, CTRL, arrows) renders below the input bar.
- **GoRouter**: Migrated to `ShellRoute` with `refreshListenable` for stable navigation (no more router recreation on state changes)
- **Theme**: Transparent drawer/dialog/sheet backgrounds for glassmorphism, replaced manual color mixing with `Color.lerp`

## [0.3.1] - 2026-03-21

### Added

- **Loop agent session type**: Chat-first, mobile-first UI for long-running AI agent sessions with loop scheduling
  - New `"loop"` terminal type plugin with conversational and monitoring modes
  - Stream-JSON output parsing for Claude Code (`--output-format stream-json`) with ANSI text fallback
  - `useLoopScheduler` hook for interval-based prompt re-fire in monitoring mode
  - Chat components: `LoopChatPane`, `LoopMessageBubble`, `LoopChatInput`, `LoopStatusBar`
  - `TerminalDrawer` for toggling raw terminal view (full-screen mobile, resizable desktop)
  - Session wizard integration with loop config form (type, interval, prompt, agent, profile)
  - Sidebar `MessageCircle` icon with activity status indicators
  - 2000-message cap prevents unbounded memory growth in long-running sessions
- **FCM push notifications for mobile app**: End-to-end push notification delivery from agent hooks to the Flutter mobile app via Firebase Cloud Messaging
  - Server: `PushNotificationGateway` port + `FcmPushGateway` (FCM HTTP v1 API) with `NullPushGateway` graceful degradation
  - New `push_token` DB table and `DrizzlePushTokenRepository` for device token storage
  - `POST/DELETE /api/notifications/push-token` endpoints for token registration
  - Push dispatch integrated into `NotificationService.createNotification()` (fire-and-forget)
  - Cross-channel notification sync: `/internal/notification-dismissed` WebSocket broadcast
  - Flutter: `PushNotificationService` with FCM lifecycle, token refresh, and deep link to session on tap
  - Android notification channel via `AndroidManifest.xml` metadata
- **Mobile-optimized terminal with native text input**: On mobile devices, replaces xterm.js canvas with a native text input bar and ANSI-to-HTML output panel
  - `MobileTerminalView`: scrollable output panel with theme-aware ANSI color rendering
  - `MobileInputBar`: native `<textarea>` with autocorrect, predictive text, and voice dictation
  - `useTerminalWebSocket`: shared WebSocket hook with auth, reconnect, and message dispatch
  - All session types (shell, agent) get native text input on mobile; desktop path unchanged
- **Mobile worktree creation**: Create git worktrees from the Flutter mobile app's session creation sheet
  - Worktree type picker (feature/fix/chore/refactor/docs/release)
  - Branch name auto-suggestion from session name
  - Async base branch picker fetched from server
  - New Clean Architecture ports: GitGateway, FolderPreferencesGateway

### Fixed

- **Android notification icon**: Added monochrome `ic_notification` drawable so push notifications show the `>_` prompt silhouette instead of a white square
- **App icon redesign**: Replaced plain `>_` square icon with the full terminal window design matching `favicon.svg` (rounded corners, title bar with traffic lights, output lines)
- **Android adaptive icon**: Added `ic_launcher_foreground` and adaptive icon XML so the launcher applies proper rounded/squircle masking
- **PWA icons**: Regenerated all PWA icon sizes with the updated terminal window design

## [0.3.0] - 2026-03-20

### Added

- **Flutter mobile app foundation**: Native Android/iOS terminal client using Flutter + xterm.dart with Clean Architecture
  - 4-layer architecture: Domain, Application, Infrastructure, Presentation
  - WebSocket terminal protocol with typed Dart sealed classes, exponential backoff reconnection, and token refresh
  - OKLCH color conversion ported from TypeScript for full theme parity (12 color schemes)
  - 22 Nerd Fonts bundled as TTF assets for terminal rendering
  - CF Access + API key dual authentication flow
  - Adaptive phone/tablet layout with split pane support
  - Mobile keyboard toolbar (ESC, CTRL, ALT, TAB, arrows, symbols)
- **Poll-based auto-update system**: Multi-server deployment support replacing GitHub webhook dependency
  - Each server independently polls GitHub Releases for pre-built artifacts
  - AutoUpdateOrchestrator coordinates lifecycle: detect → schedule → drain → apply → restart
  - Graceful session draining with configurable timeout (broadcasts `update_pending` to connected clients)
  - Durable deployment state persisted to SQLite, recovers pending timers on restart
  - New domain objects: `DeploymentStage`, `UpdatePolicy`, `UpdateDeployment` entity
  - New use cases: `ScheduleAutoUpdateUseCase`, `DrainSessionsUseCase`
  - New API actions: `POST /api/system/update { action: "cancel" }` to cancel pending updates
  - `GET /api/system/update` now includes deployment lifecycle stage info
  - Configurable via `AUTO_UPDATE_ENABLED`, `AUTO_UPDATE_DELAY_MINUTES`, `AUTO_UPDATE_DRAIN_TIMEOUT_SECONDS`

### Deprecated

- **Webhook deploy endpoint**: `POST /api/deploy` returns 410 when `AUTO_UPDATE_ENABLED=true`, guiding migration to poll-based updates
- **Worktree cleanup**: New `rdv worktree cleanup` command for agents to trigger full worktree lifecycle cleanup from inside a worktree
  - Merge verification: requires branch is merged into main/master before removal (use `--force` to skip)
  - Removes worktree directory via server-side git commands (solves the CWD-inside-worktree problem)
  - Deletes local and remote branches after merge verification
  - Closes the session automatically
- **Worktree service functions**: `getDefaultBranch()`, `isBranchMerged()`, `deleteBranch()`, `cleanupWorktree()` for reusable git branch lifecycle operations
- **Session cleanup mode**: `DELETE /api/sessions/:id?cleanup=true&force=false` for full worktree cleanup via API

### Fixed

- **rdv worktree remove**: Fixed broken field names (`repoPath`/`branch` → `projectPath`/`worktreePath`) that caused 400 errors when calling the API
- **Structured Logging System**: Complete logging overhaul replacing all `console.*` calls with structured, leveled logging
  - 5 log levels: error, warn, info, debug, trace (controlled via `LOG_LEVEL` env var)
  - Separate SQLite database at `~/.remote-dev/logs/logs.db` for log persistence
  - Clean architecture: `LogLevel` value object, `LogRepository` port, `BetterSqliteLogRepository`, `QueryLogsUseCase`, `PruneLogsUseCase`
  - `createLogger(namespace)` factory for namespaced loggers with structured data support
  - Both Next.js and terminal server write to the same log database via WAL mode
  - 7-day automatic log retention
- **Log Viewer UI**: New "Logs" tab in Settings modal
  - Filter by level, source (Next.js/terminal), namespace, and free-text search
  - Auto-refresh mode (3s polling) for live log monitoring
  - Expandable JSON data viewer for structured log data
  - Pagination with "Load more" for historical browsing
  - Clear all logs with confirmation dialog
  - Color-coded level badges and source indicators
- **API endpoints**: `GET /api/system/logs` (query with filters), `DELETE /api/system/logs` (clear), `GET /api/system/logs/namespaces` (distinct namespaces)
- **CLAUDE.md**: Added logging as a non-negotiable convention

### Changed

- Consolidated all lifecycle hook commands under `rdv hook` namespace (`pre-tool-use`, `post-tool-use`, `pre-compact`, `notification`, `validate`)
- Updated `ClaudeCodeHooks` type to include all hook event types (PreCompact, Notification, Stop, SessionStart, SessionEnd)
- Hook editor UI now supports all Claude Code hook types
- **Full console.* migration**: All ~236 `console.log/error/warn` calls across 76 server-side files migrated to structured logger with appropriate levels and namespaces
  - Noisy connection lifecycle logs downgraded from stdout to `debug` level
  - Plugin init/registration messages corrected from `console.error` to `log.info`/`log.debug`
  - Error objects consistently passed as structured data instead of string interpolation

### Fixed

- **Task list stale after sleep/tab switch**: Task list now automatically refreshes when the page regains visibility (e.g. returning from sleep, switching tabs) instead of requiring a manual reload. Also added fetch cancellation via AbortController to prevent race conditions from concurrent refreshes.
- **Task session scoping**: Tasks sidebar now shows only the active session's tasks instead of all folder tasks, matching the schedule scoping pattern. New tasks and linked GitHub issues are automatically associated with the active session.
- **Schedule session scoping**: Schedules sidebar now shows only the active session's schedules instead of all schedules, and schedule creation auto-detects the active session instead of showing a session picker

### Added

- `rdv hook validate` command for checking hook server connectivity
- Automatic hook validation on agent session creation with auto-repair
- Hook deduplication now detects both wrapped and direct `rdv hook` commands

### Fixed
- Hooks no longer reference nonexistent rdv subcommands (consolidated under `rdv hook` namespace)

- **Background Service Installation**: Production service management via systemd (Linux) and launchd (macOS)
  - `scripts/install-service.sh` installs and enables user-level service units
  - `scripts/uninstall-service.sh` stops and removes service units
  - systemd: two-unit design (Next.js + terminal server) with `PartOf=` lifecycle binding
  - launchd: two plist agents with `KeepAlive` and stdout/stderr logging
  - Service config templates in `scripts/service-config/` with placeholder substitution
- **Self-Update Mechanism**: Check for and apply updates from GitHub Releases
  - `CheckForUpdatesUseCase`: polls GitHub API with 1-hour cache, compares semver versions
  - `ApplyUpdateUseCase`: downloads tarball, verifies SHA-256 checksum, extracts to versioned directory, atomically switches `current` symlink, and triggers service restart
  - `TarballInstallerImpl`: atomic release installation with staging directory, old release cleanup (keeps last 3)
  - `GitHubReleaseGateway`: unauthenticated GitHub API client for release metadata and checksum fetching
  - `UpdateScheduler`: configurable periodic update checks (default 6 hours)
  - `ServiceRestarterImpl`: PID-based service restart via `kill -USR2` or process re-exec
  - Settings UI: System > Updates page showing current version, update state, and manual check/apply controls
  - API endpoints: `GET/POST /api/system/update` with `withApiAuth` for CLI and UI access
  - `rdv system update [check|apply]`: CLI commands for update management
- **CI/CD Release Pipeline**: GitHub Actions workflow for building platform release tarballs
  - Matrix builds for linux-x64, linux-arm64 (native runner), darwin-x64, darwin-arm64
  - Produces `remote-dev-{version}-{platform}.tar.gz` with SHA-256 checksums
  - Triggered on version tags (`v*`)
  - `scripts/pack-release.sh`: builds Next.js, terminal server, and Rust CLI, then packages into distributable tarball
- **rdv Hook Commands**: `rdv hook stop|notify|session-end` for Claude Code lifecycle hook integration (stop reporting, lifecycle notifications, session-end handling).
- **POST /api/notifications**: New endpoint to create notifications programmatically via API.
- **Local CLI Credentials**: Auto-provisioned API key at `~/.remote-dev/rdv/.local-key` so `rdv` CLI authenticates without manual `RDV_API_KEY` setup. Key is created at server startup with 0600 permissions.
- **rdv Dual-Server Routing**: CLI now routes `/api/*` to Next.js and `/internal/*` to the terminal server, with Unix socket and TCP support for both.
- **rdv Browser Commands**: `rdv browser navigate|screenshot|snapshot|click|type|evaluate|back|forward` for headless browser automation.
- **rdv Notification Commands**: `rdv notification list|read|delete` for notification management.
- **rdv Session Commands**: `rdv session children|spawn|git-status` for child session management and git status.
- **Schedule Sidebar**: Moved schedule management from standalone modal to the right sidebar under GitHub issues, with inline enable/disable toggles, run-now buttons, and delete confirmation.
- **Schedule Session Picker**: `CreateScheduleModal` now includes a session dropdown for creating schedules from the sidebar without a pre-selected session.

### Changed

- **Schedule Management Location**: Schedule viewing and creation moved from left sidebar footer button + `SchedulesModal` to the right `TaskSidebar`.

### Removed

- **SchedulesModal**: Removed standalone schedule management modal (replaced by right sidebar section).
- **Schedules Footer Button**: Removed "Schedules" button from the left sidebar footer.

### Fixed

- **Port fallback**: Agent sessions now correctly fall back to terminal port 6002 (was 3001).
- **API key cleanup**: Agent-session API keys are revoked on session close and deduplicated on create/resume, preventing unbounded accumulation.
- **Static imports**: Replaced unnecessary dynamic imports in session-service with static imports.

- **Toast Notifications**: Real-time toast notifications for agent events (waiting, error, complete, exited) via sonner, positioned bottom-center with glassmorphism styling. Toasts are clickable to jump directly to the related session.
- **Clear Notifications**: Per-item dismiss (X button on hover) and "Clear all" button in notification panel header. Hard deletes notifications from the database.
- **Notification Panel Glassmorphism**: Upgraded notification panel to frosted glass style (`bg-popover/95 backdrop-blur-xl`) matching the rest of the app's modal/panel aesthetic.
- **Enhanced agent task sync**: Full Task system support capturing all TaskCreate/TaskUpdate fields (metadata, description, dependencies, owner, priority) with stable `agentTaskKey` dedup
- **Task dependencies**: `task_dependency` junction table for blockedBy relationships between tasks
- **TaskEditor**: Inline expandable task editor with subtasks, dependencies, metadata, and instructions editing
- **Internal task endpoints**: POST/PATCH endpoints on terminal server for rdv CLI task creation and updates
- **Bulk task archival**: `cancelOpenAgentTasks` for efficient session close cleanup
- **Clear all tasks**: Bulk delete tasks from the right sidebar with "Clear completed" and "Clear all" options, available for both Tasks and Agent Tasks sections
- **rdv CLI (Rust)**: New CLI at `crates/rdv/` for agent interaction with the terminal server
  - Commands: session, worktree, agent, task, folder, status, context
  - Auto-discovery via `RDV_SESSION_ID`, `RDV_TERMINAL_SOCKET`, `RDV_TERMINAL_PORT` env vars
  - JSON output by default, `--human` flag for table output
  - Auto-installed on server startup if cargo is available

- **Claude Code Plugin**: Plugin structure for marketplace distribution
  - `skills/rdv/SKILL.md` — teaches agents to use rdv CLI
  - `commands/rdv-status.md` — /rdv-status slash command
  - `agents/rdv-orchestrator.md` — multi-agent orchestrator subagent
  - `hooks/hooks.json` — hook config for agent status/task sync

- **Stop hook checks all tasks**: Stop hook now checks both agent-created and user-assigned tasks for a session, with source labels in output

- **Mobile Header**: Compact header bar on mobile/PWA with GitHub status, secrets, appearance toggle, tasks, user menu, and sign-out
- **Sidebar Worktree Shortcut**: "New Worktree" option in the sidebar + dropdown menu (enabled when active folder has a linked repository)

### Changed

- **Stop hook TaskCreate instructions**: Stop hook now returns structured instructions telling the agent to use TaskCreate for each incomplete task (manual, agent-owned, post-tasks), replacing the plain text listing
- **Agent hooks use rdv CLI**: Hooks now prefer `rdv` CLI commands over curl, with automatic curl fallback when rdv is not installed

### Removed

- **MCP server backend**: Removed `src/mcp/` directory (18 files), MCP registration code from agent-profile-service, and `bun run mcp` script. Agents now use rdv CLI instead of MCP protocol. UI components that display MCP servers are retained.

### Security

- **Browser API session ownership**: All 8 browser API routes (`back`, `click`, `evaluate`, `forward`, `navigate`, `screenshot`, `snapshot`, `type`) now verify session ownership before allowing operations
- **Browser frame localhost restriction**: `/internal/browser-frame` endpoint restricted to localhost callers only
- **Invalid URL rejection**: `createBrowserSession` now throws on invalid URLs instead of silently creating `about:blank` sessions
- **URL param encoding**: rdv CLI now uses proper query parameter encoding via `post_empty_with_query` instead of string interpolation

### Fixed

- **Notification limit validation**: `limit` query param on notifications API now validates for NaN and clamps to [1, 200]
- **React concurrent-mode safety**: `markReadRef.current` assignment moved to `useEffect` to avoid ref mutation during render
- **Shared markdown components**: `IssueDetailPanel` now uses shared `MARKDOWN_COMPONENTS` module, fixing visual inconsistency with PR detail views
- **TaskSidebar dead code**: Removed unused `hydrated` state variable
- **rdv CLI output**: Fixed `print!` to `println!` for consistent terminal output termination
- **Mobile Long-Press Glitch**: Disabled folder touch-drag handlers on mobile to prevent orphaned clone elements when context menu intercepts touch events
- **Drag Clone Cleanup**: Added unmount cleanup for drag clones to prevent visual artifacts persisting after navigation

- **Agent Status Notifications**: Browser notifications when AI agent sessions change state (idle, waiting for input, error, compacting context)
  - Click notification to focus window and switch to the relevant session
  - Notifications only fire when the browser window is not focused
  - Configurable via "Agent notifications" toggle in User Settings > Project tab
  - Browser notification permission requested on first enable
  - Extracted shared `useNotificationPermission` hook with `useSyncExternalStore` for consistent permission state across components

- **Mobile Screenshot Upload**: Camera button in the mobile quick-key toolbar allows uploading screenshots/images from camera roll or camera, equivalent to desktop drag-and-drop

- **Issue-to-Worktree Flow**: Click a GitHub issue to view details and start working with one click
  - Issue detail panel with markdown body rendering, metadata, labels, and suggested branch name
  - "Start Working" button creates a git worktree and launches an agent session with issue context as prompt
  - Auto-detects branch type (fix/feature/docs/chore) from issue labels
  - Branch naming follows `{type}/issue-{number}-{description}` pattern

- **Issue Comments**: Fetch and display issue comments in the detail panel via GitHub API

- **Folder Default Agent Preference**: Set a default AI agent provider per folder in Folder Preferences
  - New `default_agent_provider` column on `folder_preferences` table
  - Inherits through folder hierarchy like other preferences
  - Used automatically when creating agent sessions from issues

- **Issue Detail UX**: Loading state on Start Working button; Escape key navigates back to issue list

- **Issue/PR Icon Differentiation**: Issues and pull requests now display distinct icons (CircleDot/CircleCheck for issues, GitPullRequest/GitMerge for PRs) across all views
- **`isPullRequest` Field**: Added `is_pull_request` column to `githubIssues` table to distinguish PRs from issues fetched via the GitHub API

### Changed

- **Mobile Sidebar UX**: Sidebar now uses inline push layout instead of floating overlay
  - Sidebar stays open when selecting a session, allowing free browsing
  - Sidebar pushes terminal content over instead of overlaying with backdrop
  - Session row styling matches desktop (transparent backgrounds for unselected items)

### Fixed

- **Mobile Quick Key Detection**: Quick-key toolbar now uses touch/UA-based mobile detection (`useMobile()`) instead of CSS breakpoint (`md:hidden`), correctly appearing on touch devices like iPads regardless of viewport width
- **Worktree Icon Priority**: Fix missing worktree icon for agent+worktree sessions in expanded sidebar and tooltip by checking `worktreeBranch` before `terminalType`
- **Agent Hooks with HOME Override**: Fix agent activity hooks not firing when startup command overrides HOME (e.g., `jclaude` alias with `HOME=/Users/joyfulhouse`). Server now resolves the effective HOME from inline assignments and shell aliases, installing hooks at both the profile config dir and the agent's actual HOME.
- **Session Type Fixes**: Fix missing `worktreeType` and `agentActivityStatus` fields in server-side session mapping and API presenter
- **CodeMirror Deduplication**: Add overrides to resolve duplicate `@codemirror/language` versions causing build type errors
- **Agent Tasks Per Session**: Agent tasks in the Task Sidebar are now scoped to the active session instead of showing all agent tasks for the folder
  - Each agent session displays only its own tasks; manual tasks remain folder-scoped
  - Task count badge correctly excludes agent tasks from other sessions

### Added

- **Voice Mode**: Hold mic button to stream browser audio to Claude Code's built-in voice pipeline via FIFO-based sox shim, enabling voice input for remote agent sessions
- **Worktree Type Selection**: Allow selecting worktree type (feature/fix/chore/refactor/docs/release) when creating a Feature Session
  - Inline branch prefix dropdown replaces hardcoded `feature/` prefix
  - New `worktree_type` column on `terminal_session` persists the selected type
  - Backend and use case use dynamic prefix for branch name generation

- **Agent Task Sync**: Mirror Claude Code's task list into the Task Sidebar in real-time
  - PostToolUse hook on `TaskCreate|TaskUpdate|TodoWrite` syncs tasks to `project_task` table
  - Supports Claude Code v2.1.69+ individual TaskCreate/TaskUpdate calls and legacy TodoWrite batch format
  - Upsert semantics: existing tasks are updated when status/title changes
  - O(1) dedup via marker map instead of linear scans
  - WebSocket broadcast notifies all clients of task changes for live sidebar updates
  - Auto-archives open/in-progress agent tasks when session closes
  - New `sessionId` column on `project_task` links agent tasks to originating sessions

- **Rendered Markdown View**: Markdown files (.md/.mdx) now open in a rendered view by default with GitHub-style prose styling
  - Pencil/eye toggle in the toolbar switches between rendered and CodeMirror editor modes
  - Syntax highlighting for fenced code blocks using rehype-highlight
  - GFM support: tables, task lists, strikethrough, autolinks
  - XSS protection: allowlist-based URL sanitization blocks unsafe URI schemes

- **Resume Claude Session**: Discover and resume previous Claude Code conversations from the folder context menu
  - Scans `~/.claude/projects/<encoded-path>/` (or profile-isolated equivalent) for `.jsonl` session files
  - Modal shows recent sessions sorted by last activity with branch, timestamp, and first message preview
  - Resumes via `claude --resume <session-id>`, appended to the folder's configured startup command
  - New `GET /api/agent/claude-sessions` endpoint for session discovery
  - Configurable session limit (default 20, max 50)
- **Auto-register MCP server on agent creation**: Automatically configures the Remote Dev MCP server in agent config files (Claude, Gemini, Codex) during session creation and resume, giving agents immediate access to session management, git, and folder tools
- **Mobile PWA Optimization**: Automatic detection and optimization for mobile devices and installed PWA mode
  - `useMobile` hook: detects mobile devices via user-agent and touch capability (replaces viewport-based detection)
  - `usePWA` hook: detects standalone PWA display mode via `matchMedia("(display-mode: standalone)")` and `navigator.standalone`
  - Swipe-to-close on sidebar sessions: swipe left to reveal a close button (like iOS mail), preventing accidental taps
  - Hidden invisible close button on mobile — previously `opacity-0` but still tappable, causing accidental session closes
  - Safe-area inset CSS utilities for iPhone notch and home indicator support (`pt-safe-top`, `pb-safe-bottom`, `pl-safe-left`, `pr-safe-right`)
  - Safe-area padding applied to sidebar, mobile header bar, terminal container, and mobile keyboard toolbar
  - PWA-aware top padding when running as installed app without browser chrome
- **Multi-GitHub Account Support**: Link multiple GitHub accounts (personal, work, etc.) with per-folder binding
  - New "Accounts" tab in GitHub Maintenance modal to manage linked accounts (add, set default, unlink)
  - Per-folder GitHub account binding in folder preferences — sessions in a folder automatically get that account's credentials
  - Full `gh` CLI auth: each account gets an isolated `GH_CONFIG_DIR` with `hosts.yml` provisioned at link time
  - Environment injection pipeline: sessions receive `GH_TOKEN`, `GH_CONFIG_DIR`, and `GITHUB_USER` based on folder binding or default account
  - Explicit default account — user must designate one account as the default; first account linked is auto-default
  - Clean Architecture implementation: `GitHubAccount` domain entity, 6 use cases, repository port, gh CLI config gateway
  - New DB tables: `github_account_metadata`, `folder_github_account_link`
  - Migration script for existing users: `bun run db:migrate-github-accounts`
- **Files Section in Sidebar**: New collapsible "Files" section above MCP Servers showing default project files (.env, .env.local, CLAUDE.md, README.md) and pinned files
  - Automatically detects which default files exist on disk for the active folder's project directory
  - Pinned files moved from inline folder tree to this dedicated section, reducing clutter
  - Active file highlighting matches the current editor session
  - Pin icon indicator distinguishes user-pinned files from auto-discovered defaults
  - Collapsed sidebar shows file count badge
  - New `/api/files/exists` batch endpoint for lightweight file existence checks
- **Pin Session**: Pin sessions to the top of their folder via right-click context menu
  - Pinned sessions render above subfolders within their folder
  - Pinned root sessions appear above all folders in sidebar
  - Pin icon indicator shown on pinned sessions
  - Drag-and-drop constrained within same pin partition
- **Project Task Tracker Sidebar**: Collapsible right sidebar for project-scoped task management
  - Three sections: Manual Tasks, Agent Tasks, and GitHub Issues
  - Tasks support 4-level priority (Critical/High/Medium/Low), custom labels, subtasks, and due dates
  - Agent tasks created automatically via MCP tools or REST API (5 new MCP tools: task_list, task_create, task_update, task_complete, task_delete)
  - GitHub issues displayed from linked repos with "Link to task" action
  - Folder-scoped: tasks track with each project folder independently
  - Collapsible to 48px icon strip with open task count badge
  - Resizable via drag handle (240-500px)
  - Toggle via Cmd+. keyboard shortcut or header button
  - Consistent glassmorphism design with existing UI patterns
- **Agent Activity Status Indicators**: Real-time agent activity shown in sidebar via colored Sparkles icons
  - Green breathing animation when agent is running (tool use in progress)
  - Yellow breathing animation when agent is waiting for user input
  - Solid red when agent exited with error
  - Gray when idle or no recent activity
  - Uses Claude Code hooks (PreToolUse/Stop) to report status back to terminal server
  - Hooks are automatically installed and merged with existing settings at session creation
  - Status broadcast via WebSocket to all connected clients for cross-tab visibility

### Changed

- Pinned files now scoped to the active folder in the Files section (previously visible inline across all folders simultaneously)

### Removed

- **MarkdownEditor component**: Consolidated into CodeMirrorEditor with rendered markdown support
- Drag-to-reorder for pinned files in the sidebar (use folder settings to reorder)

### Fixed

- Worktree sessions now show GitBranch icon instead of generic terminal icon in sidebar

## [0.2.1] - 2026-02-10

### Added

- **MCP Tool Discovery for Agent Sessions**: Agents can now discover and use MCP tools within sessions
- **MCP Agent Sessions**: Profile management support for MCP-based agent sessions
- **Mobile Touch Scrolling**: Touch scrolling support for terminal on mobile devices
- **Pinned File Editor**: CodeMirror 6-powered file editor for pinned files
- **Terminal Type Plugin System**: Extensible plugin architecture for different session types
- **Separate Agent Creation**: Distinct New Terminal and New Agent session creation flows
- **Clean Architecture Tmux Environment & Profile Refactor**: Domain-driven tmux environment management and profile handling

### Changed

- Code simplification and linting fixes across the codebase
- Simplified codebase with extracted helpers and reduced duplication
- Session numbering now finds next available number instead of always incrementing
- Bot icon shown for agent sessions in sidebar

### Fixed

- Prevent rapid reconnection that can exhaust PTY resources
- Skip trashed sessions in status sync and improve auth resilience
- Pass terminalType correctly to API for agent sessions
- Address code review findings in PortMonitor and RestartAgentUseCase
- Prevent browser caching on GitHub API fetch requests
- Filter out framework internal env vars from child processes

## [0.2.0] - 2026-01-09

### Added

- **Clean Architecture**: Domain layer with entities, value objects, use cases, and repository pattern for better testability and maintainability
- **Multi-Agent CLI Support**: Unified management for Claude Code, OpenAI Codex, Gemini CLI, and OpenCode with:
  - CLI installation status detection and version checking
  - Per-agent configuration editors (CLAUDE.md, AGENTS.md, GEMINI.md, OPENCODE.md)
  - Profile isolation with separate directories per agent
  - Environment variable injection from secrets providers
- **Theme System**: Comprehensive appearance system with:
  - 8 color schemes (Tokyo Night, Dracula, Nord, Solarized Dark/Light, One Dark, GitHub Dark/Light)
  - Light/Dark/System mode toggle
  - Terminal theme integration with xterm.js
  - Per-profile appearance settings
  - Semantic colors for consistent UI
- **Profile Management**:
  - Quick-switch between profiles
  - Profile templates for reusable configurations
  - Export/import profiles for backup and sharing
  - Per-profile theming and appearance
- **GitHub Issues Viewer**: View and create issues directly from the sidebar
- **Enhanced GitHub Features**: Filtering, search, PR counts, and issue creation
- **Test Infrastructure**: Vitest setup with domain layer and use case tests
- **Tmux Session Management**: UI in settings modal to view and manage orphaned tmux sessions
- **GitHub Maintenance Modal**: Repository management with local repo operations
- **Init Script**: Guided setup experience (`./scripts/init.sh`)
- **Window Dragging**: Enable window dragging on sidebar and header empty areas for PWA
- **Long-press Delay**: Mobile-friendly folder drag with long-press activation
- **Roll-up Stats**: Collapsed folders show aggregated session counts
- **Active Schedules Counter**: Sidebar footer shows count of scheduled commands

### Changed

- Migrated to Clean Architecture pattern for session and folder management
- Terminal colors optimized for both light and dark themes
- Improved semantic color system throughout the UI
- Better mobile support with autocorrect/autocapitalize attributes

### Fixed

- Terminal theme manipulation now reliable for CLI colors
- Bright terminal colors readable in all light themes
- Content overflow in ProfilesModal
- Scrolling issues in ProfileConfigTab
- Glass opacity applied to terminal background correctly
- Database path handling for production mode

## [0.1.2] - 2025-12-26

### Added

- **Agent Profiles System**: Database schema and API for managing AI agent configurations
- **Profiles UI**: Full UI for creating, editing, and managing agent profiles
- **Port Manager Modal**: Framework detection and port conflict management
- **File Browser**: SSH key path selection with unsaved changes warnings
- **Active Schedules Counter**: Visual indicator in sidebar footer

### Changed

- Upgraded xterm.js to v6.0.0 with improved text selection
- Unified font sizes in profiles modal to text-xs

### Fixed

- Terminal copy (Cmd+C) now works correctly
- Mobile autocomplete duplication mitigated
- Text paste handler for complete clipboard support
- Folder ownership validation for profile-folder linking
- Input sanitization and validation for agent profiles (security)
- Environment variables now injected at session creation, not WebSocket connect
- FolderId passed correctly when creating session via keyboard shortcut

## [0.1.1] - 2025-12-25

### Added

- **MCP Server**: Model Context Protocol server for AI agent integration with 24 tools, 6 resources, and 5 workflow prompts
- **Secrets Management**: Phase provider integration for secure credential management
- **Electron Desktop App**: Infrastructure for desktop application (Phases 1-7)
- **Directory Browser**: Visual filesystem navigation for project folder selection
- **Repository Picker**: Enhanced with click-to-clone, filtering, and sorting
- **Sidebar Tree Lines**: Visual hierarchy indicators with .trash directory filtering
- **Date Time Picker**: Redesigned with MUI-style clock face and analog clock hands
- **Context Menus**: Repository and Secrets options in folder context menus
- **Scheduled Commands**: One-time scheduled command execution with UI prioritization

### Changed

- DateTimePicker redesigned with side-by-side layout and interactive controls
- Modal consistency improved with smaller fonts and transparent backgrounds
- Folder browser modal no longer flashes or resizes

### Fixed

- Secrets API response type and state synchronization
- MCP server issues from code review
- Favicon styling improvements
- Text search filter in repository picker

## [0.1.0] - 2025-12-22

### Added

- **Terminal Interface**: Web-based xterm.js terminal with WebSocket communication
- **Persistent Sessions**: tmux integration for sessions that survive disconnects
- **Session Management**: Create, suspend, resume, and close terminal sessions
- **Folder Organization**: Hierarchical folder structure for organizing sessions
- **GitHub Integration**: OAuth integration with repository browsing and cloning
- **Git Worktrees**: Branch isolation with automatic worktree management
- **Session Recording**: Record and playback terminal sessions
- **Session Templates**: Save and reuse session configurations
- **Split Panes**: Multiple terminals in a single view
- **PWA Support**: Installable progressive web app with mobile sidebar
- **Keyboard Shortcuts**: macOS-style navigation and editing shortcuts
- **Command Palette**: Quick access to commands with search
- **Git Branch Indicator**: Show current branch in session tabs
- **Nested Folders**: Deep folder hierarchy support
- **Drag and Drop**: Reorder sessions and move between folders
- **Image Paste**: Paste images directly into terminal
- **Nerd Fonts**: 22 self-hosted fonts in mobile-optimized WOFF2 format
- **Cloudflare Access**: JWT authentication for tunnel access
- **API Keys**: Programmatic access for agents and automation

### Security

- Credentials auth restricted to localhost only
- Input validation and sanitization throughout
- Shell command injection prevention with execFile

---

[0.2.1]: https://github.com/btli/remote-dev/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/btli/remote-dev/compare/v0.1.2...v0.2.0
[0.1.2]: https://github.com/btli/remote-dev/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/btli/remote-dev/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/btli/remote-dev/releases/tag/v0.1.0
