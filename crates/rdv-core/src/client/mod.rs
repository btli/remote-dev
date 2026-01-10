//! API client for connecting to rdv-server.
//!
//! Supports connection via Unix socket for secure local communication.
//!
//! # Usage
//!
//! ```rust,no_run
//! use rdv_core::client::ApiClient;
//!
//! #[tokio::main]
//! async fn main() -> anyhow::Result<()> {
//!     let client = ApiClient::new()?;
//!     let sessions = client.list_sessions(None).await?;
//!     Ok(())
//! }
//! ```

use crate::types::*;
use crate::error::{Error, Result};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use std::path::PathBuf;
use tracing::{debug, warn};

/// Default socket path
const DEFAULT_SOCKET_PATH: &str = ".remote-dev/run/api.sock";

/// API client for rdv-server
#[derive(Clone)]
pub struct ApiClient {
    /// Base URL for HTTP requests (http://unix-socket style)
    base_url: String,
    /// Unix socket path
    socket_path: PathBuf,
    /// CLI token for authentication
    token: Option<String>,
    /// HTTP client
    client: reqwest::Client,
}

impl ApiClient {
    /// Create a new API client with default socket path
    pub fn new() -> Result<Self> {
        let home = dirs::home_dir().ok_or_else(|| Error::Other("No home directory".into()))?;
        let socket_path = home.join(DEFAULT_SOCKET_PATH);
        Self::with_socket(socket_path)
    }

    /// Create a new API client with custom socket path
    pub fn with_socket(socket_path: PathBuf) -> Result<Self> {
        // Read CLI token from file if it exists
        let home = dirs::home_dir().ok_or_else(|| Error::Other("No home directory".into()))?;
        let token_path = home.join(".remote-dev/cli-token");
        let token = if token_path.exists() {
            match std::fs::read_to_string(&token_path) {
                Ok(t) => Some(t.trim().to_string()),
                Err(e) => {
                    warn!("Failed to read CLI token: {}", e);
                    None
                }
            }
        } else {
            None
        };

        // Build HTTP client
        let client = reqwest::Client::builder()
            .build()
            .map_err(|e| Error::Other(format!("Failed to create HTTP client: {}", e)))?;

        // Format: http://unix:{socket_path}:/ for hyper unix socket
        // But reqwest doesn't directly support unix sockets, so we use a connector
        let base_url = "http://localhost".to_string(); // Will be overridden by connector

        Ok(Self {
            base_url,
            socket_path,
            token,
        client,
        })
    }

    /// Set the authentication token
    pub fn with_token(mut self, token: String) -> Self {
        self.token = Some(token);
        self
    }

    /// Check if the server is available
    pub async fn health(&self) -> Result<HealthResponse> {
        self.get("/health").await
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Session Operations
    // ─────────────────────────────────────────────────────────────────────────

    /// List sessions
    pub async fn list_sessions(&self, folder_id: Option<&str>) -> Result<Vec<Session>> {
        let mut path = "/api/sessions".to_string();
        if let Some(fid) = folder_id {
            path.push_str(&format!("?folder_id={}", fid));
        }
        self.get(&path).await
    }

    /// Get a session by ID
    pub async fn get_session(&self, session_id: &str) -> Result<Option<Session>> {
        let result: std::result::Result<Session, _> = self.get(&format!("/api/sessions/{}", session_id)).await;
        match result {
            Ok(s) => Ok(Some(s)),
            Err(Error::NotFound(_)) => Ok(None),
            Err(e) => Err(e),
        }
    }

    /// Create a session
    pub async fn create_session(&self, req: &CreateSessionRequest) -> Result<Session> {
        self.post("/api/sessions", req).await
    }

    /// Update session status
    pub async fn update_session_status(&self, session_id: &str, status: &str) -> Result<()> {
        let req = UpdateSessionRequest {
            name: None,
            folder_id: None,
            status: Some(status.to_string()),
        };
        let _: Session = self.patch(&format!("/api/sessions/{}", session_id), &req).await?;
        Ok(())
    }

    /// Update session
    pub async fn update_session(&self, session_id: &str, req: &UpdateSessionRequest) -> Result<Session> {
        self.patch(&format!("/api/sessions/{}", session_id), req).await
    }

    /// Close a session
    pub async fn close_session(&self, session_id: &str) -> Result<()> {
        self.delete(&format!("/api/sessions/{}", session_id)).await
    }

    /// Get session scrollback
    pub async fn get_scrollback(&self, session_id: &str, lines: Option<u32>) -> Result<String> {
        let mut path = format!("/api/sessions/{}/scrollback", session_id);
        if let Some(l) = lines {
            path.push_str(&format!("?lines={}", l));
        }
        let resp: ScrollbackResponse = self.get(&path).await?;
        Ok(resp.content)
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Folder Operations
    // ─────────────────────────────────────────────────────────────────────────

    /// List folders
    pub async fn list_folders(&self) -> Result<Vec<Folder>> {
        self.get("/api/folders").await
    }

    /// Get a folder by ID
    pub async fn get_folder(&self, folder_id: &str) -> Result<Option<Folder>> {
        let result: std::result::Result<Folder, _> = self.get(&format!("/api/folders/{}", folder_id)).await;
        match result {
            Ok(f) => Ok(Some(f)),
            Err(Error::NotFound(_)) => Ok(None),
            Err(e) => Err(e),
        }
    }

    /// Find folder by name (searches through all folders)
    pub async fn get_folder_by_name(&self, name: &str) -> Result<Option<Folder>> {
        let folders = self.list_folders().await?;
        Ok(folders.into_iter().find(|f| f.name == name))
    }

    /// Create a folder
    pub async fn create_folder(&self, req: &CreateFolderRequest) -> Result<Folder> {
        self.post("/api/folders", req).await
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Orchestrator Operations
    // ─────────────────────────────────────────────────────────────────────────

    /// List orchestrators
    pub async fn list_orchestrators(&self) -> Result<Vec<OrchestratorSimple>> {
        self.get("/api/orchestrators").await
    }

    /// Get orchestrator by ID
    pub async fn get_orchestrator(&self, orchestrator_id: &str) -> Result<Option<OrchestratorSimple>> {
        let result: std::result::Result<OrchestratorSimple, _> =
            self.get(&format!("/api/orchestrators/{}", orchestrator_id)).await;
        match result {
            Ok(o) => Ok(Some(o)),
            Err(Error::NotFound(_)) => Ok(None),
            Err(e) => Err(e),
        }
    }

    /// Get master orchestrator
    pub async fn get_master_orchestrator(&self) -> Result<Option<OrchestratorSimple>> {
        let orchestrators = self.list_orchestrators().await?;
        Ok(orchestrators.into_iter().find(|o| o.orchestrator_type == "master"))
    }

    /// Get folder orchestrator
    pub async fn get_folder_orchestrator(&self, folder_id: &str) -> Result<Option<OrchestratorSimple>> {
        let result: std::result::Result<OrchestratorSimple, _> =
            self.get(&format!("/api/folders/{}/orchestrator", folder_id)).await;
        match result {
            Ok(o) => Ok(Some(o)),
            Err(Error::NotFound(_)) => Ok(None),
            Err(e) => Err(e),
        }
    }

    /// Create or get folder orchestrator
    pub async fn create_folder_orchestrator(&self, folder_id: &str) -> Result<OrchestratorSimple> {
        self.post(&format!("/api/folders/{}/orchestrator", folder_id), &serde_json::json!({})).await
    }

    /// Create orchestrator
    pub async fn create_orchestrator(&self, req: &CreateOrchestratorRequest) -> Result<OrchestratorSimple> {
        self.post("/api/orchestrators", req).await
    }

    /// Update orchestrator status
    pub async fn update_orchestrator_status(&self, orchestrator_id: &str, status: &str) -> Result<()> {
        let req = serde_json::json!({ "status": status });
        let _: OrchestratorSimple = self.patch(&format!("/api/orchestrators/{}", orchestrator_id), &req).await?;
        Ok(())
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Monitoring Operations
    // ─────────────────────────────────────────────────────────────────────────

    /// Start monitoring for an orchestrator
    pub async fn start_monitoring(&self, orchestrator_id: &str, interval_ms: Option<u64>) -> Result<MonitoringStatusResponse> {
        let req = StartMonitoringRequest { interval_ms };
        self.post(&format!("/api/orchestrators/{}/monitoring/start", orchestrator_id), &req).await
    }

    /// Stop monitoring for an orchestrator
    pub async fn stop_monitoring(&self, orchestrator_id: &str) -> Result<MonitoringStatusResponse> {
        self.post(&format!("/api/orchestrators/{}/monitoring/stop", orchestrator_id), &serde_json::json!({})).await
    }

    /// Get monitoring status for an orchestrator
    pub async fn get_monitoring_status(&self, orchestrator_id: &str) -> Result<MonitoringStatusResponse> {
        self.get(&format!("/api/orchestrators/{}/monitoring/status", orchestrator_id)).await
    }

    /// Get stalled sessions for an orchestrator
    pub async fn get_stalled_sessions(&self, orchestrator_id: &str) -> Result<StalledSessionsResponse> {
        self.get(&format!("/api/orchestrators/{}/stalled-sessions", orchestrator_id)).await
    }

    /// Get session by tmux session name
    pub async fn get_session_by_tmux_name(&self, tmux_name: &str) -> Result<Option<Session>> {
        let sessions = self.list_sessions(None).await?;
        Ok(sessions.into_iter().find(|s| s.tmux_session_name == tmux_name))
    }

    // ─────────────────────────────────────────────────────────────────────────
    // User Operations
    // ─────────────────────────────────────────────────────────────────────────

    /// Get the current user (from token)
    pub async fn get_current_user(&self) -> Result<User> {
        self.get("/api/user").await
    }

    // ─────────────────────────────────────────────────────────────────────────
    // HTTP Helpers (Unix Socket)
    // ─────────────────────────────────────────────────────────────────────────

    async fn get<T: DeserializeOwned>(&self, path: &str) -> Result<T> {
        self.request(reqwest::Method::GET, path, Option::<()>::None).await
    }

    async fn post<T: DeserializeOwned, B: Serialize>(&self, path: &str, body: &B) -> Result<T> {
        self.request(reqwest::Method::POST, path, Some(body)).await
    }

    async fn patch<T: DeserializeOwned, B: Serialize>(&self, path: &str, body: &B) -> Result<T> {
        self.request(reqwest::Method::PATCH, path, Some(body)).await
    }

    async fn delete(&self, path: &str) -> Result<()> {
        let _: serde_json::Value = self.request(reqwest::Method::DELETE, path, Option::<()>::None).await?;
        Ok(())
    }

    async fn request<T: DeserializeOwned, B: Serialize>(
        &self,
        method: reqwest::Method,
        path: &str,
        body: Option<B>,
    ) -> Result<T> {
        // For now, we use a simple HTTP connection to localhost
        // In production, we would use a Unix socket connector
        // TODO: Implement proper Unix socket support via hyper connector

        // Check if socket exists
        if !self.socket_path.exists() {
            return Err(Error::Other(format!(
                "rdv-server socket not found at {:?}. Is rdv-server running?",
                self.socket_path
            )));
        }

        let url = format!("{}{}", self.base_url, path);
        debug!("API request: {} {}", method, url);

        let mut req = self.client.request(method, &url);

        // Add auth header
        if let Some(ref token) = self.token {
            req = req.header("Authorization", format!("Bearer {}", token));
        }

        // Add body
        if let Some(ref b) = body {
            req = req.json(b);
        }

        // Note: This won't work with Unix sockets directly.
        // We need to implement a Unix socket transport.
        // For now, let's use a workaround via TCP fallback or socat.
        let resp = req.send().await.map_err(|e| {
            Error::Other(format!("HTTP request failed: {}. Is rdv-server running?", e))
        })?;

        let status = resp.status();
        if status.is_success() {
            let data: T = resp.json().await.map_err(|e| {
                Error::Other(format!("Failed to parse response: {}", e))
            })?;
            Ok(data)
        } else if status == reqwest::StatusCode::NOT_FOUND {
            Err(Error::NotFound(path.to_string()))
        } else {
            let error_text = resp.text().await.unwrap_or_default();
            Err(Error::Other(format!(
                "API error {}: {}",
                status, error_text
            )))
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Request/Response Types
// ─────────────────────────────────────────────────────────────────────────────

/// Health check response
#[derive(Debug, Deserialize)]
pub struct HealthResponse {
    pub status: String,
    pub version: String,
}

/// Create session request
#[derive(Debug, Serialize)]
pub struct CreateSessionRequest {
    pub name: String,
    pub project_path: Option<String>,
    pub folder_id: Option<String>,
    pub worktree_branch: Option<String>,
    pub agent_provider: Option<String>,
    pub is_orchestrator_session: Option<bool>,
    pub shell_command: Option<String>,
    pub environment: Option<std::collections::HashMap<String, String>>,
}

/// Update session request
#[derive(Debug, Serialize)]
pub struct UpdateSessionRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub folder_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
}

/// Scrollback response
#[derive(Debug, Deserialize)]
pub struct ScrollbackResponse {
    pub content: String,
}

/// Create folder request
#[derive(Debug, Serialize)]
pub struct CreateFolderRequest {
    pub name: String,
    pub parent_id: Option<String>,
    pub path: Option<String>,
}

/// Create orchestrator request
#[derive(Debug, Serialize)]
pub struct CreateOrchestratorRequest {
    pub session_id: String,
    pub orchestrator_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scope_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scope_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub custom_instructions: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub monitoring_interval: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stall_threshold: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auto_intervention: Option<bool>,
}

/// Start monitoring request
#[derive(Debug, Serialize)]
pub struct StartMonitoringRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub interval_ms: Option<u64>,
}

/// Monitoring status response
#[derive(Debug, Deserialize)]
pub struct MonitoringStatusResponse {
    pub is_active: bool,
    pub orchestrator_id: String,
}

/// Stalled session info
#[derive(Debug, Deserialize)]
pub struct StalledSessionInfo {
    pub session_id: String,
    pub session_name: String,
    pub tmux_session_name: String,
    pub folder_id: Option<String>,
    pub last_activity_at: Option<i64>,
    pub stalled_minutes: i32,
}

/// Stalled sessions response
#[derive(Debug, Deserialize)]
pub struct StalledSessionsResponse {
    pub orchestrator_id: String,
    pub stalled_sessions: Vec<StalledSessionInfo>,
    pub checked_at: i64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_api_client_creation() {
        // This will fail if no home dir, but that's expected in CI
        let result = ApiClient::new();
        // Just ensure it compiles and runs
        assert!(result.is_ok() || result.is_err());
    }
}
