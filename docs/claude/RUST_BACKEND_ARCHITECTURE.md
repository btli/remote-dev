# Rust Backend Architecture

**Date:** 2025-01-10
**Status:** Design Phase
**Author:** Claude (with Bryan Li)

## Overview

This document describes the architecture for migrating Remote Dev's backend from Next.js API routes to a Rust-based backend server. The goals are:

1. **Code consolidation** - Share logic between rdv CLI and backend
2. **Performance** - Rust for compute-intensive operations (tmux, git, monitoring)
3. **Unix sockets** - No exposed ports for internal communication
4. **Security** - Inter-service authentication, process isolation

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           EXTERNAL ACCESS                                │
│                      (Cloudflare Zero Trust)                            │
│                                                                         │
│  • Cloudflare Access validates user identity                            │
│  • CF_Authorization cookie/header passed to Next.js                     │
│  • Only Next.js is externally accessible                                │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         NEXT.JS FRONTEND                                 │
│                                                                         │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐         │
│  │   React UI      │  │  Auth Middleware │  │  API Proxy      │         │
│  │   (xterm.js,    │  │  (CF Access +    │  │  (Unix Socket   │         │
│  │   shadcn/ui)    │  │   Service Token) │  │   Forwarding)   │         │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘         │
│                                                                         │
│  Responsibilities:                                                      │
│  • Serve React SPA                                                      │
│  • Validate Cloudflare Access headers                                   │
│  • Proxy API requests with service token                                │
│  • Proxy WebSocket connections                                          │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                     Unix Sockets + Service Token
                                    │
                    ┌───────────────┴───────────────┐
                    ▼                               ▼
     ┌──────────────────────────┐    ┌──────────────────────────┐
     │   ~/.remote-dev/run/api.sock        │    │  ~/.remote-dev/run/terminal.sock    │
     │   (REST API)             │    │  (WebSocket terminals)   │
     │   Mode: 0600             │    │  Mode: 0600              │
     └──────────────────────────┘    └──────────────────────────┘
                    │                               │
                    └───────────────┬───────────────┘
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        RUST BACKEND (rdv-server)                         │
│                                                                         │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐         │
│  │  Auth Layer     │  │  API Routes     │  │  WebSocket      │         │
│  │  (Token Valid.) │  │  (axum)         │  │  Handler        │         │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘         │
│                                                                         │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐         │
│  │  Session Mgmt   │  │  Worktree Mgmt  │  │  Orchestrator   │         │
│  │  (rdv-core)     │  │  (rdv-core)     │  │  (rdv-core)     │         │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘         │
│                                                                         │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐         │
│  │  MCP Server     │  │  tmux Gateway   │  │  Learning Svc   │         │
│  │  (rdv-core)     │  │  (rdv-core)     │  │  (rdv-core)     │         │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘         │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┼───────────────┐
                    ▼               ▼               ▼
              ┌──────────┐   ┌──────────┐   ┌──────────────┐
              │  SQLite  │   │   tmux   │   │ git/worktrees│
              │ sqlite.db│   │ sessions │   │              │
              └──────────┘   └──────────┘   └──────────────┘


┌─────────────────────────────────────────────────────────────────────────┐
│                           RDV CLI                                        │
│                                                                         │
│  ┌─────────────────┐  ┌─────────────────┐                               │
│  │  CLI Commands   │  │  Socket Client  │                               │
│  │  (clap)         │  │  (HTTP client)  │                               │
│  └─────────────────┘  └─────────────────┘                               │
│                                                                         │
│  • Connects to rdv-server via unix socket (NO direct DB access)         │
│  • Uses CLI token for authentication                                    │
│  • rdv-server must be running for CLI to function                       │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│                       MCP CLIENTS (Claude Desktop, Cursor)               │
│                                                                         │
│  • Connect to rdv-server via MCP protocol (stdio)                       │
│  • Use API key for authentication                                       │
│  • rdv-server exposes MCP server directly                               │
└─────────────────────────────────────────────────────────────────────────┘
```

## Security Model

### 1. Authentication Layers

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         AUTHENTICATION FLOW                              │
└─────────────────────────────────────────────────────────────────────────┘

EXTERNAL USER → CLOUDFLARE ACCESS → NEXT.JS → RUST BACKEND
     │                │                │              │
     │                ▼                │              │
     │         [CF_Authorization]      │              │
     │         JWT with user identity  │              │
     │                                 ▼              │
     │                          [Validate CF JWT]     │
     │                          Extract user_id       │
     │                                 │              │
     │                                 ▼              │
     │                          [Add Service Token]   │
     │                          X-RDV-Service-Token   │
     │                          X-RDV-User-ID         │
     │                                 │              │
     │                                 └──────────────▶ [Validate Token]
     │                                                  [Check User]
     │                                                  [Process Request]

RDV CLI → RUST BACKEND
     │          │
     ▼          │
[CLI Token]     │
(from config)   │
     │          │
     └──────────▶ [Validate CLI Token]
                  [Map to User]
                  [Process Request]

MCP CLIENT → RUST BACKEND (stdio)
     │            │
     ▼            │
[API Key]        │
(from config)    │
     │            │
     └────────────▶ [Validate API Key]
                    [Map to User]
                    [Process MCP Request]
```

### 2. Token Types

#### Service Token (Next.js → Rust Backend)

```rust
/// Service token for Next.js to Rust backend communication
/// Generated at startup, shared via environment or file
pub struct ServiceToken {
    /// Random 256-bit token
    pub token: [u8; 32],
    /// Creation timestamp (for rotation)
    pub created_at: SystemTime,
    /// Token ID for logging/revocation
    pub token_id: Uuid,
}

impl ServiceToken {
    /// Generate a new service token
    pub fn generate() -> Self {
        Self {
            token: rand::random(),
            created_at: SystemTime::now(),
            token_id: Uuid::new_v4(),
        }
    }

    /// Write token to file with restricted permissions (0600)
    pub fn write_to_file(&self, path: &Path) -> Result<()> {
        let encoded = base64::encode(&self.token);
        fs::write(path, &encoded)?;
        fs::set_permissions(path, Permissions::from_mode(0o600))?;
        Ok(())
    }
}
```

#### CLI Token (rdv CLI → Rust Backend)

```rust
/// CLI token for rdv CLI authentication
/// Generated per-user, stored in ~/.remote-dev/cli-token
pub struct CLIToken {
    /// Random 256-bit token
    pub token: [u8; 32],
    /// Associated user ID
    pub user_id: Uuid,
    /// Token name/description
    pub name: String,
    /// Creation timestamp
    pub created_at: SystemTime,
    /// Last used timestamp
    pub last_used_at: Option<SystemTime>,
    /// Expiration (optional)
    pub expires_at: Option<SystemTime>,
}
```

### 3. Token Storage

```
~/.remote-dev/
├── config.toml           # CLI/server configuration
├── sqlite.db             # Database
├── cli-token             # CLI authentication token (mode 0600)
├── run/                  # Runtime files (sockets)
│   ├── api.sock          # rdv-server REST API (mode 0600)
│   ├── terminal.sock     # Node.js terminal server (mode 0600)
│   └── nextjs.sock       # Next.js server (mode 0600)
└── server/
    ├── service-token     # Service token for Next.js (mode 0600)
    ├── server.pid        # Server PID file
    └── server.log        # Server logs
```

### 4. Socket Security

```rust
/// Create a unix socket with proper permissions
pub fn create_secure_socket(path: &Path) -> Result<UnixListener> {
    // Remove existing socket if present
    if path.exists() {
        fs::remove_file(path)?;
    }

    // Create parent directory with restricted permissions
    let parent = path.parent().ok_or(Error::InvalidPath)?;
    fs::create_dir_all(parent)?;
    fs::set_permissions(parent, Permissions::from_mode(0o700))?;

    // Bind socket
    let listener = UnixListener::bind(path)?;

    // Set socket permissions (owner read/write only)
    fs::set_permissions(path, Permissions::from_mode(0o600))?;

    Ok(listener)
}
```

### 5. Request Authentication

```rust
/// Authentication middleware for axum
pub async fn auth_middleware(
    State(state): State<AppState>,
    mut request: Request,
    next: Next,
) -> Result<Response, AuthError> {
    // Extract token from header
    let token = request
        .headers()
        .get("X-RDV-Service-Token")
        .or_else(|| request.headers().get("Authorization"))
        .ok_or(AuthError::MissingToken)?;

    // Validate token
    let token_str = token.to_str().map_err(|_| AuthError::InvalidToken)?;
    let token_bytes = base64::decode(token_str.trim_start_matches("Bearer "))
        .map_err(|_| AuthError::InvalidToken)?;

    // Check against known tokens
    let auth_context = if state.service_token.verify(&token_bytes) {
        // Service token - extract user from header
        let user_id = request
            .headers()
            .get("X-RDV-User-ID")
            .and_then(|v| v.to_str().ok())
            .and_then(|s| Uuid::parse_str(s).ok())
            .ok_or(AuthError::MissingUserId)?;

        AuthContext::Service { user_id }
    } else if let Some(cli_token) = state.cli_tokens.validate(&token_bytes) {
        // CLI token - user is embedded in token
        AuthContext::CLI {
            user_id: cli_token.user_id,
            token_id: cli_token.token_id,
        }
    } else {
        return Err(AuthError::InvalidToken);
    };

    // Add auth context to request extensions
    request.extensions_mut().insert(auth_context);

    Ok(next.run(request).await)
}
```

## Process Safety

### 1. Startup Sequence

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         STARTUP SEQUENCE                                 │
└─────────────────────────────────────────────────────────────────────────┘

1. rdv-server starts
   │
   ├─► Check for existing PID file
   │   └─► If exists and process running → Exit with error
   │   └─► If exists and process dead → Clean up stale files
   │
   ├─► Generate service token
   │   └─► Write to ~/.remote-dev/server/service-token (mode 0600)
   │
   ├─► Create unix sockets
   │   ├─► ~/.remote-dev/run/api.sock (mode 0600)
   │   └─► ~/.remote-dev/run/terminal.sock (mode 0600)
   │
   ├─► Initialize database connection
   │   └─► Run migrations if needed
   │
   ├─► Start background services
   │   ├─► Monitoring service (stall detection)
   │   ├─► Cleanup service (trash expiration)
   │   └─► Health check service
   │
   ├─► Write PID file
   │   └─► ~/.remote-dev/server/server.pid
   │
   └─► Ready to accept connections

2. Next.js starts
   │
   ├─► Read service token from ~/.remote-dev/server/service-token
   │   └─► Retry with backoff if not available
   │
   ├─► Verify rdv-server is running
   │   └─► Health check via unix socket
   │
   └─► Ready to proxy requests
```

### 2. Graceful Shutdown

```rust
/// Handle shutdown signals gracefully
pub async fn shutdown_handler(
    state: Arc<AppState>,
    mut shutdown_rx: broadcast::Receiver<()>,
) {
    // Wait for shutdown signal
    let _ = shutdown_rx.recv().await;

    info!("Shutdown signal received, starting graceful shutdown");

    // 1. Stop accepting new connections
    state.accepting.store(false, Ordering::SeqCst);

    // 2. Wait for active requests to complete (with timeout)
    let timeout = Duration::from_secs(30);
    let start = Instant::now();

    while state.active_requests.load(Ordering::SeqCst) > 0 {
        if start.elapsed() > timeout {
            warn!("Shutdown timeout, forcing close");
            break;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }

    // 3. Close WebSocket connections gracefully
    for (session_id, ws) in state.terminal_connections.iter() {
        if let Err(e) = ws.close(CloseFrame {
            code: CloseCode::Away,
            reason: "Server shutting down".into(),
        }).await {
            warn!("Failed to close WebSocket {}: {}", session_id, e);
        }
    }

    // 4. Stop background services
    state.monitoring_service.stop().await;
    state.cleanup_service.stop().await;

    // 5. Clean up socket files
    let _ = fs::remove_file(&state.config.api_socket_path);
    let _ = fs::remove_file(&state.config.terminal_socket_path);

    // 6. Remove PID file
    let _ = fs::remove_file(&state.config.pid_file_path);

    info!("Graceful shutdown complete");
}
```

### 3. Crash Recovery

```rust
/// Check for and recover from previous crash
pub fn check_crash_recovery(config: &Config) -> Result<CrashRecoveryAction> {
    let pid_file = &config.pid_file_path;

    if !pid_file.exists() {
        return Ok(CrashRecoveryAction::None);
    }

    // Read PID from file
    let pid_str = fs::read_to_string(pid_file)?;
    let pid: i32 = pid_str.trim().parse()?;

    // Check if process is still running
    if process_exists(pid) {
        return Err(Error::ServerAlreadyRunning { pid });
    }

    // Previous instance crashed - clean up
    warn!("Detected crash of previous instance (PID {})", pid);

    // Clean up stale files
    let _ = fs::remove_file(pid_file);
    let _ = fs::remove_file(&config.api_socket_path);
    let _ = fs::remove_file(&config.terminal_socket_path);

    // Check for orphaned tmux sessions
    let orphaned = find_orphaned_sessions()?;
    if !orphaned.is_empty() {
        warn!("Found {} orphaned tmux sessions", orphaned.len());
    }

    Ok(CrashRecoveryAction::CleanedUp {
        orphaned_sessions: orphaned
    })
}
```

### 4. Health Checks

```rust
/// Health check endpoint
pub async fn health_check(State(state): State<AppState>) -> Json<HealthStatus> {
    let db_healthy = state.db.ping().await.is_ok();
    let tmux_healthy = tmux::check_tmux().is_ok();

    let active_sessions = state.db.count_active_sessions().await.unwrap_or(0);
    let ws_connections = state.terminal_connections.len();

    Json(HealthStatus {
        status: if db_healthy && tmux_healthy { "healthy" } else { "degraded" },
        version: env!("CARGO_PKG_VERSION"),
        uptime_seconds: state.start_time.elapsed().as_secs(),
        components: HealthComponents {
            database: db_healthy,
            tmux: tmux_healthy,
        },
        metrics: HealthMetrics {
            active_sessions,
            websocket_connections: ws_connections,
            pending_requests: state.active_requests.load(Ordering::SeqCst),
        },
    })
}
```

## Crate Structure

```
crates/
├── rdv-core/                    # Shared library
│   ├── Cargo.toml
│   └── src/
│       ├── lib.rs
│       ├── db/
│       │   ├── mod.rs
│       │   ├── schema.rs        # SQLite schema
│       │   ├── session.rs       # Session queries
│       │   ├── folder.rs        # Folder queries
│       │   ├── orchestrator.rs  # Orchestrator queries
│       │   └── migrations/      # SQL migrations
│       ├── tmux/
│       │   ├── mod.rs
│       │   ├── session.rs       # Session management
│       │   ├── capture.rs       # Scrollback capture
│       │   └── inject.rs        # Command injection
│       ├── worktree/
│       │   ├── mod.rs
│       │   ├── create.rs        # Worktree creation
│       │   ├── remove.rs        # Worktree removal
│       │   └── status.rs        # Worktree status
│       ├── session/
│       │   ├── mod.rs
│       │   ├── lifecycle.rs     # Create/suspend/resume/close
│       │   ├── spawn.rs         # Agent/shell spawning
│       │   └── env.rs           # Environment variable injection
│       ├── orchestrator/
│       │   ├── mod.rs
│       │   ├── monitoring.rs    # Stall detection
│       │   ├── insights.rs      # Insight generation
│       │   └── injection.rs     # Command injection safety
│       ├── auth/
│       │   ├── mod.rs
│       │   ├── token.rs         # Token generation/validation
│       │   └── context.rs       # Auth context
│       ├── mcp/
│       │   ├── mod.rs
│       │   ├── protocol.rs      # MCP protocol handling
│       │   ├── tools.rs         # Tool definitions
│       │   └── resources.rs     # Resource definitions
│       └── error.rs             # Shared error types
│
├── rdv/                         # CLI binary
│   ├── Cargo.toml
│   └── src/
│       ├── main.rs
│       ├── cli.rs               # Clap definitions
│       ├── client.rs            # Unix socket client
│       └── commands/
│           ├── mod.rs
│           ├── session.rs
│           ├── folder.rs
│           ├── master.rs
│           └── ...
│
└── rdv-server/                  # Server binary
    ├── Cargo.toml
    └── src/
        ├── main.rs
        ├── config.rs            # Server configuration
        ├── state.rs             # Application state
        ├── middleware/
        │   ├── mod.rs
        │   ├── auth.rs          # Authentication middleware
        │   ├── logging.rs       # Request logging
        │   └── rate_limit.rs    # Rate limiting
        ├── routes/
        │   ├── mod.rs
        │   ├── sessions.rs      # /api/sessions/*
        │   ├── folders.rs       # /api/folders/*
        │   ├── worktrees.rs     # /api/worktrees/*
        │   ├── orchestrators.rs # /api/orchestrators/*
        │   ├── preferences.rs   # /api/preferences/*
        │   └── health.rs        # /health
        ├── ws/
        │   ├── mod.rs
        │   ├── terminal.rs      # Terminal WebSocket handler
        │   └── mcp.rs           # MCP WebSocket handler
        └── services/
            ├── mod.rs
            ├── monitoring.rs    # Background monitoring
            └── cleanup.rs       # Background cleanup
```

## API Endpoints

### Sessions

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/sessions | List sessions |
| POST | /api/sessions | Create session |
| GET | /api/sessions/:id | Get session |
| PATCH | /api/sessions/:id | Update session |
| DELETE | /api/sessions/:id | Close session |
| POST | /api/sessions/:id/suspend | Suspend session |
| POST | /api/sessions/:id/resume | Resume session |
| POST | /api/sessions/:id/exec | Execute command |
| GET | /api/sessions/:id/scrollback | Get scrollback |

### Folders

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/folders | List folders |
| POST | /api/folders | Create folder |
| GET | /api/folders/:id | Get folder |
| PATCH | /api/folders/:id | Update folder |
| DELETE | /api/folders/:id | Delete folder |
| GET | /api/folders/:id/children | Get child folders |
| GET | /api/folders/:id/context | Get full context |

### Worktrees

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/worktrees | List worktrees for repo |
| POST | /api/worktrees | Create worktree |
| DELETE | /api/worktrees | Remove worktree |
| GET | /api/worktrees/status | Get worktree status |

### Orchestrators

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/orchestrators | List orchestrators |
| POST | /api/orchestrators | Create orchestrator |
| GET | /api/orchestrators/:id | Get orchestrator |
| PATCH | /api/orchestrators/:id | Update orchestrator |
| DELETE | /api/orchestrators/:id | Delete orchestrator |
| GET | /api/orchestrators/:id/insights | Get insights |
| POST | /api/orchestrators/:id/inject | Inject command |

## WebSocket Endpoints

### Terminal WebSocket

```
ws://unix:~/.remote-dev/run/terminal.sock:/ws/terminal/:session_id
```

**Messages:**

```rust
// Client → Server
enum ClientMessage {
    Input { data: String },
    Resize { cols: u16, rows: u16 },
    Ping,
}

// Server → Client
enum ServerMessage {
    Output { data: String },
    Exit { code: i32 },
    Error { message: String },
    Pong,
}
```

### MCP WebSocket

```
ws://unix:~/.remote-dev/run/terminal.sock:/ws/mcp
```

Standard MCP protocol over WebSocket.

## Migration Plan

### Phase 1: Core Infrastructure ✅ COMPLETE

1. ✅ Create `rdv-core` crate structure
2. ✅ Move database code from current rdv to rdv-core
3. ✅ Move tmux code to rdv-core
4. ✅ Add authentication module
5. ✅ Create basic `rdv-server` with health endpoint

### Phase 2: API Migration ✅ COMPLETE

#### Sessions API
- ✅ `GET/POST /sessions` - Proxied to rdv-server
- ✅ `GET/PATCH/DELETE /sessions/:id` - Proxied to rdv-server
- ✅ `POST /sessions/:id/suspend` - Proxied to rdv-server
- ✅ `POST /sessions/:id/resume` - Proxied to rdv-server
- ✅ `POST /sessions/:id/exec` - Proxied to rdv-server
- ✅ `PUT /sessions/:id/folder` - Proxied to rdv-server
- ✅ `POST /sessions/reorder` - Proxied to rdv-server
- ✅ `GET /sessions/:id/token` - Hybrid (verify via rdv-server, token gen in Node.js)

#### Folders API
- ✅ `GET/POST /folders` - Proxied to rdv-server
- ✅ `GET/PATCH/DELETE /folders/:id` - Proxied to rdv-server
- ✅ `POST /folders/reorder` - Proxied to rdv-server
- ✅ `GET/POST/DELETE /folders/:id/orchestrator` - Proxied to rdv-server
- ✅ `GET /folders/:id/hooks` - Proxied to rdv-server
- ⚠️ `POST/DELETE /folders/:id/hooks` - Intentionally TypeScript (generates Node.js/Python scripts)
- ✅ `GET/PATCH/DELETE /folders/:id/knowledge` - Proxied to rdv-server

#### Orchestrators API
- ✅ `GET/POST /orchestrators` - Proxied to rdv-server
- ✅ `GET/PATCH/DELETE /orchestrators/:id` - Proxied to rdv-server
- ✅ `POST /orchestrators/:id/pause` - Proxied to rdv-server
- ✅ `POST /orchestrators/:id/resume` - Proxied to rdv-server
- ✅ `GET /orchestrators/:id/insights` - Proxied to rdv-server
- ✅ `POST /orchestrators/:id/commands` - Proxied to rdv-server (maps to /inject)
- ✅ `GET /orchestrators/:id/audit` - Proxied to rdv-server
- ✅ `GET /orchestrators/health` - Proxied to rdv-server
- ✅ `GET/POST /orchestrators/agent-event` - Proxied to rdv-server (no auth)
- ✅ `POST /orchestrators/reinitialize` - Proxied to rdv-server
- ✅ Monitoring routes: `/orchestrators/:id/monitoring/{start,stop,status}` - rdv-server
- ✅ Insight routes: `/insights/:id`, `/insights/:id/resolve`, `/insights/cleanup` - rdv-server
- ✅ InsightService - Full implementation in rdv-server

#### Worktrees API
- ⚠️ All routes remain TypeScript - path mismatch (`/github/worktrees` vs `/worktrees`)
- rdv-server has endpoints at different paths - intentional design decision

#### Business Logic (Deferred)
These items were considered but are not essential for core operation:
- ⬜ Orchestrator auto-init (remote-dev-3ffb) - Low priority
- ⬜ Folder Control auto-spin (remote-dev-o830) - Low priority
- ⬜ Project metadata enrichment (remote-dev-sjod) - Low priority
- ⬜ Learning extraction (remote-dev-o35q) - Low priority
- ⬜ Worktree cleanup (remote-dev-y9fv) - Low priority

### Phase 3: MCP Migration

1. ⬜ Implement MCP server in rdv-server (remote-dev-6r09)
2. ⬜ Remove TypeScript MCP implementation
3. ⬜ Test MCP functionality with Claude Desktop/Cursor

### Phase 4: CLI Migration ✅ COMPLETE

1. ✅ Remove direct DB access from rdv CLI - All commands now use ApiClient
2. ✅ Create socket client in rdv-core - `ApiClient` implementation complete
3. ✅ Implement CLI token management - `rdv auth login/logout/status` commands
4. ✅ Migrate rdv commands to socket client - Session, folder, orchestrator commands all use ApiClient
5. ✅ Internal auth for CLI and MCP - Service token and CLI token authentication working

### Phase 5: Infrastructure

1. ⬜ Configure Next.js to listen on Unix socket (remote-dev-c69e)
2. ⬜ Create cloudflared configuration (remote-dev-ulby)

### Phase 6: Cleanup

1. ⬜ Remove TypeScript business logic services
2. ⬜ Remove unused TypeScript code
3. ⬜ Integration testing
4. ⬜ Security audit

## Configuration

### rdv-server Configuration

```toml
# ~/.remote-dev/server/config.toml

[server]
api_socket = "~/.remote-dev/run/api.sock"
terminal_socket = "~/.remote-dev/run/terminal.sock"
pid_file = "~/.remote-dev/server/server.pid"
log_file = "~/.remote-dev/server/server.log"

[database]
path = "~/.remote-dev/sqlite.db"
max_connections = 10

[auth]
service_token_file = "~/.remote-dev/server/service-token"
token_rotation_days = 30

[monitoring]
interval_seconds = 30
stall_threshold_seconds = 300

[cleanup]
trash_retention_days = 30
cleanup_interval_hours = 24
```

### Next.js Configuration

```typescript
// next.config.ts
export default {
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `http://unix:${process.env.RDV_API_SOCKET || '~/.remote-dev/run/api.sock'}:/:path*`,
      },
    ];
  },
};
```

## Security Considerations

### 1. Socket Permissions

- All sockets created with mode 0600 (owner read/write only)
- Parent directory with mode 0700
- Sockets owned by the user running the server

### 2. Token Security

- Service tokens are 256-bit random
- Tokens stored in files with mode 0600
- Token rotation supported (configurable interval)
- Tokens never logged or exposed in errors

### 3. Input Validation

- All API inputs validated with strict schemas
- Command injection prevention for tmux operations
- Path traversal prevention for file operations
- SQL injection prevention via parameterized queries

### 4. Rate Limiting

- Per-token rate limiting
- Separate limits for different endpoint categories
- Automatic backoff for repeated failures

### 5. Audit Logging

- All authentication attempts logged
- All sensitive operations logged
- Logs include token ID (not token value) for traceability

## Open Questions

1. **Token Rotation**: How to handle token rotation without downtime?
2. **Multi-User**: Should we support multiple users on same machine?
3. **Remote Access**: Future support for remote rdv-server access?
4. **Clustering**: Any need for multiple rdv-server instances?

## References

- [Gastown Architecture](https://github.com/steveyegge/gastown)
- [axum Web Framework](https://github.com/tokio-rs/axum)
- [Unix Socket in Rust](https://doc.rust-lang.org/std/os/unix/net/index.html)
- [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/identity/access/)
