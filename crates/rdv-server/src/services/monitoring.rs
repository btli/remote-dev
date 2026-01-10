//! MonitoringService - Event-driven orchestrator monitoring
//!
//! This service provides event-driven monitoring of terminal sessions.
//! Instead of polling scrollback, it relies on agent hooks to report activity via heartbeats.
//!
//! Architecture:
//! - Agent hooks send heartbeats to update session.lastActivityAt timestamps
//! - Stall detection checks if lastActivityAt exceeds threshold
//! - Scrollback capture is on-demand for diagnostics only
//!
//! Hierarchy: Agent Hooks → Folder Orchestrator → Master Control (escalation)

use rdv_core::tmux;
use rdv_core::Database;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{Mutex, RwLock};
use tokio::time::{interval, Duration};
use tracing::{debug, error, info};

/// Stalled session information
#[derive(Debug, Clone)]
pub struct StalledSession {
    pub session_id: String,
    pub session_name: String,
    pub tmux_session_name: String,
    pub folder_id: Option<String>,
    pub last_activity_at: Option<i64>,
    pub stalled_minutes: i32,
}

/// Stall check result
#[derive(Debug)]
pub struct StallCheckResult {
    pub orchestrator_id: String,
    pub stalled_sessions: Vec<StalledSession>,
    pub checked_at: i64,
}

/// Handle for a running monitoring task
struct MonitoringHandle {
    abort_handle: tokio::task::AbortHandle,
    user_id: String,
    interval_ms: u64,
}

/// MonitoringService manages stall checking for orchestrators
pub struct MonitoringService {
    db: Arc<Database>,
    /// Active stall checks: orchestrator_id -> MonitoringHandle
    active_checks: RwLock<HashMap<String, MonitoringHandle>>,
    /// Lock for starting/stopping operations
    operation_lock: Mutex<()>,
}

impl MonitoringService {
    /// Create a new monitoring service
    pub fn new(db: Arc<Database>) -> Self {
        Self {
            db,
            active_checks: RwLock::new(HashMap::new()),
            operation_lock: Mutex::new(()),
        }
    }

    /// Check for stalled sessions for an orchestrator
    ///
    /// A session is considered stalled if:
    /// - lastActivityAt is older than stallThreshold
    /// - OR lastActivityAt is null and session is active
    ///
    /// This is a lightweight check - it only reads timestamps from the database.
    pub fn check_for_stalled_sessions(
        &self,
        orchestrator_id: &str,
        user_id: &str,
    ) -> Result<StallCheckResult, String> {
        // Get orchestrator configuration
        let orchestrator = self
            .db
            .get_master_orchestrator(user_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Orchestrator not found".to_string())?;

        // Verify orchestrator ID matches (in case of folder orchestrators)
        if orchestrator.id != orchestrator_id {
            // Try to get by specific ID
            let orchestrator = self
                .db
                .get_orchestrator(orchestrator_id)
                .map_err(|e| e.to_string())?
                .ok_or_else(|| "Orchestrator not found".to_string())?;

            // Verify ownership
            if orchestrator.user_id != user_id {
                return Err("Access denied".to_string());
            }
        }

        let stall_threshold_secs = orchestrator.stall_threshold as i64;

        // Get stalled sessions from database
        let stalled = self
            .db
            .get_stalled_sessions(user_id, stall_threshold_secs)
            .map_err(|e| e.to_string())?;

        let stalled_sessions: Vec<StalledSession> = stalled
            .into_iter()
            .map(|s| StalledSession {
                session_id: s.session_id,
                session_name: s.session_name,
                tmux_session_name: s.tmux_session_name,
                folder_id: s.folder_id,
                last_activity_at: s.last_activity_at,
                stalled_minutes: s.stalled_minutes,
            })
            .collect();

        Ok(StallCheckResult {
            orchestrator_id: orchestrator_id.to_string(),
            stalled_sessions,
            checked_at: chrono::Utc::now().timestamp_millis(),
        })
    }

    /// Capture scrollback for a session (on-demand diagnostic tool)
    ///
    /// This should only be called when investigating a potentially stalled session,
    /// not as part of regular monitoring.
    pub fn capture_session_scrollback(
        &self,
        tmux_session_name: &str,
        lines: Option<u32>,
    ) -> Result<String, String> {
        // Check if tmux session exists
        if !tmux::session_exists(tmux_session_name).map_err(|e| e.to_string())? {
            return Err(format!("Session {} does not exist", tmux_session_name));
        }

        // Capture scrollback
        let line_count = lines.unwrap_or(100);
        tmux::capture_pane(tmux_session_name, Some(line_count))
            .map_err(|e| e.to_string())
    }

    /// Start periodic stall checking for an orchestrator
    ///
    /// This is a lightweight operation - it only checks timestamps in the database.
    /// Unlike the old polling approach, it does NOT capture scrollback on every cycle.
    pub async fn start_stall_checking(
        self: Arc<Self>,
        orchestrator_id: String,
        user_id: String,
        interval_ms: u64,
    ) {
        let _lock = self.operation_lock.lock().await;

        // Stop existing check if any
        self.stop_stall_checking_inner(&orchestrator_id).await;

        let interval_secs = interval_ms / 1000;
        info!(
            orchestrator_id = %orchestrator_id,
            interval_secs = interval_secs,
            "Starting stall checking"
        );

        // Clone values for the spawned task
        let service = Arc::clone(&self);
        let orch_id = orchestrator_id.clone();
        let u_id = user_id.clone();

        // Spawn the monitoring task
        let handle = tokio::spawn(async move {
            let mut check_interval = interval(Duration::from_millis(interval_ms));

            loop {
                check_interval.tick().await;

                match service.check_for_stalled_sessions(&orch_id, &u_id) {
                    Ok(result) => {
                        if !result.stalled_sessions.is_empty() {
                            info!(
                                orchestrator_id = %orch_id,
                                stalled_count = result.stalled_sessions.len(),
                                "Found potentially stalled sessions"
                            );

                            // Log stalled sessions for debugging
                            for session in &result.stalled_sessions {
                                debug!(
                                    session_name = %session.session_name,
                                    stalled_minutes = session.stalled_minutes,
                                    "Stalled session detected"
                                );

                                // Check if we already have an insight for this session
                                let has_insight = service
                                    .db
                                    .has_unresolved_stall_insight(&session.session_id)
                                    .unwrap_or(false);

                                if !has_insight {
                                    // Create a new insight
                                    if let Err(e) = service.create_stall_insight(
                                        &orch_id,
                                        session,
                                    ) {
                                        error!(
                                            error = %e,
                                            session_id = %session.session_id,
                                            "Failed to create stall insight"
                                        );
                                    }
                                }
                            }
                        }
                    }
                    Err(e) => {
                        error!(
                            orchestrator_id = %orch_id,
                            error = %e,
                            "Stall check failed"
                        );
                    }
                }
            }
        });

        // Store the handle
        let mut checks = self.active_checks.write().await;
        checks.insert(
            orchestrator_id.clone(),
            MonitoringHandle {
                abort_handle: handle.abort_handle(),
                user_id,
                interval_ms,
            },
        );
    }

    /// Create an insight for a stalled session
    fn create_stall_insight(
        &self,
        orchestrator_id: &str,
        session: &StalledSession,
    ) -> Result<(), String> {
        let insight = rdv_core::db::NewInsight {
            orchestrator_id: orchestrator_id.to_string(),
            session_id: Some(session.session_id.clone()),
            insight_type: "stall".to_string(),
            severity: if session.stalled_minutes > 10 {
                "high".to_string()
            } else {
                "medium".to_string()
            },
            title: format!(
                "Session '{}' appears stalled ({} min)",
                session.session_name, session.stalled_minutes
            ),
            description: format!(
                "No activity detected for {} minutes. The agent may be waiting for input or stuck.",
                session.stalled_minutes
            ),
            context: Some(format!(
                "{{\"tmux_session\": \"{}\", \"stalled_minutes\": {}}}",
                session.tmux_session_name, session.stalled_minutes
            )),
            suggested_actions: Some(
                "[\"Check agent logs\", \"Provide hint via command injection\", \"Resume or restart session\"]"
                    .to_string(),
            ),
        };

        self.db.create_insight(&insight).map_err(|e| e.to_string())?;
        info!(
            session_id = %session.session_id,
            "Created stall insight"
        );

        Ok(())
    }

    /// Stop stall checking for an orchestrator (internal, assumes lock is held)
    async fn stop_stall_checking_inner(&self, orchestrator_id: &str) {
        let mut checks = self.active_checks.write().await;
        if let Some(handle) = checks.remove(orchestrator_id) {
            handle.abort_handle.abort();
            info!(orchestrator_id = %orchestrator_id, "Stopped stall checking");
        }
    }

    /// Stop stall checking for an orchestrator
    pub async fn stop_stall_checking(&self, orchestrator_id: &str) {
        let _lock = self.operation_lock.lock().await;
        self.stop_stall_checking_inner(orchestrator_id).await;
    }

    /// Check if stall checking is active for an orchestrator
    pub async fn is_stall_checking_active(&self, orchestrator_id: &str) -> bool {
        let checks = self.active_checks.read().await;
        checks.contains_key(orchestrator_id)
    }

    /// Get all active stall checking orchestrators
    pub async fn get_active_stall_checks(&self) -> Vec<String> {
        let checks = self.active_checks.read().await;
        checks.keys().cloned().collect()
    }

    /// Stop all stall checking
    pub async fn stop_all_stall_checking(&self) {
        let _lock = self.operation_lock.lock().await;
        let mut checks = self.active_checks.write().await;

        for (orchestrator_id, handle) in checks.drain() {
            handle.abort_handle.abort();
            info!(orchestrator_id = %orchestrator_id, "Stopped stall checking");
        }
    }

    /// Initialize stall checking for all active orchestrators
    /// Call this on server startup
    pub async fn initialize_monitoring(self: Arc<Self>) {
        info!("Initializing event-driven monitoring...");

        // Get all idle (non-paused) orchestrators
        // For now, we'll need to query all users' orchestrators
        // In practice, this should be scoped to known active users

        // Note: In the current architecture, we don't have a way to enumerate all
        // active orchestrators across all users without querying by user_id.
        // The TypeScript version does this by querying all orchestrators with status='idle'.
        //
        // For now, monitoring will be started on-demand when:
        // 1. Orchestrator API routes are called (resume, etc.)
        // 2. A new orchestrator is created
        //
        // TODO: Add a get_all_idle_orchestrators() method to rdv-core for startup init

        info!("Event-driven monitoring initialized (on-demand mode)");
    }
}
