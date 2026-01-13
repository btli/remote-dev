//! Logs routes for rdv-server.
//!
//! Provides endpoints for fetching and streaming execution logs:
//! - GET /logs - Fetch execution logs with filters
//! - GET /logs/stream - Stream logs in real-time (SSE)

use axum::{
    extract::{Query, State},
    http::StatusCode,
    response::sse::{Event, KeepAlive, Sse},
    routing::get,
    Extension, Json, Router,
};
use futures::stream::Stream;
use rdv_core::types::Delegation;
use serde::{Deserialize, Serialize};
use std::{convert::Infallible, sync::Arc, time::Duration};
use tokio_stream::StreamExt;

use crate::middleware::AuthContext;
use crate::state::AppState;

/// Create logs router
pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/logs", get(list_logs))
        .route("/logs/stream", get(stream_logs))
}

// ============================================================================
// Request/Response Types
// ============================================================================

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListLogsQuery {
    pub session_id: Option<String>,
    pub orchestrator_id: Option<String>,
    pub folder_id: Option<String>,
    pub level: Option<String>,
    pub source: Option<String>,
    pub limit: Option<usize>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogEntry {
    pub id: String,
    pub timestamp: i64,
    pub level: String,
    pub source: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration: Option<i32>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListLogsResponse {
    pub logs: Vec<LogEntry>,
    pub total: usize,
    pub has_more: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamLogsQuery {
    pub session_id: Option<String>,
}

// ============================================================================
// Route Handlers
// ============================================================================

/// List execution logs with filters
pub async fn list_logs(
    State(state): State<Arc<AppState>>,
    Extension(auth): Extension<AuthContext>,
    Query(query): Query<ListLogsQuery>,
) -> Result<Json<ListLogsResponse>, (StatusCode, String)> {
    let user_id = auth.user_id();
    let limit = query.limit.unwrap_or(100).min(1000);

    let mut logs: Vec<LogEntry> = Vec::new();

    // Fetch execution logs from delegations
    if query.orchestrator_id.is_none() {
        // Get delegations for user's sessions
        let sessions = state
            .db
            .list_sessions(user_id, query.folder_id.as_deref())
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

        for session in sessions.iter().take(20) {
            // Filter by session_id if specified
            if let Some(ref sid) = query.session_id {
                if &session.id != sid {
                    continue;
                }
            }

            let delegations = state
                .db
                .list_delegations(Some(&session.id), None, None, Some(10))
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

            for delegation in delegations {
                parse_delegation_logs(&delegation, &query, &mut logs);
            }
        }
    }

    // Fetch orchestrator audit logs
    let audit_logs = if let Some(ref oid) = query.orchestrator_id {
        state
            .db
            .list_audit_logs(oid, None, None, None, None, limit)
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    } else {
        // Get all user's orchestrators
        let orchestrators = state
            .db
            .list_orchestrators(user_id)
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

        let mut all_audit_logs = Vec::new();
        for orch in orchestrators {
            let orch_logs = state
                .db
                .list_audit_logs(&orch.id, None, None, None, None, 50)
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
            all_audit_logs.extend(orch_logs);
        }
        all_audit_logs
    };

    for audit in audit_logs {
        // Determine log level from action type
        let log_level = match audit.action_type.as_str() {
            "insight_generated" => "warn",
            "command_injected" => "info",
            _ => "info",
        };

        // Apply level filter
        if let Some(ref level) = query.level {
            if log_level != level {
                continue;
            }
        }

        // Apply source filter
        if let Some(ref source) = query.source {
            if source != "system" {
                continue;
            }
        }

        let details: Option<serde_json::Value> = audit
            .details
            .as_ref()
            .and_then(|d| serde_json::from_str(d).ok());

        logs.push(LogEntry {
            id: audit.id.clone(),
            timestamp: audit.created_at,
            level: log_level.to_string(),
            source: "system".to_string(),
            message: format_audit_message(&audit.action_type, details.as_ref()),
            metadata: details,
            session_id: audit.session_id,
            command: None,
            duration: None,
        });
    }

    // Sort logs by timestamp descending
    logs.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));

    let total = logs.len();
    let has_more = total > limit;
    logs.truncate(limit);

    Ok(Json(ListLogsResponse {
        logs,
        total,
        has_more,
    }))
}

/// Stream logs in real-time via SSE
pub async fn stream_logs(
    State(state): State<Arc<AppState>>,
    Extension(auth): Extension<AuthContext>,
    Query(query): Query<StreamLogsQuery>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let user_id = auth.user_id().to_string();
    let session_id = query.session_id.clone();

    // Send initial connection message
    let initial_msg = LogEntry {
        id: format!("log-{}-init", chrono::Utc::now().timestamp_millis()),
        timestamp: chrono::Utc::now().timestamp_millis(),
        level: "info".to_string(),
        source: "system".to_string(),
        message: format!(
            "Log stream connected{}",
            session_id
                .as_ref()
                .map(|s| format!(" for session {}...", &s[..8.min(s.len())]))
                .unwrap_or_default()
        ),
        metadata: None,
        session_id: session_id.clone(),
        command: None,
        duration: None,
    };

    // Create a stream that polls for new logs every 2 seconds
    let stream = async_stream::stream! {
        // Send initial message
        yield Ok(Event::default()
            .json_data(&initial_msg)
            .unwrap_or_else(|_| Event::default().data("{}")));

        let mut last_count = 0usize;

        loop {
            tokio::time::sleep(Duration::from_secs(2)).await;

            // Poll for new delegation logs
            let sessions = state
                .db
                .list_sessions(&user_id, None)
                .unwrap_or_default();

            let mut new_logs = Vec::new();

            for session in sessions.iter().take(10) {
                if let Some(ref sid) = session_id {
                    if &session.id != sid {
                        continue;
                    }
                }

                let delegations = state
                    .db
                    .list_delegations(Some(&session.id), None, None, Some(5))
                    .unwrap_or_default();

                for delegation in delegations {
                    if let Ok(logs) = serde_json::from_str::<Vec<serde_json::Value>>(
                        &delegation.execution_logs_json,
                    ) {
                        if logs.len() > last_count {
                            for log in logs.iter().skip(last_count) {
                                let entry = LogEntry {
                                    id: format!(
                                        "log-{}-{}",
                                        chrono::Utc::now().timestamp_millis(),
                                        new_logs.len()
                                    ),
                                    timestamp: log
                                        .get("timestamp")
                                        .and_then(|t| t.as_str())
                                        .and_then(|t| chrono::DateTime::parse_from_rfc3339(t).ok())
                                        .map(|t| t.timestamp_millis())
                                        .unwrap_or_else(|| chrono::Utc::now().timestamp_millis()),
                                    level: log
                                        .get("level")
                                        .and_then(|l| l.as_str())
                                        .unwrap_or("info")
                                        .to_string(),
                                    source: "agent".to_string(),
                                    message: log
                                        .get("message")
                                        .and_then(|m| m.as_str())
                                        .unwrap_or("")
                                        .to_string(),
                                    metadata: log.get("metadata").cloned(),
                                    session_id: Some(delegation.session_id.clone()),
                                    command: None,
                                    duration: None,
                                };
                                new_logs.push(entry);
                            }
                            last_count = logs.len();
                        }
                    }
                }
            }

            // Yield events for new logs
            for log in new_logs {
                yield Ok(Event::default()
                    .json_data(&log)
                    .unwrap_or_else(|_| Event::default().data("{}")));
            }

            // Send heartbeat
            yield Ok(Event::default().comment("heartbeat"));
        }
    };

    Sse::new(stream).keep_alive(KeepAlive::default())
}

// ============================================================================
// Helper Functions
// ============================================================================

/// Parse execution logs from a delegation
fn parse_delegation_logs(delegation: &Delegation, query: &ListLogsQuery, logs: &mut Vec<LogEntry>) {
    if let Ok(execution_logs) =
        serde_json::from_str::<Vec<serde_json::Value>>(&delegation.execution_logs_json)
    {
        for (i, log) in execution_logs.iter().enumerate() {
            let log_level = log
                .get("level")
                .and_then(|l| l.as_str())
                .unwrap_or("info");

            // Apply level filter
            if let Some(ref level) = query.level {
                if log_level != level {
                    continue;
                }
            }

            // Apply source filter
            if let Some(ref source) = query.source {
                if source != "agent" {
                    continue;
                }
            }

            logs.push(LogEntry {
                id: format!("{}-{}", delegation.id, i),
                timestamp: log
                    .get("timestamp")
                    .and_then(|t| t.as_str())
                    .and_then(|t| chrono::DateTime::parse_from_rfc3339(t).ok())
                    .map(|t| t.timestamp_millis())
                    .unwrap_or(delegation.created_at),
                level: log_level.to_string(),
                source: "agent".to_string(),
                message: log
                    .get("message")
                    .and_then(|m| m.as_str())
                    .unwrap_or("")
                    .to_string(),
                metadata: log.get("metadata").cloned(),
                session_id: Some(delegation.session_id.clone()),
                command: None,
                duration: None,
            });
        }
    }
}

/// Format audit log action type into human-readable message
fn format_audit_message(action_type: &str, details: Option<&serde_json::Value>) -> String {
    match action_type {
        "command_injected" => {
            let cmd = details
                .and_then(|d| d.get("command"))
                .and_then(|c| c.as_str())
                .unwrap_or("unknown");
            format!("Command injected: {}", cmd)
        }
        "status_changed" => {
            let status = details
                .and_then(|d| d.get("newStatus"))
                .and_then(|s| s.as_str())
                .unwrap_or("unknown");
            format!("Status changed to: {}", status)
        }
        "insight_generated" => {
            let title = details
                .and_then(|d| d.get("title"))
                .and_then(|t| t.as_str())
                .unwrap_or("unknown");
            format!("Insight generated: {}", title)
        }
        "session_monitored" => "Session monitoring cycle completed".to_string(),
        "config_changed" => {
            let field = details
                .and_then(|d| d.get("field"))
                .and_then(|f| f.as_str())
                .unwrap_or("unknown");
            format!("Configuration changed: {}", field)
        }
        _ => action_type.replace('_', " "),
    }
}
