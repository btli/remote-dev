# Changelog

All notable changes to Remote Dev will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

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
