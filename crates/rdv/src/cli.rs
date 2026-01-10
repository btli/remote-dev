//! CLI argument definitions using clap derive macros.
//!
//! Command structure for multi-agent orchestration.

use clap::{Parser, Subcommand, Args};

/// Remote Dev Orchestration CLI
///
/// Multi-agent coordination with self-improvement capabilities.
#[derive(Parser, Debug)]
#[command(name = "rdv")]
#[command(author, version, about, long_about = None)]
#[command(propagate_version = true)]
pub struct Cli {
    #[command(subcommand)]
    pub command: Commands,
}

#[derive(Subcommand, Debug)]
pub enum Commands {
    /// Master Control management (system-wide orchestrator)
    Master(MasterCommand),

    /// Folder Orchestrator management (per-project)
    Folder(FolderCommand),

    /// Task lifecycle management
    Task(TaskCommand),

    /// Session management (spawn, attach, close)
    Session(SessionCommand),

    /// Monitoring service control
    Monitor(MonitorCommand),

    /// Self-improvement and learning commands
    Learn(LearnCommand),

    /// Mail system (inter-agent messages)
    Mail(MailCommand),

    /// Send real-time nudge to a session
    Nudge {
        /// Session ID to nudge
        session_id: String,
        /// Message to send
        message: String,
    },

    /// Escalate an issue
    Escalate(EscalateCommand),

    /// Peek at session health
    Peek {
        /// Session ID to check
        session_id: String,
    },

    /// Run diagnostics
    Doctor,

    /// Show system status (dashboard view)
    Status {
        /// Output as JSON
        #[arg(short, long)]
        json: bool,
    },

    /// Show version
    Version,
}

// ─────────────────────────────────────────────────────────────────────────────
// Master Control Commands
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Args, Debug)]
pub struct MasterCommand {
    #[command(subcommand)]
    pub action: MasterAction,
}

#[derive(Subcommand, Debug)]
pub enum MasterAction {
    /// Start Master Control
    Start {
        /// Run in foreground (don't daemonize)
        #[arg(short, long)]
        foreground: bool,
    },

    /// Stop Master Control
    Stop,

    /// Show Master Control status
    Status,

    /// Attach to Master Control session
    Attach,

    /// Initialize Master Control (first-time setup)
    Init,
}

// ─────────────────────────────────────────────────────────────────────────────
// Folder Orchestrator Commands
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Args, Debug)]
pub struct FolderCommand {
    #[command(subcommand)]
    pub action: FolderAction,
}

#[derive(Subcommand, Debug)]
pub enum FolderAction {
    /// Add folder to database (register for orchestration)
    Add {
        /// Path to folder (defaults to current directory)
        #[arg(default_value = ".")]
        path: String,

        /// Custom name for the folder (defaults to directory name)
        #[arg(short, long)]
        name: Option<String>,
    },

    /// Initialize folder orchestrator
    Init {
        /// Path to folder (defaults to current directory)
        #[arg(default_value = ".")]
        path: String,
    },

    /// Start folder orchestrator
    Start {
        /// Path to folder (defaults to current directory)
        #[arg(default_value = ".")]
        path: String,

        /// Run in foreground
        #[arg(short, long)]
        foreground: bool,
    },

    /// Stop folder orchestrator
    Stop {
        /// Path to folder (defaults to current directory)
        #[arg(default_value = ".")]
        path: String,
    },

    /// Show folder orchestrator status
    Status {
        /// Path to folder (defaults to current directory)
        #[arg(default_value = ".")]
        path: String,
    },

    /// Attach to folder orchestrator session
    Attach {
        /// Path to folder (defaults to current directory)
        #[arg(default_value = ".")]
        path: String,
    },

    /// List all folder orchestrators
    List,
}

// ─────────────────────────────────────────────────────────────────────────────
// Task Commands
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Args, Debug)]
pub struct TaskCommand {
    #[command(subcommand)]
    pub action: TaskAction,
}

#[derive(Subcommand, Debug)]
pub enum TaskAction {
    /// Create a new task from natural language
    Create {
        /// Task description in natural language
        description: String,

        /// Folder path for the task
        #[arg(short, long)]
        folder: Option<String>,

        /// Link to existing beads issue
        #[arg(short, long)]
        beads: Option<String>,
    },

    /// Plan task execution (agent selection, isolation)
    Plan {
        /// Task ID to plan
        task_id: String,

        /// Override agent selection
        #[arg(short, long)]
        agent: Option<String>,
    },

    /// Execute a planned task
    Execute {
        /// Task ID to execute
        task_id: String,
    },

    /// Cancel a task
    Cancel {
        /// Task ID to cancel
        task_id: String,

        /// Reason for cancellation
        #[arg(short, long)]
        reason: Option<String>,
    },

    /// List tasks
    List {
        /// Filter by status
        #[arg(short, long)]
        status: Option<String>,

        /// Filter by folder
        #[arg(short, long)]
        folder: Option<String>,

        /// Show all (including completed)
        #[arg(short, long)]
        all: bool,
    },

    /// Show task details
    Show {
        /// Task ID
        task_id: String,
    },
}

// ─────────────────────────────────────────────────────────────────────────────
// Session Commands
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Args, Debug)]
pub struct SessionCommand {
    #[command(subcommand)]
    pub action: SessionAction,
}

#[derive(Subcommand, Debug)]
pub enum SessionAction {
    /// Spawn a new task session
    Spawn {
        /// Folder path
        folder: String,

        /// Agent to use (claude, codex, gemini, opencode)
        #[arg(short, long, default_value = "claude")]
        agent: String,

        /// Create worktree for isolation
        #[arg(short, long)]
        worktree: bool,

        /// Branch name for worktree
        #[arg(short, long)]
        branch: Option<String>,

        /// Session name
        #[arg(short, long)]
        name: Option<String>,
    },

    /// List sessions
    List {
        /// Filter by folder
        #[arg(short, long)]
        folder: Option<String>,

        /// Show all (including closed)
        #[arg(short, long)]
        all: bool,
    },

    /// Attach to a session
    Attach {
        /// Session ID
        session_id: String,
    },

    /// Inject context into a session
    Inject {
        /// Session ID
        session_id: String,

        /// Context to inject
        context: String,
    },

    /// Close a session
    Close {
        /// Session ID
        session_id: String,

        /// Force close (kill immediately)
        #[arg(short, long)]
        force: bool,
    },

    /// Get session scrollback
    Scrollback {
        /// Session ID
        session_id: String,

        /// Number of lines
        #[arg(short, long, default_value = "100")]
        lines: u32,
    },
}

// ─────────────────────────────────────────────────────────────────────────────
// Monitor Commands
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Args, Debug)]
pub struct MonitorCommand {
    #[command(subcommand)]
    pub action: MonitorAction,
}

#[derive(Subcommand, Debug)]
pub enum MonitorAction {
    /// Start monitoring service
    Start {
        /// Monitoring interval in seconds
        #[arg(short, long, default_value = "30")]
        interval: u64,

        /// Run in foreground
        #[arg(short, long)]
        foreground: bool,
    },

    /// Stop monitoring service
    Stop,

    /// Show monitoring status
    Status,

    /// Check specific session health
    Check {
        /// Session ID
        session_id: String,
    },
}

// ─────────────────────────────────────────────────────────────────────────────
// Learn Commands (Self-Improvement)
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Args, Debug)]
pub struct LearnCommand {
    #[command(subcommand)]
    pub action: LearnAction,
}

#[derive(Subcommand, Debug)]
pub enum LearnAction {
    /// Analyze session transcript
    Analyze {
        /// Session ID to analyze
        session_id: String,

        /// Save learnings to project knowledge
        #[arg(short, long)]
        save: bool,
    },

    /// Extract learnings from folder
    Extract {
        /// Folder path
        #[arg(default_value = ".")]
        path: String,
    },

    /// Apply learnings to agent configs
    Apply {
        /// Folder path
        #[arg(default_value = ".")]
        path: String,

        /// Dry run (show changes without applying)
        #[arg(short, long)]
        dry_run: bool,
    },

    /// Show project knowledge
    Show {
        /// Folder path
        #[arg(default_value = ".")]
        path: String,
    },

    /// List all learnings
    List {
        /// Filter by type (convention, pattern, skill, tool)
        #[arg(short, long)]
        r#type: Option<String>,

        /// Filter by folder
        #[arg(short, long)]
        folder: Option<String>,
    },
}

// ─────────────────────────────────────────────────────────────────────────────
// Mail Commands
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Args, Debug)]
pub struct MailCommand {
    #[command(subcommand)]
    pub action: MailAction,
}

#[derive(Subcommand, Debug)]
pub enum MailAction {
    /// Show inbox
    Inbox {
        /// Show unread only
        #[arg(short, long)]
        unread: bool,
    },

    /// Read a message
    Read {
        /// Message ID
        message_id: String,
    },

    /// Send a message
    Send {
        /// Target address (e.g., folder/session or master)
        target: String,

        /// Message subject
        #[arg(short, long)]
        subject: String,

        /// Message body
        #[arg(short, long)]
        message: String,
    },

    /// Mark message as read
    Mark {
        /// Message ID
        message_id: String,
    },
}

// ─────────────────────────────────────────────────────────────────────────────
// Escalate Command
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Args, Debug)]
pub struct EscalateCommand {
    /// Topic/description of the escalation
    pub topic: String,

    /// Severity level
    #[arg(short, long, default_value = "MEDIUM")]
    pub severity: String,

    /// Additional message
    #[arg(short, long)]
    pub message: Option<String>,

    /// Related issue ID
    #[arg(short, long)]
    pub issue: Option<String>,
}
