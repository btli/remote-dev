//! API client for Remote Dev backend.
//!
//! Communicates with the Next.js API for:
//! - Session management
//! - Orchestrator operations
//! - Task management
//! - Scrollback capture

use anyhow::{Context, Result};
use reqwest::Client;
use serde::{Deserialize, Serialize};

use crate::config::Config;

/// API client for Remote Dev.
pub struct ApiClient {
    client: Client,
    base_url: String,
    api_key: Option<String>,
}

impl ApiClient {
    /// Create a new API client from config.
    pub fn new(config: &Config) -> Result<Self> {
        let client = Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .context("Failed to create HTTP client")?;

        Ok(Self {
            client,
            base_url: config.api.url.clone(),
            api_key: config.api.api_key.clone(),
        })
    }

    /// Build request with auth headers.
    fn request(&self, method: reqwest::Method, path: &str) -> reqwest::RequestBuilder {
        let url = format!("{}{}", self.base_url, path);
        let mut req = self.client.request(method, &url);

        if let Some(ref key) = self.api_key {
            req = req.bearer_auth(key);
        }

        req
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Orchestrator Operations
    // ─────────────────────────────────────────────────────────────────────────

    /// Get Master Control orchestrator for the current user.
    pub async fn get_master_control(&self) -> Result<Option<Orchestrator>> {
        let response = self
            .request(reqwest::Method::GET, "/api/orchestrators")
            .query(&[("type", "master")])
            .send()
            .await?;

        if response.status() == reqwest::StatusCode::NOT_FOUND {
            return Ok(None);
        }

        let orchestrators: Vec<Orchestrator> = response.json().await?;
        Ok(orchestrators.into_iter().find(|o| o.orchestrator_type == "master"))
    }

    /// Create Master Control orchestrator.
    pub async fn create_master_control(&self, session_id: &str) -> Result<Orchestrator> {
        let body = CreateOrchestratorRequest {
            orchestrator_type: "master".to_string(),
            session_id: session_id.to_string(),
            folder_id: None,
            config: OrchestratorConfig::default(),
        };

        let response = self
            .request(reqwest::Method::POST, "/api/orchestrators")
            .json(&body)
            .send()
            .await?
            .error_for_status()?;

        Ok(response.json().await?)
    }

    /// Get folder orchestrator.
    pub async fn get_folder_orchestrator(&self, folder_id: &str) -> Result<Option<Orchestrator>> {
        let path = format!("/api/folders/{}/orchestrator", folder_id);
        let response = self.request(reqwest::Method::GET, &path).send().await?;

        if response.status() == reqwest::StatusCode::NOT_FOUND {
            return Ok(None);
        }

        Ok(Some(response.json().await?))
    }

    /// Create folder orchestrator.
    pub async fn create_folder_orchestrator(
        &self,
        folder_id: &str,
        session_id: &str,
    ) -> Result<Orchestrator> {
        let body = CreateOrchestratorRequest {
            orchestrator_type: "folder".to_string(),
            session_id: session_id.to_string(),
            folder_id: Some(folder_id.to_string()),
            config: OrchestratorConfig::default(),
        };

        let path = format!("/api/folders/{}/orchestrator", folder_id);
        let response = self
            .request(reqwest::Method::POST, &path)
            .json(&body)
            .send()
            .await?
            .error_for_status()?;

        Ok(response.json().await?)
    }

    /// Update orchestrator status.
    pub async fn update_orchestrator_status(
        &self,
        orchestrator_id: &str,
        status: &str,
    ) -> Result<()> {
        let body = serde_json::json!({ "status": status });
        let path = format!("/api/orchestrators/{}", orchestrator_id);

        self.request(reqwest::Method::PATCH, &path)
            .json(&body)
            .send()
            .await?
            .error_for_status()?;

        Ok(())
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Session Operations
    // ─────────────────────────────────────────────────────────────────────────

    /// List sessions.
    pub async fn list_sessions(&self, folder_id: Option<&str>) -> Result<Vec<Session>> {
        let mut req = self.request(reqwest::Method::GET, "/api/sessions");

        if let Some(fid) = folder_id {
            req = req.query(&[("folderId", fid)]);
        }

        let response = req.send().await?.error_for_status()?;
        Ok(response.json().await?)
    }

    /// Create a new session.
    pub async fn create_session(&self, req: CreateSessionRequest) -> Result<Session> {
        let response = self
            .request(reqwest::Method::POST, "/api/sessions")
            .json(&req)
            .send()
            .await?
            .error_for_status()?;

        Ok(response.json().await?)
    }

    /// Get session details.
    pub async fn get_session(&self, session_id: &str) -> Result<Option<Session>> {
        let path = format!("/api/sessions/{}", session_id);
        let response = self.request(reqwest::Method::GET, &path).send().await?;

        if response.status() == reqwest::StatusCode::NOT_FOUND {
            return Ok(None);
        }

        Ok(Some(response.json().await?))
    }

    /// Get session scrollback.
    pub async fn get_scrollback(&self, session_id: &str, lines: u32) -> Result<String> {
        let path = format!("/api/sessions/{}/scrollback", session_id);
        let response = self
            .request(reqwest::Method::GET, &path)
            .query(&[("lines", lines.to_string())])
            .send()
            .await?
            .error_for_status()?;

        let result: ScrollbackResponse = response.json().await?;
        Ok(result.content)
    }

    /// Inject context into session.
    pub async fn inject_context(&self, session_id: &str, context: &str) -> Result<()> {
        let path = format!("/api/sessions/{}/exec", session_id);
        let body = serde_json::json!({ "command": context });

        self.request(reqwest::Method::POST, &path)
            .json(&body)
            .send()
            .await?
            .error_for_status()?;

        Ok(())
    }

    /// Close session.
    pub async fn close_session(&self, session_id: &str) -> Result<()> {
        let path = format!("/api/sessions/{}", session_id);
        self.request(reqwest::Method::DELETE, &path)
            .send()
            .await?
            .error_for_status()?;

        Ok(())
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Folder Operations
    // ─────────────────────────────────────────────────────────────────────────

    /// List folders.
    pub async fn list_folders(&self) -> Result<Vec<Folder>> {
        let response = self
            .request(reqwest::Method::GET, "/api/folders")
            .send()
            .await?
            .error_for_status()?;

        Ok(response.json().await?)
    }

    /// Get folder by path.
    pub async fn get_folder_by_path(&self, path: &str) -> Result<Option<Folder>> {
        let folders = self.list_folders().await?;
        Ok(folders.into_iter().find(|f| f.path.as_deref() == Some(path)))
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Health
    // ─────────────────────────────────────────────────────────────────────────

    /// Check API health.
    pub async fn health_check(&self) -> Result<bool> {
        let response = self
            .request(reqwest::Method::GET, "/api/health")
            .send()
            .await;

        Ok(response.map(|r| r.status().is_success()).unwrap_or(false))
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// API Types
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Orchestrator {
    pub id: String,
    #[serde(rename = "type")]
    pub orchestrator_type: String,
    pub status: String,
    pub session_id: String,
    pub folder_id: Option<String>,
    pub config: OrchestratorConfig,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct OrchestratorConfig {
    #[serde(default)]
    pub monitoring_enabled: bool,
    #[serde(default = "default_interval")]
    pub monitoring_interval_secs: u64,
    #[serde(default = "default_stall_threshold")]
    pub stall_threshold_secs: u64,
}

fn default_interval() -> u64 {
    30
}

fn default_stall_threshold() -> u64 {
    300
}

#[derive(Debug, Clone, Serialize)]
pub struct CreateOrchestratorRequest {
    #[serde(rename = "type")]
    pub orchestrator_type: String,
    pub session_id: String,
    pub folder_id: Option<String>,
    pub config: OrchestratorConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Session {
    pub id: String,
    pub name: String,
    pub status: String,
    pub tmux_session_name: Option<String>,
    pub folder_id: Option<String>,
    pub working_directory: Option<String>,
    pub agent_provider: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct CreateSessionRequest {
    pub name: String,
    pub folder_id: Option<String>,
    pub working_directory: Option<String>,
    pub agent_provider: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub worktree_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ScrollbackResponse {
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Folder {
    pub id: String,
    pub name: String,
    pub path: Option<String>,
    pub parent_id: Option<String>,
    pub created_at: String,
}
