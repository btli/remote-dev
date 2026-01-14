//! TrajectoryDistillationService - Async learning from agent sessions
//!
//! This service watches session trajectories and automatically extracts learnings
//! without interrupting the working agent. Based on CCA paper's "note-taking agent" concept.
//!
//! Architecture:
//! ```text
//! ┌─────────────────────────────────────────────────────────────────┐
//! │                  TrajectoryDistillationService                   │
//! │                                                                  │
//! │  Runs asynchronously alongside agent sessions                   │
//! │  Does NOT interrupt agent - watches and learns                  │
//! └─────────────────────────────────────────────────────────────────┘
//!                               │
//!         ┌─────────────────────┼─────────────────────┐
//!         ▼                     ▼                     ▼
//! ┌───────────────┐     ┌───────────────┐     ┌───────────────┐
//! │ErrorResolution│     │DecisionTracker│     │OutcomeAnalyzer│
//! │   Detector    │     │               │     │               │
//! └───────────────┘     └───────────────┘     └───────────────┘
//! ```
//!
//! Distillation Triggers:
//! - Error → Resolution (< 10 min): Create hindsight note
//! - Task completion: Extract key decisions
//! - Session end: Full trajectory analysis
//! - 30 minutes elapsed: Incremental checkpoint

use chrono::Utc;
use rdv_core::tmux;
use rdv_core::types::{NewMemoryEntry, NewNote, NoteType, Session};
use rdv_core::Database;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{Mutex, RwLock};
use tokio::time::{interval, Duration};
use tracing::{debug, error, info, warn};

/// Configuration for trajectory distillation.
#[derive(Debug, Clone)]
pub struct DistillationConfig {
    /// Interval between distillation cycles (ms).
    pub interval_ms: u64,
    /// Maximum time between error and resolution to consider paired (seconds).
    pub error_resolution_window_secs: i64,
    /// Minimum scrollback lines to analyze.
    pub min_scrollback_lines: u32,
    /// Maximum scrollback lines to capture.
    pub max_scrollback_lines: u32,
    /// Enable error-resolution tracking.
    pub track_error_resolution: bool,
    /// Enable decision tracking.
    pub track_decisions: bool,
    /// Enable outcome analysis.
    pub track_outcomes: bool,
    /// Confidence threshold for creating notes.
    pub min_confidence: f64,
}

impl Default for DistillationConfig {
    fn default() -> Self {
        Self {
            interval_ms: 30_000,                  // 30 seconds
            error_resolution_window_secs: 600,   // 10 minutes
            min_scrollback_lines: 10,
            max_scrollback_lines: 500,
            track_error_resolution: true,
            track_decisions: true,
            track_outcomes: true,
            min_confidence: 0.5,
        }
    }
}

/// Detected error in scrollback.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DetectedError {
    /// Unique identifier for tracking.
    pub id: String,
    /// Error type/category.
    pub error_type: String,
    /// The error message.
    pub message: String,
    /// File path if detected.
    pub file_path: Option<String>,
    /// Line number if detected.
    pub line_number: Option<u32>,
    /// Language/framework context.
    pub language: Option<String>,
    /// When the error was detected.
    pub detected_at: i64,
    /// Whether this error has been resolved.
    pub resolved: bool,
    /// Resolution details if resolved.
    pub resolution: Option<ErrorResolution>,
}

/// Resolution for a detected error.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ErrorResolution {
    /// Commands that fixed the error.
    pub commands: Vec<String>,
    /// Files that were modified.
    pub files_modified: Vec<String>,
    /// Time when resolved.
    pub resolved_at: i64,
    /// Time to resolution in seconds.
    pub time_to_resolve_secs: i64,
    /// Brief summary of resolution.
    pub summary: Option<String>,
}

/// Tracked decision.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrackedDecision {
    /// Unique identifier.
    pub id: String,
    /// What was decided.
    pub decision: String,
    /// Alternatives that were considered (if discernible).
    pub alternatives: Vec<String>,
    /// Rationale (if discernible).
    pub rationale: Option<String>,
    /// Context (task, file, etc.).
    pub context: String,
    /// When the decision was made.
    pub made_at: i64,
    /// Confidence in this being a decision.
    pub confidence: f64,
}

/// Session outcome classification.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SessionOutcome {
    /// Task completed successfully.
    Completed,
    /// Partial completion.
    Partial,
    /// Failed or abandoned.
    Failed,
    /// Pivoted to different approach.
    Pivoted,
    /// Still in progress.
    InProgress,
    /// Unknown outcome.
    Unknown,
}

/// Session trajectory state for a single session.
#[derive(Debug, Clone)]
struct SessionTrajectory {
    /// Session ID.
    session_id: String,
    /// tmux session name.
    tmux_session_name: String,
    /// User ID.
    user_id: String,
    /// Folder ID if known.
    folder_id: Option<String>,
    /// Previous scrollback hash for change detection.
    last_scrollback_hash: Option<String>,
    /// Detected errors awaiting resolution.
    pending_errors: Vec<DetectedError>,
    /// Resolved errors (for creating hindsight notes).
    resolved_errors: Vec<DetectedError>,
    /// Tracked decisions.
    decisions: Vec<TrackedDecision>,
    /// Last checkpoint time.
    last_checkpoint: i64,
    /// Total commands observed.
    command_count: usize,
    /// Current outcome assessment.
    outcome: SessionOutcome,
}

impl SessionTrajectory {
    fn new(
        session_id: String,
        tmux_session_name: String,
        user_id: String,
        folder_id: Option<String>,
    ) -> Self {
        Self {
            session_id,
            tmux_session_name,
            user_id,
            folder_id,
            last_scrollback_hash: None,
            pending_errors: Vec::new(),
            resolved_errors: Vec::new(),
            decisions: Vec::new(),
            last_checkpoint: Utc::now().timestamp(),
            command_count: 0,
            outcome: SessionOutcome::InProgress,
        }
    }
}

/// Result of a distillation cycle.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct DistillationResult {
    /// Number of sessions analyzed.
    pub sessions_analyzed: usize,
    /// Number of errors detected.
    pub errors_detected: usize,
    /// Number of resolutions matched.
    pub resolutions_matched: usize,
    /// Number of hindsight notes created.
    pub hindsight_notes_created: usize,
    /// Number of decisions tracked.
    pub decisions_tracked: usize,
    /// Duration of the cycle in ms.
    pub duration_ms: u64,
    /// Timestamp of completion.
    pub completed_at: i64,
}

/// Handle for a running distillation task.
struct DistillationHandle {
    abort_handle: tokio::task::AbortHandle,
    user_id: String,
}

/// TrajectoryDistillationService manages async learning from agent sessions.
pub struct TrajectoryDistillationService {
    db: Arc<Database>,
    config: DistillationConfig,
    /// Active distillation tasks by user_id.
    active_tasks: RwLock<HashMap<String, DistillationHandle>>,
    /// Session trajectories by session_id.
    trajectories: RwLock<HashMap<String, SessionTrajectory>>,
    /// Error detection patterns (compiled once).
    error_patterns: Vec<ErrorPattern>,
    /// Decision detection patterns.
    decision_patterns: Vec<DecisionPattern>,
    /// Operation lock.
    operation_lock: Mutex<()>,
}

/// Pattern for detecting errors in scrollback.
struct ErrorPattern {
    name: &'static str,
    regex: Regex,
    language: Option<&'static str>,
    severity: &'static str,
}

/// Pattern for detecting decisions in scrollback.
struct DecisionPattern {
    name: &'static str,
    regex: Regex,
    confidence_base: f64,
}

impl TrajectoryDistillationService {
    /// Create a new trajectory distillation service.
    pub fn new(db: Arc<Database>, config: DistillationConfig) -> Self {
        Self {
            db,
            config,
            active_tasks: RwLock::new(HashMap::new()),
            trajectories: RwLock::new(HashMap::new()),
            error_patterns: Self::compile_error_patterns(),
            decision_patterns: Self::compile_decision_patterns(),
            operation_lock: Mutex::new(()),
        }
    }

    /// Create with default configuration.
    pub fn with_defaults(db: Arc<Database>) -> Self {
        Self::new(db, DistillationConfig::default())
    }

    /// Compile error detection patterns.
    fn compile_error_patterns() -> Vec<ErrorPattern> {
        vec![
            // Rust errors
            ErrorPattern {
                name: "rust_compile_error",
                regex: Regex::new(r"error\[E\d{4}\]: (.+)").unwrap(),
                language: Some("rust"),
                severity: "high",
            },
            // TypeScript/JavaScript errors
            ErrorPattern {
                name: "typescript_error",
                regex: Regex::new(r"error TS\d+: (.+)").unwrap(),
                language: Some("typescript"),
                severity: "high",
            },
            ErrorPattern {
                name: "node_error",
                regex: Regex::new(r"Error: (.+)").unwrap(),
                language: Some("javascript"),
                severity: "medium",
            },
            // Python errors
            ErrorPattern {
                name: "python_error",
                regex: Regex::new(r"(?:TypeError|ValueError|AttributeError|ImportError|KeyError|NameError|SyntaxError): (.+)").unwrap(),
                language: Some("python"),
                severity: "high",
            },
            // Generic patterns
            ErrorPattern {
                name: "failed_test",
                regex: Regex::new(r"(?:FAIL|FAILED|test (?:failed|failure))\s*(.*)").unwrap(),
                language: None,
                severity: "medium",
            },
            ErrorPattern {
                name: "command_not_found",
                regex: Regex::new(r"command not found: (\S+)").unwrap(),
                language: None,
                severity: "low",
            },
            ErrorPattern {
                name: "permission_denied",
                regex: Regex::new(r"(?:Permission denied|EACCES)").unwrap(),
                language: None,
                severity: "medium",
            },
            ErrorPattern {
                name: "git_error",
                regex: Regex::new(r"fatal: (.+)").unwrap(),
                language: None,
                severity: "medium",
            },
            // Build/compile errors
            ErrorPattern {
                name: "build_failed",
                regex: Regex::new(r"(?:Build failed|Compilation failed|make: \*\*\* .+ Error)").unwrap(),
                language: None,
                severity: "high",
            },
        ]
    }

    /// Compile decision detection patterns.
    fn compile_decision_patterns() -> Vec<DecisionPattern> {
        vec![
            // Explicit choices
            DecisionPattern {
                name: "using_over",
                regex: Regex::new(r"(?i)using\s+(\S+)\s+(?:over|instead of)\s+(\S+)").unwrap(),
                confidence_base: 0.8,
            },
            DecisionPattern {
                name: "chose_to",
                regex: Regex::new(r"(?i)(?:chose|decided|choosing|deciding)\s+to\s+(.+)").unwrap(),
                confidence_base: 0.7,
            },
            DecisionPattern {
                name: "going_with",
                regex: Regex::new(r"(?i)going\s+with\s+(.+)").unwrap(),
                confidence_base: 0.6,
            },
            // Implicit decisions from commands
            DecisionPattern {
                name: "npm_add",
                regex: Regex::new(r"(?:npm|yarn|pnpm|bun)\s+(?:add|install)\s+(\S+)").unwrap(),
                confidence_base: 0.5,
            },
            DecisionPattern {
                name: "cargo_add",
                regex: Regex::new(r"cargo\s+add\s+(\S+)").unwrap(),
                confidence_base: 0.5,
            },
        ]
    }

    /// Start distillation for a user's sessions.
    pub async fn start_distillation(self: Arc<Self>, user_id: String) {
        let _lock = self.operation_lock.lock().await;

        // Stop existing if any
        self.stop_distillation_inner(&user_id).await;

        info!(user_id = %user_id, "Starting trajectory distillation");

        let service = Arc::clone(&self);
        let u_id = user_id.clone();

        let handle = tokio::spawn(async move {
            let mut check_interval = interval(Duration::from_millis(service.config.interval_ms));

            loop {
                check_interval.tick().await;

                if let Err(e) = service.run_distillation_cycle(&u_id).await {
                    error!(user_id = %u_id, error = %e, "Distillation cycle failed");
                }
            }
        });

        let mut tasks = self.active_tasks.write().await;
        tasks.insert(
            user_id.clone(),
            DistillationHandle {
                abort_handle: handle.abort_handle(),
                user_id,
            },
        );
    }

    /// Stop distillation for a user (internal, assumes lock held).
    async fn stop_distillation_inner(&self, user_id: &str) {
        let mut tasks = self.active_tasks.write().await;
        if let Some(handle) = tasks.remove(user_id) {
            handle.abort_handle.abort();
            info!(user_id = %user_id, "Stopped trajectory distillation");
        }
    }

    /// Stop distillation for a user.
    pub async fn stop_distillation(&self, user_id: &str) {
        let _lock = self.operation_lock.lock().await;
        self.stop_distillation_inner(user_id).await;
    }

    /// Check if distillation is active for a user.
    pub async fn is_distillation_active(&self, user_id: &str) -> bool {
        let tasks = self.active_tasks.read().await;
        tasks.contains_key(user_id)
    }

    /// Run a single distillation cycle for a user.
    pub async fn run_distillation_cycle(&self, user_id: &str) -> Result<DistillationResult, String> {
        let start = std::time::Instant::now();
        let mut result = DistillationResult::default();

        // Get active sessions for user (folder_id = None gets all sessions)
        let sessions: Vec<Session> = self
            .db
            .list_sessions(user_id, None)
            .map_err(|e| e.to_string())?;

        for session in &sessions {
            // Skip sessions without tmux names
            if session.tmux_session_name.is_empty() {
                continue;
            }
            let tmux_name = &session.tmux_session_name;

            // Check if tmux session exists
            if !tmux::session_exists(tmux_name).unwrap_or(false) {
                continue;
            }

            result.sessions_analyzed += 1;

            // Get or create trajectory state
            let mut trajectories = self.trajectories.write().await;
            let trajectory = trajectories
                .entry(session.id.clone())
                .or_insert_with(|| {
                    SessionTrajectory::new(
                        session.id.clone(),
                        tmux_name.clone(),
                        user_id.to_string(),
                        session.folder_id.clone(),
                    )
                });

            // Capture scrollback
            let scrollback = match tmux::capture_pane(&tmux_name, Some(self.config.max_scrollback_lines)) {
                Ok(sb) => sb,
                Err(e) => {
                    debug!(session_id = %session.id, error = %e, "Failed to capture scrollback");
                    continue;
                }
            };

            // Check for changes via hash
            let current_hash = format!("{:x}", md5::compute(&scrollback));
            if trajectory.last_scrollback_hash.as_ref() == Some(&current_hash) {
                continue; // No changes
            }
            trajectory.last_scrollback_hash = Some(current_hash);

            // Analyze scrollback
            if self.config.track_error_resolution {
                let (errors, resolutions) = self.analyze_error_resolution(&scrollback, trajectory);
                result.errors_detected += errors;
                result.resolutions_matched += resolutions;
            }

            if self.config.track_decisions {
                let decisions = self.analyze_decisions(&scrollback, trajectory);
                result.decisions_tracked += decisions;
            }

            // Create hindsight notes for resolved errors
            let hindsight_created = self.create_hindsight_notes(trajectory).await;
            result.hindsight_notes_created += hindsight_created;
        }

        result.duration_ms = start.elapsed().as_millis() as u64;
        result.completed_at = Utc::now().timestamp();

        if result.sessions_analyzed > 0 {
            debug!(
                sessions = result.sessions_analyzed,
                errors = result.errors_detected,
                resolutions = result.resolutions_matched,
                notes = result.hindsight_notes_created,
                "Distillation cycle complete"
            );
        }

        Ok(result)
    }

    /// Analyze scrollback for error-resolution pairs.
    fn analyze_error_resolution(
        &self,
        scrollback: &str,
        trajectory: &mut SessionTrajectory,
    ) -> (usize, usize) {
        let mut new_errors = 0;
        let mut new_resolutions = 0;
        let now = Utc::now().timestamp();

        // Detect new errors
        for pattern in &self.error_patterns {
            for captures in pattern.regex.captures_iter(scrollback) {
                let message = captures.get(1).map(|m| m.as_str()).unwrap_or("").to_string();
                let error_id = format!(
                    "{}:{}",
                    pattern.name,
                    &format!("{:x}", md5::compute(&message))[..8]
                );

                // Skip if we already have this error
                if trajectory.pending_errors.iter().any(|e| e.id == error_id) {
                    continue;
                }

                // Extract file path and line number if present
                let (file_path, line_number) = self.extract_location(scrollback, &message);

                let error = DetectedError {
                    id: error_id,
                    error_type: pattern.name.to_string(),
                    message,
                    file_path,
                    line_number,
                    language: pattern.language.map(String::from),
                    detected_at: now,
                    resolved: false,
                    resolution: None,
                };

                trajectory.pending_errors.push(error);
                new_errors += 1;
            }
        }

        // Check for resolutions of pending errors
        let mut resolved_indices = Vec::new();
        for (idx, error) in trajectory.pending_errors.iter_mut().enumerate() {
            // Skip if too old
            if now - error.detected_at > self.config.error_resolution_window_secs {
                continue;
            }

            // Look for resolution signals
            if let Some(resolution) = self.detect_resolution(scrollback, error) {
                error.resolved = true;
                error.resolution = Some(resolution);
                resolved_indices.push(idx);
                new_resolutions += 1;
            }
        }

        // Move resolved errors to resolved list
        for idx in resolved_indices.into_iter().rev() {
            let error = trajectory.pending_errors.remove(idx);
            trajectory.resolved_errors.push(error);
        }

        // Prune old unresolved errors
        trajectory.pending_errors.retain(|e| {
            now - e.detected_at <= self.config.error_resolution_window_secs * 2
        });

        (new_errors, new_resolutions)
    }

    /// Extract file path and line number from error context.
    fn extract_location(&self, scrollback: &str, message: &str) -> (Option<String>, Option<u32>) {
        // Pattern: "file:line" or "file:line:col"
        let location_regex = match Regex::new(
            r"([a-zA-Z0-9_/.\-]+(?:\.rs|\.ts|\.tsx|\.js|\.jsx|\.py|\.go)):(\d+)",
        ) {
            Ok(r) => r,
            Err(_) => return (None, None),
        };

        // Search in message first
        if let Some(captures) = location_regex.captures(message) {
            return (
                captures.get(1).map(|m| m.as_str().to_string()),
                captures.get(2).and_then(|m| m.as_str().parse().ok()),
            );
        }

        // Search in nearby scrollback lines
        for line in scrollback.lines().take(50) {
            if let Some(captures) = location_regex.captures(line) {
                return (
                    captures.get(1).map(|m| m.as_str().to_string()),
                    captures.get(2).and_then(|m| m.as_str().parse().ok()),
                );
            }
        }

        (None, None)
    }

    /// Detect if an error has been resolved.
    fn detect_resolution(&self, scrollback: &str, error: &DetectedError) -> Option<ErrorResolution> {
        let now = Utc::now().timestamp();

        // Resolution signals
        let resolution_patterns = [
            r"(?i)(?:fixed|resolved|solved|done|works|success|passed)",
            r"(?:✓|✔|PASS|OK|passed)",
            r"(?i)build succeeded",
            r"(?i)tests? passed",
            r"(?i)no errors",
        ];

        let mut found_resolution = false;
        for pattern in resolution_patterns {
            if let Ok(regex) = Regex::new(pattern) {
                if regex.is_match(scrollback) {
                    found_resolution = true;
                    break;
                }
            }
        }

        if !found_resolution {
            // Also check if the same error type no longer appears
            for pattern in &self.error_patterns {
                if pattern.name == error.error_type {
                    let recent_lines: String = scrollback.lines().rev().take(20).collect::<Vec<_>>().join("\n");
                    if !pattern.regex.is_match(&recent_lines) {
                        found_resolution = true;
                        break;
                    }
                }
            }
        }

        if !found_resolution {
            return None;
        }

        // Extract resolution context
        let commands = self.extract_recent_commands(scrollback);
        let files_modified = self.extract_modified_files(scrollback);

        Some(ErrorResolution {
            commands,
            files_modified,
            resolved_at: now,
            time_to_resolve_secs: now - error.detected_at,
            summary: None,
        })
    }

    /// Extract recent commands from scrollback.
    fn extract_recent_commands(&self, scrollback: &str) -> Vec<String> {
        let mut commands = Vec::new();
        let command_patterns = [
            r"^\$ (.+)$",          // $ command
            r"^> (.+)$",           // > command (Windows/REPL)
            r"^[a-z]+@\S+.*\$ (.+)$", // user@host$ command
        ];

        for pattern in command_patterns {
            if let Ok(regex) = Regex::new(pattern) {
                for line in scrollback.lines().rev().take(100) {
                    if let Some(captures) = regex.captures(line) {
                        if let Some(cmd) = captures.get(1) {
                            let cmd_str = cmd.as_str().to_string();
                            if !commands.contains(&cmd_str) && commands.len() < 10 {
                                commands.push(cmd_str);
                            }
                        }
                    }
                }
            }
        }

        commands.reverse();
        commands
    }

    /// Extract modified files from scrollback.
    fn extract_modified_files(&self, scrollback: &str) -> Vec<String> {
        let mut files = Vec::new();

        // Look for file modification patterns
        let patterns = [
            r"(?:editing|modified|changed|saved|wrote)\s+(\S+\.(?:rs|ts|tsx|js|jsx|py|go|json|yaml|toml))",
            r"^\+\+\+ b/(.+)$", // git diff
        ];

        for pattern in patterns {
            if let Ok(regex) = Regex::new(pattern) {
                for captures in regex.captures_iter(scrollback) {
                    if let Some(file) = captures.get(1) {
                        let file_str = file.as_str().to_string();
                        if !files.contains(&file_str) && files.len() < 10 {
                            files.push(file_str);
                        }
                    }
                }
            }
        }

        files
    }

    /// Analyze scrollback for decisions.
    fn analyze_decisions(&self, scrollback: &str, trajectory: &mut SessionTrajectory) -> usize {
        let mut new_decisions = 0;
        let now = Utc::now().timestamp();

        for pattern in &self.decision_patterns {
            for captures in pattern.regex.captures_iter(scrollback) {
                let decision_text = captures.get(1).map(|m| m.as_str()).unwrap_or("").to_string();
                if decision_text.is_empty() {
                    continue;
                }

                let decision_id = format!(
                    "{}:{}",
                    pattern.name,
                    &format!("{:x}", md5::compute(&decision_text))[..8]
                );

                // Skip if we already have this decision
                if trajectory.decisions.iter().any(|d| d.id == decision_id) {
                    continue;
                }

                // Extract alternatives if present
                let alternatives = if let Some(alt) = captures.get(2) {
                    vec![alt.as_str().to_string()]
                } else {
                    vec![]
                };

                let decision = TrackedDecision {
                    id: decision_id,
                    decision: decision_text,
                    alternatives,
                    rationale: None,
                    context: pattern.name.to_string(),
                    made_at: now,
                    confidence: pattern.confidence_base,
                };

                trajectory.decisions.push(decision);
                new_decisions += 1;
            }
        }

        // Keep only recent decisions
        trajectory.decisions.retain(|d| {
            now - d.made_at < 3600 * 4 // 4 hours
        });

        new_decisions
    }

    /// Create hindsight notes for resolved errors.
    async fn create_hindsight_notes(&self, trajectory: &mut SessionTrajectory) -> usize {
        let mut created = 0;

        // Process resolved errors
        while let Some(error) = trajectory.resolved_errors.pop() {
            if error.resolution.is_none() {
                continue;
            }

            let resolution = error.resolution.as_ref().unwrap();

            // Create note title
            let title = format!(
                "Gotcha: {} in {}",
                error.error_type.replace('_', " "),
                error.language.as_deref().unwrap_or("unknown")
            );

            // Create note content in hindsight format
            let content = format!(
                "## Problem\n```\n{}\n```\n\n\
                 ## Context\n- File: {}\n- Line: {}\n- Task: {}\n\n\
                 ## Resolution\n```bash\n{}\n```\n\n\
                 ## Key Insight\nResolved in {} seconds. Files modified: {}\n\n\
                 ---\n*Auto-generated from session {} on {}*\n*Confidence: {:.2}*",
                error.message,
                error.file_path.as_deref().unwrap_or("unknown"),
                error.line_number.map(|n| n.to_string()).unwrap_or_else(|| "unknown".to_string()),
                error.error_type,
                resolution.commands.join("\n"),
                resolution.time_to_resolve_secs,
                resolution.files_modified.join(", "),
                trajectory.session_id,
                Utc::now().format("%Y-%m-%d"),
                self.calculate_hindsight_confidence(&error)
            );

            // Store as a note
            let tags = vec![
                "gotcha".to_string(),
                "auto-generated".to_string(),
                error.error_type.clone(),
                error.language.clone().unwrap_or_else(|| "unknown".to_string()),
            ];

            // Clone content for use after note creation
            let content_for_memory = content.clone();

            let note = NewNote {
                user_id: trajectory.user_id.clone(),
                session_id: Some(trajectory.session_id.clone()),
                folder_id: trajectory.folder_id.clone(),
                note_type: NoteType::Gotcha,
                title: Some(title),
                content,
                tags,
                context: None,
                priority: 0.7, // Higher priority for gotchas
            };

            match self.db.create_note(&note) {
                Ok(_) => {
                    info!(
                        session_id = %trajectory.session_id,
                        error_type = %error.error_type,
                        "Created hindsight note"
                    );
                    created += 1;
                }
                Err(e) => {
                    warn!(error = %e, "Failed to create hindsight note");
                }
            }

            // Also store as a memory for semantic search
            if let Err(e) = self
                .store_as_memory(trajectory, &error, &content_for_memory)
                .await
            {
                debug!(error = %e, "Failed to store hindsight as memory");
            }
        }

        created
    }

    /// Store hindsight as a memory entry for semantic search.
    async fn store_as_memory(
        &self,
        trajectory: &SessionTrajectory,
        error: &DetectedError,
        content: &str,
    ) -> Result<(), String> {
        let name = format!("Gotcha: {}", error.error_type.replace('_', " "));

        let memory = NewMemoryEntry {
            user_id: trajectory.user_id.clone(),
            session_id: Some(trajectory.session_id.clone()),
            folder_id: trajectory.folder_id.clone(),
            tier: "long_term".to_string(),
            content_type: "gotcha".to_string(),
            name: Some(name),
            description: Some(format!(
                "Error resolution: {} in {}",
                error.error_type,
                error.language.as_deref().unwrap_or("unknown")
            )),
            content: content.to_string(),
            task_id: None,
            priority: Some(70), // Higher priority for gotchas
            confidence: Some(self.calculate_hindsight_confidence(error)),
            relevance: Some(0.8),
            ttl_seconds: None, // Long-term, no TTL
            metadata_json: Some(
                serde_json::json!({
                    "error_type": error.error_type,
                    "language": error.language,
                    "file_path": error.file_path,
                    "time_to_resolve_secs": error.resolution.as_ref().map(|r| r.time_to_resolve_secs),
                    "source": "trajectory_distillation"
                })
                .to_string(),
            ),
        };

        self.db
            .create_memory_entry(&memory)
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Calculate confidence for a hindsight note.
    fn calculate_hindsight_confidence(&self, error: &DetectedError) -> f64 {
        let mut confidence: f64 = 0.5;

        // Boost for having resolution commands
        if let Some(ref resolution) = error.resolution {
            if !resolution.commands.is_empty() {
                confidence += 0.1;
            }
            if !resolution.files_modified.is_empty() {
                confidence += 0.1;
            }
            // Boost for quick resolution (< 5 min)
            if resolution.time_to_resolve_secs < 300 {
                confidence += 0.1;
            }
        }

        // Boost for file/line info
        if error.file_path.is_some() {
            confidence += 0.1;
        }
        if error.line_number.is_some() {
            confidence += 0.05;
        }

        confidence.min(0.95)
    }

    /// Clean up trajectory state for a closed session.
    pub async fn cleanup_session(&self, session_id: &str) {
        let mut trajectories = self.trajectories.write().await;
        trajectories.remove(session_id);
    }

    /// Get distillation status.
    pub async fn get_status(&self, user_id: &str) -> Option<DistillationStatus> {
        let tasks = self.active_tasks.read().await;
        if !tasks.contains_key(user_id) {
            return None;
        }

        let trajectories = self.trajectories.read().await;
        let user_trajectories: Vec<_> = trajectories
            .values()
            .filter(|t| t.user_id == user_id)
            .collect();

        Some(DistillationStatus {
            active: true,
            sessions_tracked: user_trajectories.len(),
            pending_errors: user_trajectories.iter().map(|t| t.pending_errors.len()).sum(),
            resolved_errors: user_trajectories.iter().map(|t| t.resolved_errors.len()).sum(),
            decisions_tracked: user_trajectories.iter().map(|t| t.decisions.len()).sum(),
        })
    }

    /// Stop all distillation tasks.
    pub async fn stop_all(&self) {
        let _lock = self.operation_lock.lock().await;
        let mut tasks = self.active_tasks.write().await;

        for (user_id, handle) in tasks.drain() {
            handle.abort_handle.abort();
            info!(user_id = %user_id, "Stopped distillation");
        }
    }
}

/// Status of distillation for a user.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DistillationStatus {
    pub active: bool,
    pub sessions_tracked: usize,
    pub pending_errors: usize,
    pub resolved_errors: usize,
    pub decisions_tracked: usize,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_distillation_config_default() {
        let config = DistillationConfig::default();
        assert_eq!(config.interval_ms, 30_000);
        assert_eq!(config.error_resolution_window_secs, 600);
        assert!(config.track_error_resolution);
        assert!(config.track_decisions);
    }

    #[test]
    fn test_session_outcome_serialization() {
        assert_eq!(
            serde_json::to_string(&SessionOutcome::Completed).unwrap(),
            "\"completed\""
        );
        assert_eq!(
            serde_json::to_string(&SessionOutcome::InProgress).unwrap(),
            "\"in_progress\""
        );
    }

    #[test]
    fn test_error_pattern_compilation() {
        let patterns = TrajectoryDistillationService::compile_error_patterns();
        assert!(!patterns.is_empty());

        // Test rust error detection
        let rust_pattern = patterns.iter().find(|p| p.name == "rust_compile_error").unwrap();
        assert!(rust_pattern.regex.is_match("error[E0382]: borrow of moved value"));
    }

    #[test]
    fn test_decision_pattern_compilation() {
        let patterns = TrajectoryDistillationService::compile_decision_patterns();
        assert!(!patterns.is_empty());

        // Test using_over pattern
        let using_pattern = patterns.iter().find(|p| p.name == "using_over").unwrap();
        let captures = using_pattern.regex.captures("Using axum over actix-web for the API");
        assert!(captures.is_some());
    }

    #[test]
    fn test_distillation_result_default() {
        let result = DistillationResult::default();
        assert_eq!(result.sessions_analyzed, 0);
        assert_eq!(result.errors_detected, 0);
    }
}
