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
    /// Authentication management (CLI token)
    Auth(AuthCommand),

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

    /// Hierarchical memory system (store, recall, forget)
    Memory(MemoryCommand),

    /// Quick note capture (convenience for memory operations)
    Note(NoteCommand),

    /// Structured note-taking system (add, search, summarize, insights)
    Notes(NotesCommand),

    /// Project knowledge base (conventions, patterns, skills, gotchas)
    Knowledge(KnowledgeCommand),

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

    /// View orchestrator insights (stall detection, errors, suggestions)
    Insights(InsightsCommand),

    /// Extension management (list, enable, disable, create)
    Ext(ExtCommand),

    /// Show system status (dashboard view)
    Status {
        /// Output as JSON
        #[arg(short, long)]
        json: bool,
    },

    /// Meta-agent configuration optimization (BUILD → TEST → IMPROVE)
    Meta(MetaCommand),

    /// Show version
    Version,
}

// ─────────────────────────────────────────────────────────────────────────────
// Authentication Commands
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Args, Debug)]
pub struct AuthCommand {
    #[command(subcommand)]
    pub action: AuthAction,
}

#[derive(Subcommand, Debug)]
pub enum AuthAction {
    /// Login to rdv-server (register CLI token)
    Login {
        /// Custom name for the token (defaults to rdv-cli-{hostname})
        #[arg(short, long)]
        name: Option<String>,
    },

    /// Logout (revoke CLI token)
    Logout,

    /// Show authentication status
    Status,
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
        /// Project path (filesystem directory)
        #[arg(default_value = ".")]
        path: String,

        /// Agent to use (claude, codex, gemini, opencode, none)
        #[arg(short, long, default_value = "claude")]
        agent: String,

        /// Spawn a shell session instead of an agent session
        #[arg(short, long)]
        shell: bool,

        /// Create worktree for isolation
        #[arg(short = 'W', long)]
        worktree: bool,

        /// Branch name for worktree
        #[arg(short, long)]
        branch: Option<String>,

        /// Session name
        #[arg(short, long)]
        name: Option<String>,

        /// Sidebar folder name or ID to associate session with
        #[arg(short, long)]
        folder: Option<String>,

        /// Additional flags to pass to the agent CLI
        #[arg(short = 'F', long = "flag", action = clap::ArgAction::Append)]
        flags: Vec<String>,

        /// Skip permission prompts (adds --dangerously-skip-permissions for claude)
        #[arg(long)]
        dangerously_skip_permissions: bool,
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

    /// Respawn a dead pane (restart the process)
    Respawn {
        /// Session ID or tmux session name
        session_id: String,

        /// Command to run (uses original command if not specified)
        #[arg(short, long)]
        command: Option<String>,
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

    /// Consolidate SDK insights into project knowledge
    Consolidate {
        /// Folder path
        #[arg(default_value = ".")]
        path: String,

        /// Filter by folder ID
        #[arg(short, long)]
        folder: Option<String>,

        /// Minimum confidence threshold (0.0 - 1.0)
        #[arg(long, default_value = "0.5")]
        min_confidence: f64,

        /// Only include verified insights
        #[arg(long)]
        verified_only: bool,

        /// Dry run (show changes without saving)
        #[arg(short, long)]
        dry_run: bool,
    },
}

// ─────────────────────────────────────────────────────────────────────────────
// Memory Commands
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Args, Debug)]
pub struct MemoryCommand {
    #[command(subcommand)]
    pub action: MemoryAction,
}

#[derive(Subcommand, Debug)]
pub enum MemoryAction {
    /// Store something in memory
    Remember {
        /// Content to remember
        content: String,

        /// Memory tier: short, working, or long (default: short)
        #[arg(short, long)]
        tier: Option<String>,

        /// Time-to-live in seconds (short-term only)
        #[arg(long)]
        ttl: Option<i32>,

        /// Tags for categorization
        #[arg(short = 'T', long = "tag", action = clap::ArgAction::Append)]
        tags: Vec<String>,

        /// Content type (command, observation, pattern, convention, etc.)
        #[arg(short = 'c', long, default_value = "observation")]
        content_type: String,

        /// Name for the memory (working/long-term)
        #[arg(short, long)]
        name: Option<String>,

        /// Description for the memory (working/long-term)
        #[arg(short, long)]
        description: Option<String>,
    },

    /// Recall memories matching criteria
    Recall {
        /// Filter by tier (short, working, long)
        #[arg(short, long)]
        tier: Option<String>,

        /// Filter by content type
        #[arg(short = 'c', long)]
        content_type: Option<String>,

        /// Minimum relevance score (0.0 - 1.0)
        #[arg(short = 'r', long)]
        min_relevance: Option<f64>,

        /// Maximum results (default: 20)
        #[arg(short, long, default_value = "20")]
        limit: usize,

        /// Include text search query
        #[arg(short, long)]
        query: Option<String>,
    },

    /// Forget (delete) memories
    Forget {
        /// Specific memory ID to delete
        #[arg(short, long)]
        id: Option<String>,

        /// Delete all memories matching tier
        #[arg(short, long)]
        all: bool,

        /// Tier to clear (with --all)
        #[arg(short, long)]
        tier: Option<String>,

        /// Cleanup expired entries
        #[arg(long)]
        expired: bool,
    },

    /// List memories with filters
    List {
        /// Filter by tier
        #[arg(short, long)]
        tier: Option<String>,

        /// Filter by content type
        #[arg(short = 'c', long)]
        content_type: Option<String>,

        /// Maximum results
        #[arg(short, long, default_value = "20")]
        limit: usize,
    },

    /// Show memory statistics
    Stats,

    /// Promote a memory to a higher tier
    Promote {
        /// Memory ID to promote
        id: String,

        /// Target tier (working or long)
        #[arg(short, long)]
        tier: String,
    },
}

// ─────────────────────────────────────────────────────────────────────────────
// Note Commands (convenience wrappers for memory)
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Args, Debug)]
pub struct NoteCommand {
    /// Note content
    pub content: String,

    /// Note type
    #[arg(short, long, default_value = "observation")]
    pub r#type: NoteType,

    /// Priority level (1-5, lower is higher priority)
    #[arg(short, long)]
    pub priority: Option<i32>,

    /// Time-to-live in seconds (default: 1 hour)
    #[arg(long)]
    pub ttl: Option<i32>,

    /// Tags for categorization
    #[arg(short = 'T', long = "tag", action = clap::ArgAction::Append)]
    pub tags: Vec<String>,

    /// Folder path (for folder-scoped notes)
    #[arg(short, long)]
    pub folder: Option<String>,
}

/// Note types for quick capture
#[derive(Debug, Clone, clap::ValueEnum)]
pub enum NoteType {
    /// TODO item to action
    Todo,
    /// Reminder for later
    Reminder,
    /// Question to investigate
    Question,
    /// General observation
    Observation,
    /// Warning or gotcha
    Warning,
    /// Decision made
    Decision,
}

impl NoteType {
    pub fn as_str(&self) -> &'static str {
        match self {
            NoteType::Todo => "todo",
            NoteType::Reminder => "reminder",
            NoteType::Question => "question",
            NoteType::Observation => "observation",
            NoteType::Warning => "warning",
            NoteType::Decision => "decision",
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Notes Commands (structured note-taking with insights)
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Args, Debug)]
pub struct NotesCommand {
    #[command(subcommand)]
    pub action: NotesAction,
}

#[derive(Subcommand, Debug)]
pub enum NotesAction {
    /// Add a new note
    Add {
        /// Note content
        content: String,

        /// Note type (observation, decision, gotcha, pattern, question, todo, reference)
        #[arg(short, long, default_value = "observation")]
        r#type: SdkNoteType,

        /// Optional title
        #[arg(long)]
        title: Option<String>,

        /// Tags for categorization
        #[arg(short = 'T', long = "tag", action = clap::ArgAction::Append)]
        tags: Vec<String>,

        /// Session ID to link note to
        #[arg(short, long)]
        session: Option<String>,

        /// Folder ID or path to link note to
        #[arg(short, long)]
        folder: Option<String>,

        /// Priority (0.0 - 1.0, higher = more important)
        #[arg(short, long)]
        priority: Option<f64>,

        /// Pin this note
        #[arg(long)]
        pin: bool,
    },

    /// Search notes
    Search {
        /// Search query
        query: String,

        /// Filter by note type
        #[arg(short, long)]
        r#type: Option<SdkNoteType>,

        /// Filter by tag
        #[arg(short = 'T', long)]
        tag: Option<String>,

        /// Filter by folder
        #[arg(short, long)]
        folder: Option<String>,

        /// Include archived notes
        #[arg(long)]
        include_archived: bool,

        /// Maximum results
        #[arg(short, long, default_value = "20")]
        limit: usize,
    },

    /// List notes
    List {
        /// Filter by note type
        #[arg(short, long)]
        r#type: Option<SdkNoteType>,

        /// Filter by folder
        #[arg(short, long)]
        folder: Option<String>,

        /// Only show pinned notes
        #[arg(long)]
        pinned: bool,

        /// Include archived notes
        #[arg(long)]
        include_archived: bool,

        /// Maximum results
        #[arg(short, long, default_value = "20")]
        limit: usize,
    },

    /// Show a specific note
    Show {
        /// Note ID
        id: String,
    },

    /// Update a note
    Update {
        /// Note ID
        id: String,

        /// New content
        #[arg(long)]
        content: Option<String>,

        /// New title
        #[arg(long)]
        title: Option<String>,

        /// Add tags
        #[arg(long = "add-tag", action = clap::ArgAction::Append)]
        add_tags: Vec<String>,

        /// Remove tags
        #[arg(long = "remove-tag", action = clap::ArgAction::Append)]
        remove_tags: Vec<String>,

        /// New priority
        #[arg(long)]
        priority: Option<f64>,

        /// Pin the note
        #[arg(long)]
        pin: bool,

        /// Unpin the note
        #[arg(long)]
        unpin: bool,

        /// Archive the note
        #[arg(long)]
        archive: bool,

        /// Unarchive the note
        #[arg(long)]
        unarchive: bool,
    },

    /// Delete a note
    Delete {
        /// Note ID
        id: String,

        /// Skip confirmation
        #[arg(short, long)]
        force: bool,
    },

    /// Summarize session notes
    Summarize {
        /// Session ID to summarize
        session: String,
    },

    /// View or extract insights from notes
    Insights {
        /// Folder ID to extract insights from
        #[arg(short, long)]
        folder: Option<String>,

        /// Extract new insights from notes
        #[arg(long)]
        extract: bool,

        /// Minimum confidence to show
        #[arg(long)]
        min_confidence: Option<f64>,

        /// Filter by insight type
        #[arg(short, long)]
        r#type: Option<SdkInsightType>,

        /// Maximum results
        #[arg(short, long, default_value = "20")]
        limit: usize,
    },
}

/// Note types for the note-taking system
#[derive(Debug, Clone, clap::ValueEnum)]
pub enum SdkNoteType {
    /// General observation
    Observation,
    /// Decision made
    Decision,
    /// Warning or gotcha
    Gotcha,
    /// Pattern identified
    Pattern,
    /// Unanswered question
    Question,
    /// Action item
    Todo,
    /// Reference to external resource
    Reference,
}

impl SdkNoteType {
    pub fn as_str(&self) -> &'static str {
        match self {
            SdkNoteType::Observation => "observation",
            SdkNoteType::Decision => "decision",
            SdkNoteType::Gotcha => "gotcha",
            SdkNoteType::Pattern => "pattern",
            SdkNoteType::Question => "question",
            SdkNoteType::Todo => "todo",
            SdkNoteType::Reference => "reference",
        }
    }
}

/// Insight types for extracted knowledge
#[derive(Debug, Clone, clap::ValueEnum)]
pub enum SdkInsightType {
    /// Code convention
    Convention,
    /// Recurring pattern
    Pattern,
    /// Anti-pattern to avoid
    AntiPattern,
    /// Reusable skill
    Skill,
    /// Common pitfall
    Gotcha,
    /// Best practice
    BestPractice,
    /// Dependency info
    Dependency,
    /// Performance insight
    Performance,
}

impl SdkInsightType {
    pub fn as_str(&self) -> &'static str {
        match self {
            SdkInsightType::Convention => "convention",
            SdkInsightType::Pattern => "pattern",
            SdkInsightType::AntiPattern => "anti_pattern",
            SdkInsightType::Skill => "skill",
            SdkInsightType::Gotcha => "gotcha",
            SdkInsightType::BestPractice => "best_practice",
            SdkInsightType::Dependency => "dependency",
            SdkInsightType::Performance => "performance",
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Knowledge Commands
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Args, Debug)]
pub struct KnowledgeCommand {
    #[command(subcommand)]
    pub action: KnowledgeAction,
}

#[derive(Subcommand, Debug)]
pub enum KnowledgeAction {
    /// Add knowledge to the project knowledge base
    Add {
        /// Knowledge type
        #[arg(short, long)]
        r#type: KnowledgeType,

        /// Name/title for the knowledge
        name: String,

        /// Description or content
        description: String,

        /// Folder path (for folder-scoped knowledge)
        #[arg(short, long)]
        folder: Option<String>,

        /// Confidence score (0.0 - 1.0)
        #[arg(short, long)]
        confidence: Option<f64>,

        /// Source of the knowledge
        #[arg(short, long)]
        source: Option<String>,

        /// Tags for categorization
        #[arg(short = 'T', long = "tag", action = clap::ArgAction::Append)]
        tags: Vec<String>,
    },

    /// List knowledge entries
    List {
        /// Filter by type
        #[arg(short, long)]
        r#type: Option<KnowledgeType>,

        /// Filter by folder
        #[arg(short, long)]
        folder: Option<String>,

        /// Maximum results
        #[arg(short, long, default_value = "20")]
        limit: usize,
    },

    /// Show details of a knowledge entry
    Show {
        /// Knowledge ID
        id: String,
    },

    /// Update a knowledge entry
    Update {
        /// Knowledge ID
        id: String,

        /// New description
        #[arg(short, long)]
        description: Option<String>,

        /// New confidence score
        #[arg(short, long)]
        confidence: Option<f64>,

        /// Add tags
        #[arg(short = 'T', long = "tag", action = clap::ArgAction::Append)]
        add_tags: Vec<String>,
    },

    /// Remove a knowledge entry
    Remove {
        /// Knowledge ID
        id: String,

        /// Skip confirmation
        #[arg(short, long)]
        force: bool,
    },

    /// Import knowledge from CLAUDE.md or similar config
    Import {
        /// Path to file (defaults to CLAUDE.md in current dir)
        #[arg(default_value = "CLAUDE.md")]
        path: String,

        /// Dry run (show what would be imported)
        #[arg(short, long)]
        dry_run: bool,
    },

    /// Export knowledge to a file
    Export {
        /// Output path
        #[arg(default_value = "knowledge.json")]
        path: String,

        /// Filter by folder
        #[arg(short, long)]
        folder: Option<String>,
    },
}

/// Knowledge types for the project knowledge base
#[derive(Debug, Clone, clap::ValueEnum)]
pub enum KnowledgeType {
    /// Coding conventions and standards
    Convention,
    /// Common patterns and solutions
    Pattern,
    /// Reusable skills/techniques
    Skill,
    /// Tools and automation
    Tool,
    /// Known pitfalls and warnings
    Gotcha,
}

impl KnowledgeType {
    pub fn as_str(&self) -> &'static str {
        match self {
            KnowledgeType::Convention => "convention",
            KnowledgeType::Pattern => "pattern",
            KnowledgeType::Skill => "skill",
            KnowledgeType::Tool => "tool",
            KnowledgeType::Gotcha => "gotcha",
        }
    }
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

// ─────────────────────────────────────────────────────────────────────────────
// Insights Commands
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Args, Debug)]
pub struct InsightsCommand {
    #[command(subcommand)]
    pub action: InsightsAction,
}

#[derive(Subcommand, Debug)]
pub enum InsightsAction {
    /// List insights for an orchestrator
    List {
        /// Orchestrator ID (defaults to Master Control)
        #[arg(short, long)]
        orchestrator: Option<String>,

        /// Show only unresolved insights
        #[arg(short, long)]
        unresolved: bool,

        /// Show all insights (including resolved)
        #[arg(short, long)]
        all: bool,
    },

    /// Show details of a specific insight
    Show {
        /// Insight ID
        insight_id: String,
    },

    /// Resolve an insight
    Resolve {
        /// Insight ID
        insight_id: String,

        /// Resolution notes
        #[arg(short, long)]
        notes: Option<String>,
    },

    /// Check for stalled sessions (uses database query)
    Stalled {
        /// Stall threshold in seconds
        #[arg(short, long, default_value = "300")]
        threshold: i64,
    },
}

// ─────────────────────────────────────────────────────────────────────────────
// Extension Commands
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Args, Debug)]
pub struct ExtCommand {
    #[command(subcommand)]
    pub action: ExtAction,
}

#[derive(Subcommand, Debug)]
pub enum ExtAction {
    /// List installed extensions
    List {
        /// Show all extensions (including disabled)
        #[arg(short, long)]
        all: bool,

        /// Output as JSON
        #[arg(short, long)]
        json: bool,
    },

    /// Show extension details
    Show {
        /// Extension ID
        id: String,

        /// Output as JSON
        #[arg(short, long)]
        json: bool,
    },

    /// Enable an extension
    Enable {
        /// Extension ID
        id: String,
    },

    /// Disable an extension
    Disable {
        /// Extension ID
        id: String,
    },

    /// Uninstall an extension
    Uninstall {
        /// Extension ID
        id: String,

        /// Skip confirmation
        #[arg(short, long)]
        force: bool,
    },

    /// Create a new extension (scaffold)
    Create {
        /// Extension name (will be converted to kebab-case)
        name: String,

        /// Output directory (defaults to current directory)
        #[arg(short, long)]
        output: Option<String>,

        /// Extension description
        #[arg(short, long)]
        description: Option<String>,

        /// Include example tool
        #[arg(long)]
        with_tool: bool,

        /// Include example prompt
        #[arg(long)]
        with_prompt: bool,
    },
}

// ─────────────────────────────────────────────────────────────────────────────
// Meta-Agent Commands (BUILD → TEST → IMPROVE)
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Args, Debug)]
pub struct MetaCommand {
    #[command(subcommand)]
    pub action: MetaAction,
}

#[derive(Subcommand, Debug)]
pub enum MetaAction {
    /// Run BUILD → TEST → IMPROVE optimization loop
    Optimize {
        /// Task description to optimize for
        task: String,

        /// Agent provider (claude, codex, gemini, opencode)
        #[arg(short, long)]
        provider: Option<String>,

        /// Maximum iterations
        #[arg(short = 'i', long, default_value = "3")]
        iterations: Option<i32>,

        /// Target score (0.0-1.0)
        #[arg(short, long)]
        target_score: Option<f64>,

        /// Run asynchronously (returns job ID)
        #[arg(short, long)]
        r#async: bool,

        /// Verbose output
        #[arg(short, long)]
        verbose: bool,

        /// Dry run (don't apply changes)
        #[arg(long)]
        dry_run: bool,
    },

    /// Benchmark configuration effectiveness
    Benchmark {
        /// Configuration ID to benchmark
        config_id: String,

        /// Number of benchmark runs
        #[arg(short, long, default_value = "3")]
        runs: Option<i32>,
    },

    /// Get config suggestions based on context
    Suggest {
        /// Context description (e.g., "TypeScript React project with testing issues")
        context: String,

        /// Agent provider to target suggestions for
        #[arg(short, long)]
        provider: Option<String>,

        /// Project path (defaults to current directory)
        #[arg(long)]
        project_path: Option<String>,
    },

    /// Check optimization job status
    Status {
        /// Job ID to check
        job_id: String,
    },

    /// View optimization history
    History {
        /// Maximum entries to show
        #[arg(short, long, default_value = "10")]
        limit: Option<i32>,
    },
}
