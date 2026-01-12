# Changelog

All notable changes to Remote Dev will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Remote Dev SDK**: Three-perspective architecture (AX/UX/DX) for AI agent integration
  - `RemoteDevSDK` class with session, memory, and orchestrator APIs
  - `useRemoteDevSDK` and `useOrchestratorEvents` React hooks
  - REST API routes under `/api/sdk/*` for sessions, memory, notes, and meta-agent
  - SDK integration tests and comprehensive documentation

- **Meta-Agent Optimization System**: Self-improving agent configuration
  - BUILD → TEST → IMPROVE optimization loop
  - Config version tracking with automatic rollback
  - A/B testing between config versions
  - SSE streaming for real-time optimization updates
  - `MetaAgentOptimizationModal` UI component
  - CLI commands: `rdv meta start|status|history|benchmark|rollback`

- **Hierarchical Memory System**: Three-tier memory architecture
  - Short-term (5 min TTL), Working (24 hour TTL), Long-term (permanent)
  - Memory types: observation, error, pattern, decision, gotcha, insight, knowledge
  - Content-hash deduplication and TTL-based expiration
  - Scrollback pattern detection and session lifecycle integration
  - Semantic search with LanceDB vector storage
  - API routes: `/api/sdk/memory/*` for store, query, consolidate, prune

- **Note-Taking and Knowledge System**: Structured note capture for AI agents
  - Database schema for notes and insights with types and tags
  - NoteTakingService with insight extraction
  - Cross-session knowledge aggregation
  - `NotesSidebar` and `KnowledgeBrowser` UI components
  - CLI commands: `rdv notes create|list|show|delete|insights`

- **Extension System** (rdv-sdk): Plugin architecture for custom tools
  - Fluent builder APIs for tools, prompts, and extensions
  - Extension traits: Perception, Reasoning, Action, Memory, UI, Orchestration
  - Composition system with dependency resolution and cycle detection
  - Prebuilt compositions: minimal, development, web_development, data_science
  - Lifecycle hooks: OnInputMessages, PreToolUse, PostToolUse, SessionStart, etc.
  - MCP tool integration via DynamicToolRouter
  - CLI commands: `rdv extension list|install|enable|disable`
  - Documentation: `docs/extensions/composition.md`

- **arXiv 2512.10398v5 UX/DX Improvements**:
  - **ErrorAutoCaptureService**: Pattern-based error detection for multiple languages
  - **LogViewer**: Real-time streaming, filtering, search, virtual scrolling
  - **TraceViewer**: Tool call timeline, call stack, dependency graph visualization
  - **PromptPlayground**: Interactive prompt testing with parameter tuning
  - **BenchmarkComparisonView**: Side-by-side config comparison and score history
  - **RegressionDetector**: Threshold-based monitoring with severity alerts
  - **HindsightGeneratorService**: Session analysis for learnings extraction
  - **CodePreview**: Syntax highlighting with virtual scrolling
  - **DiffViewer**: Unified/split diff views with inline commenting

- **Rust Backend (rdv-server)**: Consolidated service architecture
  - REST API + WebSocket + MCP server
  - Session creation with project detection and tech stack analysis
  - Master Control auto-initialization and Folder Control auto-spin
  - Learning extraction from session transcripts
  - Worktree cleanup automation
  - Unix socket transport for low-latency communication
  - CLI token management: `rdv auth create-token|list-tokens|revoke-token`
  - Cloudflare tunnel configuration template

- **UI Enhancements**:
  - `MemoryPanel` for session memory display
  - `InsightsDashboardWidget` in sidebar
  - Memory search integration in command palette
  - Edit modals for sessions, folders, and templates
  - Consistent toast notifications throughout

- **CLI Enhancements**:
  - Memory commands: `rdv memory store|list|query|consolidate|prune`
  - Knowledge commands: `rdv knowledge list|show|apply`
  - Learning commands: `rdv learn analyze|extract|apply|consolidate|show`

- **Orchestrator-First Mode Feature Flag**: Opt-in control for Master Control monitoring
  - User-level setting with per-folder overrides
  - Hierarchical preference inheritance (Default → User → Parent Folder → Child Folder)
  - `OrchestratorModeToggle` UI component
  - Migration script (`bun run db:migrate-orchestrators`)

- **Testing Infrastructure**:
  - 742+ unit tests across services and SDK
  - 7 integration tests for database workflows
  - 6 E2E tests for complete user flows
  - Performance benchmarks for SDK operations

### Changed

- Monitoring service now respects `orchestratorFirstMode` feature flag on startup
- Orchestrators for users/folders with disabled flag are skipped during initialization
- Migrated multiple TypeScript services to consolidated Rust backend
- Enhanced command palette with memory search integration

### Fixed

- Impure `Date.now()` calls in TraceViewer causing render issues
- Cascading setState errors in TraceViewer prop syncing
- Unused import cleanup across codebase
- Lint errors in new UX/DX components

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
- **Comprehensive Test Suite**: 373 tests with 1087 assertions across:
  - Unit tests for domain entities (Episode, Orchestrator, OrchestratorInsight, OrchestratorAuditLog)
  - Unit tests for services (TaskDecomposition, AgentAssignment, DependencyResolver)
  - Unit tests for heuristics (classifyTask, selectAgent, compareAgentsForTask)
  - Integration tests for Orchestrator workflow, Episodic Memory, and Multi-Agent Coordination
  - E2E tests for complete orchestrator lifecycle, episode recording, and session-agent workflows
- **Multi-Agent Coordination Services**:
  - TaskDecompositionService for breaking down complex tasks into subtasks
  - AgentAssignmentService for intelligent agent selection and load balancing
  - DependencyResolverService for task dependency graphs and execution ordering
  - Agent heuristics with category-based classification (research, complex_code, quick_fix, etc.)
- **Episodic Memory System**:
  - Episode entity for recording agent task execution history
  - EpisodeBuilder for fluent construction of episodes with actions, decisions, pivots
  - Quality scoring and user feedback integration
  - Context generation for similar future tasks
- **LanceDB Vector Storage**: Embedding service and knowledge store for episodic memory retrieval
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

[0.2.0]: https://github.com/btli/remote-dev/compare/v0.1.2...v0.2.0
[0.1.2]: https://github.com/btli/remote-dev/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/btli/remote-dev/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/btli/remote-dev/releases/tag/v0.1.0
