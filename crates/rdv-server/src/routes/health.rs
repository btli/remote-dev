//! Health check endpoint.

use axum::{extract::State, Json};
use rdv_core::tmux;
use serde::Serialize;
use std::sync::Arc;

use crate::state::AppState;

#[derive(Serialize)]
pub struct HealthStatus {
    pub status: String,
    pub version: String,
    pub uptime_seconds: u64,
    pub components: HealthComponents,
    pub metrics: HealthMetrics,
}

#[derive(Serialize)]
pub struct HealthComponents {
    pub database: bool,
    pub tmux: bool,
}

#[derive(Serialize)]
pub struct HealthMetrics {
    pub active_sessions: u32,
    pub websocket_connections: usize,
    pub pending_requests: usize,
}

/// Health check endpoint
pub async fn health_check(State(state): State<Arc<AppState>>) -> Json<HealthStatus> {
    // Check database
    let db_healthy = state.db.ping().is_ok();

    // Check tmux
    let tmux_healthy = tmux::check_tmux().is_ok();

    // Count active sessions from database
    let active_sessions = state
        .db
        .count_active_sessions()
        .unwrap_or(0);

    // Count WebSocket connections
    let ws_connections = state.terminal_connections.read().await.len();

    // Get pending request count
    let pending_requests = state
        .active_requests
        .load(std::sync::atomic::Ordering::SeqCst);

    let status = if db_healthy && tmux_healthy {
        "healthy"
    } else {
        "degraded"
    };

    Json(HealthStatus {
        status: status.to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        uptime_seconds: state.start_time.elapsed().as_secs(),
        components: HealthComponents {
            database: db_healthy,
            tmux: tmux_healthy,
        },
        metrics: HealthMetrics {
            active_sessions,
            websocket_connections: ws_connections,
            pending_requests,
        },
    })
}
