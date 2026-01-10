//! Application state.

use rdv_core::{auth::ServiceToken, Database};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicUsize};
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::RwLock;

use crate::config::Config;
use crate::services::{InsightService, MonitoringService};

/// CLI token entry for validation
#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct CLITokenEntry {
    pub token_hash: [u8; 32],
    pub user_id: String,
    pub token_id: String,
    pub name: String,
}

/// CLI token registry
#[derive(Debug, Default)]
pub struct CLITokenRegistry {
    tokens: RwLock<HashMap<String, CLITokenEntry>>,
}

impl CLITokenRegistry {
    pub fn new() -> Self {
        Self {
            tokens: RwLock::new(HashMap::new()),
        }
    }

    pub async fn validate(&self, token_bytes: &[u8]) -> Option<CLITokenEntry> {
        let tokens = self.tokens.read().await;
        // Simple comparison - in production would use constant-time comparison
        for entry in tokens.values() {
            if entry.token_hash == token_bytes {
                return Some(entry.clone());
            }
        }
        None
    }

    pub async fn add(&self, entry: CLITokenEntry) {
        let mut tokens = self.tokens.write().await;
        tokens.insert(entry.token_id.clone(), entry);
    }

    pub async fn remove(&self, token_id: &str) {
        let mut tokens = self.tokens.write().await;
        tokens.remove(token_id);
    }

    /// Load tokens from database entries
    pub async fn load_from_db(&self, entries: Vec<CLITokenEntry>) {
        let mut tokens = self.tokens.write().await;
        for entry in entries {
            tokens.insert(entry.token_id.clone(), entry);
        }
    }
}

/// Terminal WebSocket connection
#[allow(dead_code)]
pub struct TerminalConnection {
    pub session_id: String,
    pub connected_at: Instant,
}

/// Shared application state
#[derive(Clone)]
#[allow(dead_code)]
pub struct AppState {
    /// Server configuration
    pub config: Arc<Config>,
    /// Database connection
    pub db: Arc<Database>,
    /// Service token for Next.js authentication
    pub service_token: Arc<ServiceToken>,
    /// CLI token registry
    pub cli_tokens: Arc<CLITokenRegistry>,
    /// Active WebSocket connections
    pub terminal_connections: Arc<RwLock<HashMap<String, TerminalConnection>>>,
    /// Monitoring service for orchestrator stall detection
    pub monitoring: Arc<MonitoringService>,
    /// Insight service for managing orchestrator insights
    pub insights: Arc<InsightService>,
    /// Server start time
    pub start_time: Instant,
    /// Whether server is accepting connections
    pub accepting: Arc<AtomicBool>,
    /// Active request count
    pub active_requests: Arc<AtomicUsize>,
}

impl AppState {
    /// Create new application state
    pub fn new(config: Config, db: Database, service_token: ServiceToken) -> Arc<Self> {
        let db = Arc::new(db);
        Arc::new(Self {
            config: Arc::new(config),
            monitoring: Arc::new(MonitoringService::new(Arc::clone(&db))),
            insights: Arc::new(InsightService::new(Arc::clone(&db))),
            db,
            service_token: Arc::new(service_token),
            cli_tokens: Arc::new(CLITokenRegistry::new()),
            terminal_connections: Arc::new(RwLock::new(HashMap::new())),
            start_time: Instant::now(),
            accepting: Arc::new(AtomicBool::new(true)),
            active_requests: Arc::new(AtomicUsize::new(0)),
        })
    }
}
