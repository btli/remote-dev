# AI Agent Management Platform - Enhancement Roadmap

Remote Dev is positioned to become a comprehensive **AI Coding Agent Management Platform**. This document outlines research findings and a complete roadmap for efficiently managing multiple AI coding CLIs (Claude Code, OpenAI Codex, Google Gemini CLI, OpenCode) with isolated authentication profiles, unified configuration management, and MCP server orchestration.

---

## Table of Contents

1. [Research Findings](#research-findings)
2. [Enhancement Categories](#enhancement-categories)
3. [Implementation Phases](#implementation-phases)
4. [Database Schema](#database-schema)
5. [Technical Architecture](#technical-architecture)
6. [Sources & References](#sources--references)

---

## Research Findings

### 1. AI Coding Agent CLI Landscape (2025)

| Agent | Config File | Config Location | MCP Support | Auth Method | Installation |
|-------|-------------|-----------------|-------------|-------------|--------------|
| **[Claude Code](https://code.claude.com)** | CLAUDE.md | `~/.claude/`, project root | Native | OAuth, API keys | `npm i -g @anthropic-ai/claude-code` |
| **[OpenAI Codex](https://github.com/openai/codex)** | AGENTS.md | `~/.codex/config.toml`, project | SDK | API keys | `npm i -g @openai/codex` |
| **[Gemini CLI](https://github.com/google-gemini/gemini-cli)** | GEMINI.md | `~/.gemini/`, project root | Extensions | Google OAuth, API keys | `npm i -g @anthropic-ai/gemini-cli` |
| **[OpenCode](https://github.com/sst/opencode)** | Settings | `~/.config/opencode/` | Multi-provider | Per-provider API keys | `npm i -g opencode-ai` |

### 2. Configuration File Standards

All major AI coding agents use a **hierarchical configuration loading pattern**:

```
Global: ~/.{agent}/AGENT.md
  ↓ (lowest priority)
Ancestor: Parent directories up to project root
  ↓
Project: Project root / current directory
  ↓
Subdirectory: Component-specific overrides
  ↓ (highest priority)
```

#### CLAUDE.md (Claude Code)

> "CLAUDE.md is a special file that Claude automatically pulls into context when starting a conversation."
> — [Anthropic: Using CLAUDE.md Files](https://claude.com/blog/using-claude-md-files)

**Locations** (hierarchical):
- `~/.claude/CLAUDE.md` - Global (all projects)
- Project root `CLAUDE.md` - Project-wide (commit to git)
- `CLAUDE.local.md` - Local overrides (gitignored)
- Child directories - Component-specific

**Best Practices**:
- Keep concise (ideally < 32KB)
- Focus on project-specific conventions
- Include: coding standards, testing requirements, architecture overview
- Avoid generic programming advice

#### AGENTS.md (OpenAI Codex)

> "Codex reads AGENTS.md files before doing any work. By layering global guidance with project-specific overrides, you can make every task start with consistent expectations."
> — [OpenAI: Custom Instructions with AGENTS.md](https://developers.openai.com/codex/guides/agents-md/)

**Discovery Order**:
1. **Global**: `~/.codex/AGENTS.override.md` → `AGENTS.md`
2. **Project**: Walk from repo root to CWD, checking each directory
3. Size limit: `project_doc_max_bytes` (32KB default)

**Fallback Filenames** (configurable in `config.toml`):
```toml
project_doc_fallback_filenames = ["TEAM_GUIDE.md", ".agents.md"]
```

#### GEMINI.md (Gemini CLI)

> "Context files are a powerful feature for providing instructional context to the Gemini model."
> — [Gemini CLI: GEMINI.md Files](https://google-gemini.github.io/gemini-cli/docs/cli/gemini-md.html)

**Locations**:
- `~/.gemini/GEMINI.md` - Global context
- Project/ancestor directories - Project context
- Subdirectories - Component context

**Special Features**:
- **Imports**: `@path/to/file.md` syntax for modular configs
- **System Override**: `GEMINI_SYSTEM_MD=true` enables `SYSTEM.md` to replace default prompt
- **Commands**: `/init` generates config, `/memory show` displays merged context

### 3. Tmux Validation

**Conclusion: tmux is the correct approach** for AI agent management.

> "The Model Context Protocol (MCP) provides a standardized way for AI assistants to access external tools. For many developers, tmux is indispensable."
> — [Tmux MCP Server Guide](https://skywork.ai/skypage/en/tmux-ai-engineer-terminal-automation/1980876083311476736)

**Advantages over alternatives**:

| Feature | tmux | screen | nohup |
|---------|------|--------|-------|
| Client-server architecture | Yes | Limited | No |
| Programmatic control | Excellent | Basic | None |
| Session persistence | Yes | Yes | Limited |
| Scripting API | Superior | Basic | N/A |
| MCP integration | Direct | Manual | N/A |
| Multi-agent orchestration | Native | Manual | No |

**Key tmux capabilities for AI agents**:
- `send-keys` - Inject commands programmatically
- `capture-pane` - Read terminal output for context
- Detach/reattach - Sessions survive disconnections
- Multiple windows/panes - Multi-agent workflows

### 4. Authentication Profile Isolation

**Challenge**: AI CLIs don't natively support multiple logins/accounts.

**Solution**: Environment variable overlay with profile directories.

> "Using the GitHub CLI (gh) to manage multiple GitHub accounts on a single machine is a powerful method, especially for developers who want to streamline their workflow."
> — [Multiple SSH Keys for Git](https://gist.github.com/oanhnn/80a89405ab9023894df7)

**Profile Directory Structure**:
```bash
~/.remote-dev/profiles/{profile-id}/
├── .claude/                # Claude Code config
│   ├── CLAUDE.md
│   ├── settings.json
│   └── credentials.json
├── .codex/                 # OpenAI Codex config
│   └── config.toml
├── .gemini/                # Gemini CLI config
│   └── settings.json
├── .config/opencode/       # OpenCode config
├── .ssh/                   # SSH keys (symlink or copy)
├── .gitconfig              # Git identity
└── .env                    # Profile-level secrets
```

**Isolation Mechanism**:
```typescript
// Session launch with profile overlay
const env = {
  ...process.env,                     // Inherit system PATH, binaries
  HOME: profileDir,                   // Override HOME for agent configs
  CLAUDE_CONFIG_DIR: `${profileDir}/.claude`,
  CODEX_HOME: `${profileDir}/.codex`,
  GEMINI_HOME: `${profileDir}/.gemini`,
  XDG_CONFIG_HOME: `${profileDir}/.config`,
  GIT_CONFIG: `${profileDir}/.gitconfig`,
  SSH_AUTH_SOCK: process.env.SSH_AUTH_SOCK,  // Maintain SSH agent
};
```

**Key insight**: Override `HOME` for agent-specific configs while maintaining system `PATH` for tool access.

### 5. Context Engineering Best Practices

> "Context engineering is the art and science of curating what will go into the limited context window from a constantly evolving universe of possible information."
> — [Anthropic: Effective Context Engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)

**Token Efficiency Strategies**:

1. **Dynamic Context Retrieval (RAG)**
   - Load files on demand rather than upfront
   - Claude Code maintains lightweight file identifiers
   - Uses grep/glob to retrieve relevant files as needed

2. **Context Compaction**
   - Summarize older events over sliding windows
   - Prune or de-prioritize raw events after summarization
   - Achieved 84% token reduction in Anthropic's evaluation

3. **Subagents for Complex Tasks**
   - Isolate heavy operations in separate context windows
   - Preserve main conversation context
   - Return concise summaries

4. **Configuration Files**
   - CLAUDE.md/AGENTS.md/GEMINI.md for persistent project knowledge
   - Avoid repeating instructions each turn

5. **Code Execution for Tool Chains**
   - Execute complex logic in single steps
   - Reduce intermediate tokens in context

### 6. MCP Protocol Status (2025)

> "In December 2025, Anthropic donated the MCP to the Agentic AI Foundation (AAIF), a directed fund under the Linux Foundation, co-founded by Anthropic, Block and OpenAI."
> — [Wikipedia: Model Context Protocol](https://en.wikipedia.org/wiki/Model_Context_Protocol)

**Adoption**:
- **Anthropic**: Native in Claude Code
- **OpenAI**: Integrated in Agents SDK (March 2025)
- **Google**: Confirmed for Gemini models (April 2025)
- **OpenCode**: Multi-provider MCP support

**2025-11-25 Specification Updates**:
- Asynchronous tasks for long-running operations
- OAuth support for machine-to-machine workflows
- Enhanced authorization controls

---

## Enhancement Categories

### Category A: Agent Configuration Management

#### A1. Multi-Agent Config File Editor
Create a unified UI for managing agent configuration files across providers.

**Features**:
- Tabbed editor for CLAUDE.md, AGENTS.md, GEMINI.md per folder
- Syntax highlighting with Markdown preview
- Real-time validation against schema
- Template library with project-type presets
- Inheritance visualization showing merged config from ancestor chain

**Database**:
```typescript
agentConfigs: {
  id: uuid primaryKey
  userId: uuid references users
  folderId: uuid references sessionFolders nullable
  provider: 'claude' | 'codex' | 'gemini'
  configType: 'CLAUDE.md' | 'AGENTS.md' | 'GEMINI.md'
  content: text
  createdAt: timestamp
  updatedAt: timestamp
}
```

**Implementation**:
- Store configs in database with file sync to profile directories
- Monaco editor component for rich editing
- Live preview of merged configuration

#### A2. Agent Config Templates
Pre-built configuration templates for common project types.

**Templates**:
- **TypeScript/Node.js**: ESLint, Prettier, Jest conventions
- **Python**: Ruff, mypy, pytest conventions
- **Rust**: Cargo, Clippy conventions
- **Go**: gofmt, go vet conventions
- **React/Next.js**: Component patterns, testing
- **API Development**: REST/GraphQL patterns

**Features**:
- Template marketplace/sharing between users
- Quick-start wizard for new folders
- Template versioning and updates
- Custom template creation

#### A3. Config Sync & Export
Synchronize configurations across machines and teams.

**Features**:
- Export folder configs as shareable packages (JSON/ZIP)
- Git integration: auto-commit config changes
- Team sync via git remote
- Import configs from URL or file
- Conflict resolution for team updates

---

### Category B: Authentication Profile Management

#### B1. Agent Profiles System
Core system for managing multiple agent identities.

**Features**:
- Profile CRUD with provider selection
- Profile switching per folder or session
- Default profile designation
- Profile cloning and templates

**Database**:
```typescript
agentProfiles: {
  id: uuid primaryKey
  userId: uuid references users
  name: text notNull
  description: text
  provider: 'claude' | 'codex' | 'gemini' | 'opencode' | 'all'
  configDir: text  // ~/.remote-dev/profiles/{id}/
  isDefault: boolean default false
  createdAt: timestamp
  updatedAt: timestamp
}

folderProfileLinks: {
  folderId: uuid references sessionFolders primaryKey
  profileId: uuid references agentProfiles
}
```

**UI Components**:
- Profile manager modal (create, edit, delete)
- Profile selector in session creation wizard
- Profile indicator in sidebar

#### B2. Credential Vault Extension
Extend existing Phase.dev secrets integration for per-profile API keys.

**Supported Credentials**:
- `ANTHROPIC_API_KEY` - Claude Code
- `OPENAI_API_KEY` - OpenAI Codex
- `GOOGLE_API_KEY` / `GEMINI_API_KEY` - Gemini CLI
- Provider-specific tokens for OpenCode

**Features**:
- Secure credential storage per profile
- Auto-inject credentials into session environment
- Credential rotation reminders
- Usage tracking per credential

**Implementation**:
- Extend `SecretsService` for profile-scoped secrets
- Add profile reference to `folderSecretsConfig`
- Secure credential retrieval during session launch

#### B3. Git Identity Management
Per-profile Git configuration for multi-account workflows.

**Features**:
- Per-profile `.gitconfig` with user.name, user.email
- SSH key management (symlink to profile or dedicated keys)
- GitHub account switching (multiple OAuth tokens)
- GPG key association per profile
- Automatic identity switching based on folder

**Implementation**:
```typescript
interface GitIdentity {
  userName: string;
  userEmail: string;
  sshKeyPath?: string;        // Path to private key
  gpgKeyId?: string;          // For commit signing
  githubUsername?: string;    // For OAuth token lookup
}
```

#### B4. Profile Isolation Implementation
Environment overlay system for complete profile isolation.

**Environment Variables**:
```typescript
const profileEnv = {
  // Core isolation
  HOME: profileDir,
  XDG_CONFIG_HOME: `${profileDir}/.config`,
  XDG_DATA_HOME: `${profileDir}/.local/share`,

  // Agent-specific overrides
  CLAUDE_CONFIG_DIR: `${profileDir}/.claude`,
  CODEX_HOME: `${profileDir}/.codex`,
  GEMINI_HOME: `${profileDir}/.gemini`,

  // Git isolation
  GIT_CONFIG: `${profileDir}/.gitconfig`,
  GIT_SSH_COMMAND: `ssh -i ${profileDir}/.ssh/id_ed25519`,

  // Preserve system access
  PATH: process.env.PATH,
  SSH_AUTH_SOCK: process.env.SSH_AUTH_SOCK,
};
```

**Profile Directory Initialization**:
1. Create directory structure
2. Symlink shared binaries if needed
3. Copy/generate agent configs
4. Set up SSH key links
5. Generate `.gitconfig`

---

### Category C: MCP Server Management

#### C1. MCP Server Registry
Database-backed registry for MCP servers with per-folder configuration.

**Database**:
```typescript
mcpServers: {
  id: uuid primaryKey
  userId: uuid references users
  folderId: uuid references sessionFolders nullable  // null = global
  name: text notNull
  transport: 'stdio' | 'http' | 'sse'
  command: text              // e.g., "npx -y @anthropic/mcp-server-git"
  args: text                 // JSON array
  env: text                  // JSON object
  enabled: boolean default true
  autoStart: boolean default false
  lastHealthCheck: timestamp
  createdAt: timestamp
  updatedAt: timestamp
}
```

**Inheritance**:
```
Global MCP Servers (folderId = null)
  ↓
User-level Servers
  ↓
Folder-specific Servers (highest priority)
```

**Features**:
- CRUD for MCP server configurations
- Per-folder server associations
- Enable/disable without deletion
- Configuration validation

#### C2. MCP Server Lifecycle Management
Runtime management of MCP server processes.

**Features**:
- Start/stop/restart individual servers
- Health monitoring with auto-restart
- Stdout/stderr logging per server
- Resource usage tracking (CPU, memory)
- Graceful shutdown handling

**Implementation**:
- Process manager for server lifecycle
- Health check intervals (configurable)
- Log rotation and retention
- Resource limits and alerts

#### C3. MCP Tool Discovery & Documentation
Auto-discover and document tools from connected MCP servers.

**Features**:
- List all tools from connected servers
- Generate tool documentation UI
- Tool usage analytics
- Tool search and filtering
- Schema validation for inputs

**Implementation**:
- Query `tools/list` from each server
- Cache tool definitions
- Parse JSON Schema for documentation
- Track tool invocation counts

#### C4. MCP Server Templates
Pre-configured servers for common use cases.

**Built-in Templates**:
- **Filesystem**: `@anthropic/mcp-server-filesystem`
- **Git**: `@anthropic/mcp-server-git`
- **GitHub**: `@modelcontextprotocol/server-github`
- **PostgreSQL**: `@modelcontextprotocol/server-postgres`
- **Browser**: `@anthropic/mcp-server-puppeteer`
- **Fetch**: `@anthropic/mcp-server-fetch`

**Features**:
- One-click installation from templates
- Template marketplace
- Custom template creation
- Template sharing

---

### Category D: Agent Session Enhancements

#### D1. Agent-Aware Session Creation
Enhanced session wizard with agent selection.

**Features**:
- Agent type selection (Claude/Codex/Gemini/OpenCode)
- Auto-configure environment for selected agent
- Profile selection during creation
- Agent-specific startup commands

**Startup Commands**:
- Claude: `claude --dangerously-skip-permissions`
- Codex: `codex --model gpt-5-codex`
- Gemini: `gemini --model gemini-3-pro`
- OpenCode: `opencode`

#### D2. Agent Command Palette
Quick-launch commands for agent operations.

**Commands**:
- `/claude` - Launch Claude Code in current session
- `/codex` - Launch OpenAI Codex
- `/gemini` - Launch Gemini CLI
- `/opencode` - Launch OpenCode
- `/agent <name>` - Launch by profile name

**Features**:
- Command history per agent type
- Favorite commands
- Custom command aliases
- Keyboard shortcuts

#### D3. Multi-Agent Orchestration
Coordinate multiple agents working together.

**Features**:
- Launch multiple agents in split panes
- Agent-to-agent communication via shared files
- Workflow templates for multi-agent tasks
- Supervisor agent pattern

**Use Cases**:
- Code review: One agent writes, another reviews
- Testing: One implements, another writes tests
- Documentation: One codes, another documents
- Debugging: Multiple perspectives on issues

#### D4. Session Recording for Agent Audit
Enhanced recording with agent activity tracking.

**Features**:
- Agent detection in recordings
- Action highlighting during playback
- Export recordings for debugging
- Recording annotations
- Searchable transcript

---

### Category E: Context & Token Optimization

#### E1. Context Budget Tracking
Monitor and optimize token usage across sessions.

**Features**:
- Real-time token count estimation
- Usage alerts at configurable thresholds
- Context compaction suggestions
- Historical usage analytics

**Implementation**:
- Token estimation using tiktoken
- Per-session token counters
- Threshold-based notifications
- Usage export for billing

#### E2. Dynamic Context Loading
Smart file inclusion for optimal context usage.

**Features**:
- Visual file tree for selective inclusion
- Auto-exclude patterns (node_modules, .git, binaries)
- Smart prioritization based on recent edits
- Context size preview

**Auto-Exclude Patterns**:
```
node_modules/
.git/
dist/
build/
*.min.js
*.map
*.lock
```

#### E3. Cross-Session Memory
Persistent notes and artifacts between sessions.

**Features**:
- Project-level scratchpad persisted to DB
- Import context from previous sessions
- Shared notes between sessions
- Memory search and retrieval

**Database**:
```typescript
sessionMemory: {
  id: uuid primaryKey
  userId: uuid references users
  folderId: uuid references sessionFolders nullable
  type: 'note' | 'artifact' | 'summary'
  title: text
  content: text
  tags: text  // JSON array
  createdAt: timestamp
  updatedAt: timestamp
}
```

---

### Category F: Monitoring & Analytics

#### F1. Agent Activity Dashboard
Comprehensive analytics for agent usage.

**Metrics**:
- Sessions per agent type
- Command frequency analysis
- Error rate tracking
- Average session duration
- Peak usage times

**Visualizations**:
- Time-series charts
- Agent comparison
- Usage heatmaps
- Trend analysis

#### F2. Cost Estimation
Track and estimate API costs.

**Features**:
- Token usage per provider
- Estimated API costs (configurable rates)
- Usage alerts and quotas
- Budget management
- Cost comparison between agents

**Cost Rates** (example, configurable):
```typescript
const costPerMillion = {
  'claude-opus-4': { input: 15, output: 75 },
  'claude-sonnet-4': { input: 3, output: 15 },
  'gpt-5-codex': { input: 5, output: 15 },
  'gemini-3-pro': { input: 1.25, output: 5 },
};
```

#### F3. Performance Metrics
Track agent performance characteristics.

**Metrics**:
- Time to first response
- Total response time
- Success/failure rates
- Context efficiency (tokens per task)
- Retry rates

---

### Category G: Integration & Extensibility

#### G1. IDE Integration
Connect Remote Dev with popular IDEs.

**Features**:
- VS Code extension for session management
- JetBrains plugin support
- Neovim integration via terminal
- Session URL scheme handlers

#### G2. Webhook & API Events
Event-driven integrations.

**Events**:
- Session created/closed
- Agent started/stopped
- Error occurred
- Recording completed

**Integrations**:
- Slack notifications
- Discord webhooks
- Custom HTTP endpoints
- Email alerts

#### G3. Plugin System
Extensible architecture for custom functionality.

**Plugin Types**:
- Agent providers
- MCP servers
- UI components
- Analytics modules

---

## Implementation Phases

### Phase 1: Foundation (Weeks 1-2)
| Task | Description | Priority |
|------|-------------|----------|
| B1 | Agent Profiles System with database schema | P1 |
| B4 | Profile Isolation with HOME override | P1 |
| DOCS | Create ENHANCEMENTS.md documentation | P1 |

### Phase 2: Authentication (Weeks 3-4)
| Task | Description | Priority |
|------|-------------|----------|
| B2 | Credential Vault Extension | P2 |
| B3 | Git Identity Management | P2 |
| A1 | Multi-Agent Config File Editor | P2 |

### Phase 3: MCP Enhancement (Weeks 5-6)
| Task | Description | Priority |
|------|-------------|----------|
| C1 | MCP Server Registry | P2 |
| C2 | MCP Lifecycle Management | P2 |
| C3 | MCP Tool Discovery | P2 |

### Phase 4: Agent Experience (Weeks 7-8)
| Task | Description | Priority |
|------|-------------|----------|
| D1 | Agent-Aware Session Creation | P3 |
| D2 | Agent Command Palette | P3 |
| A2 | Config Templates | P2 |

### Phase 5: Analytics (Weeks 9-10)
| Task | Description | Priority |
|------|-------------|----------|
| F1 | Activity Dashboard | P3 |
| E1 | Context Budget Tracking | P3 |
| F2 | Cost Estimation | P3 |

### Phase 6: Advanced (Weeks 11-12)
| Task | Description | Priority |
|------|-------------|----------|
| D3 | Multi-Agent Orchestration | P4 |
| E3 | Cross-Session Memory | P4 |
| G2 | Webhook & API Events | P4 |

---

## Database Schema

### New Tables

```sql
-- Agent Profiles
CREATE TABLE agent_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  provider TEXT CHECK (provider IN ('claude', 'codex', 'gemini', 'opencode', 'all')),
  config_dir TEXT NOT NULL,
  is_default BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Agent Configurations
CREATE TABLE agent_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  folder_id UUID REFERENCES session_folders(id) ON DELETE SET NULL,
  provider TEXT NOT NULL CHECK (provider IN ('claude', 'codex', 'gemini')),
  config_type TEXT NOT NULL CHECK (config_type IN ('CLAUDE.md', 'AGENTS.md', 'GEMINI.md')),
  content TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- MCP Servers
CREATE TABLE mcp_servers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  folder_id UUID REFERENCES session_folders(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  transport TEXT CHECK (transport IN ('stdio', 'http', 'sse')),
  command TEXT,
  args TEXT, -- JSON array
  env TEXT,  -- JSON object
  enabled BOOLEAN DEFAULT true,
  auto_start BOOLEAN DEFAULT false,
  last_health_check TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Folder-Profile Links
CREATE TABLE folder_profile_links (
  folder_id UUID PRIMARY KEY REFERENCES session_folders(id) ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES agent_profiles(id) ON DELETE CASCADE
);

-- Session Memory
CREATE TABLE session_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  folder_id UUID REFERENCES session_folders(id) ON DELETE SET NULL,
  type TEXT CHECK (type IN ('note', 'artifact', 'summary')),
  title TEXT,
  content TEXT,
  tags TEXT, -- JSON array
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX idx_agent_profiles_user ON agent_profiles(user_id);
CREATE INDEX idx_agent_configs_folder ON agent_configs(folder_id);
CREATE INDEX idx_mcp_servers_folder ON mcp_servers(folder_id);
CREATE INDEX idx_session_memory_folder ON session_memory(folder_id);
```

### Modified Tables

```sql
-- Add profile_id to terminal_sessions
ALTER TABLE terminal_sessions
  ADD COLUMN profile_id UUID REFERENCES agent_profiles(id) ON DELETE SET NULL;
```

---

## Technical Architecture

### Service Layer (New)

```
src/services/
├── agent-profile-service.ts    # Profile CRUD & isolation
├── agent-config-service.ts     # Config file management
├── git-identity-service.ts     # Git config per profile
└── mcp-registry-service.ts     # MCP server management
```

### API Routes (New)

```
src/app/api/
├── profiles/
│   ├── route.ts              # GET (list), POST (create)
│   └── [id]/
│       └── route.ts          # GET, PATCH, DELETE
├── agent-configs/
│   ├── route.ts              # GET, POST
│   └── [id]/
│       └── route.ts          # GET, PATCH, DELETE
└── mcp-servers/
    ├── route.ts              # GET, POST
    ├── [id]/
    │   └── route.ts          # GET, PATCH, DELETE
    └── [id]/
        ├── start/route.ts    # POST
        ├── stop/route.ts     # POST
        └── logs/route.ts     # GET
```

### UI Components (New)

```
src/components/
├── profiles/
│   ├── ProfileManager.tsx     # Profile CRUD modal
│   ├── ProfileForm.tsx        # Create/edit form
│   └── ProfileSelector.tsx    # Dropdown selector
├── config/
│   ├── AgentConfigEditor.tsx  # Tabbed config editor
│   ├── ConfigPreview.tsx      # Merged config preview
│   └── TemplateSelector.tsx   # Template picker
└── mcp/
    ├── MCPServerPanel.tsx     # Server management UI
    ├── MCPToolBrowser.tsx     # Tool discovery UI
    └── MCPServerForm.tsx      # Server configuration
```

### MCP Tools (New)

```
src/mcp/tools/
├── profile-tools.ts           # profile_list, profile_create, profile_switch
└── config-tools.ts            # config_get, config_set, config_merge
```

---

## Sources & References

### Official Documentation
- [Claude Code Best Practices](https://www.anthropic.com/engineering/claude-code-best-practices)
- [Using CLAUDE.md Files](https://claude.com/blog/using-claude-md-files)
- [OpenAI Codex CLI](https://developers.openai.com/codex/cli)
- [OpenAI AGENTS.md Guide](https://developers.openai.com/codex/guides/agents-md/)
- [Gemini CLI Documentation](https://developers.google.com/gemini-code-assist/docs/gemini-cli)
- [Gemini CLI GEMINI.md](https://google-gemini.github.io/gemini-cli/docs/cli/gemini-md.html)

### Open Source Projects
- [OpenCode](https://github.com/sst/opencode) - Multi-provider AI coding agent
- [Claude Code CLI Reference](https://code.claude.com/docs/en/cli-reference)
- [Gemini CLI GitHub](https://github.com/google-gemini/gemini-cli)
- [OpenAI Codex GitHub](https://github.com/openai/codex)

### Context Engineering
- [Effective Context Engineering for AI Agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- [Effective Harnesses for Long-Running Agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)
- [Code Execution with MCP](https://www.anthropic.com/engineering/code-execution-with-mcp)

### MCP Protocol
- [Model Context Protocol](https://www.anthropic.com/news/model-context-protocol)
- [MCP Specification 2025-11-25](https://mcp-bundler.com/2025/12/08/mcp-specification-end-users-server-providers/)
- [A Deep Dive Into MCP](https://a16z.com/a-deep-dive-into-mcp-and-the-future-of-ai-tooling/)

### Authentication & Identity
- [Multiple SSH Keys for GitHub](https://gist.github.com/oanhnn/80a89405ab9023894df7)
- [Managing Multiple Git Profiles](https://medium.com/@leroyleowdev/one-machine-many-identities-adding-effortlessly-switch-between-multiple-git-profiles-fd56a20bc181)

### Terminal Multiplexers
- [Tmux vs Screen Comparison](https://www.maketecheasier.com/tmux-vs-screen/)
- [Tmux MCP Server for AI Agents](https://skywork.ai/skypage/en/tmux-ai-engineer-terminal-automation/1980876083311476736)
- [Tmux and Claude AI Agent System](https://scuti.asia/combining-tmux-and-claude-to-build-an-automated-ai-agent-system-for-mac-linux/)

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2025-12-25 | Initial research and roadmap |

---

*This document is part of the Remote Dev project. For implementation status, see the beads tracker.*
