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

#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_entry(id: &str, user_id: &str, hash: [u8; 32]) -> CLITokenEntry {
        CLITokenEntry {
            token_hash: hash,
            user_id: user_id.to_string(),
            token_id: id.to_string(),
            name: format!("test-token-{}", id),
        }
    }

    #[tokio::test]
    async fn test_cli_token_registry_new() {
        let registry = CLITokenRegistry::new();
        // Should start empty - no tokens to validate
        let result = registry.validate(&[0u8; 32]).await;
        assert!(result.is_none());
    }

    #[tokio::test]
    async fn test_cli_token_registry_add_and_validate() {
        let registry = CLITokenRegistry::new();
        let hash = [1u8; 32];
        let entry = create_test_entry("token-1", "user-1", hash);

        registry.add(entry.clone()).await;

        // Should find the token
        let result = registry.validate(&hash).await;
        assert!(result.is_some());
        let found = result.unwrap();
        assert_eq!(found.token_id, "token-1");
        assert_eq!(found.user_id, "user-1");
    }

    #[tokio::test]
    async fn test_cli_token_registry_validate_not_found() {
        let registry = CLITokenRegistry::new();
        let hash = [1u8; 32];
        let entry = create_test_entry("token-1", "user-1", hash);

        registry.add(entry).await;

        // Different hash should not be found
        let different_hash = [2u8; 32];
        let result = registry.validate(&different_hash).await;
        assert!(result.is_none());
    }

    #[tokio::test]
    async fn test_cli_token_registry_remove() {
        let registry = CLITokenRegistry::new();
        let hash = [1u8; 32];
        let entry = create_test_entry("token-1", "user-1", hash);

        registry.add(entry).await;

        // Should find the token
        assert!(registry.validate(&hash).await.is_some());

        // Remove the token
        registry.remove("token-1").await;

        // Should no longer find the token
        assert!(registry.validate(&hash).await.is_none());
    }

    #[tokio::test]
    async fn test_cli_token_registry_load_from_db() {
        let registry = CLITokenRegistry::new();

        let entries = vec![
            create_test_entry("token-1", "user-1", [1u8; 32]),
            create_test_entry("token-2", "user-2", [2u8; 32]),
            create_test_entry("token-3", "user-1", [3u8; 32]),
        ];

        registry.load_from_db(entries).await;

        // All tokens should be found
        assert!(registry.validate(&[1u8; 32]).await.is_some());
        assert!(registry.validate(&[2u8; 32]).await.is_some());
        assert!(registry.validate(&[3u8; 32]).await.is_some());

        // Non-existent hash should not be found
        assert!(registry.validate(&[4u8; 32]).await.is_none());
    }

    #[tokio::test]
    async fn test_cli_token_registry_multiple_tokens_same_user() {
        let registry = CLITokenRegistry::new();

        // Same user, different tokens
        let entry1 = create_test_entry("token-1", "user-1", [1u8; 32]);
        let entry2 = create_test_entry("token-2", "user-1", [2u8; 32]);

        registry.add(entry1).await;
        registry.add(entry2).await;

        // Both tokens should be valid
        let result1 = registry.validate(&[1u8; 32]).await;
        let result2 = registry.validate(&[2u8; 32]).await;

        assert!(result1.is_some());
        assert!(result2.is_some());
        assert_eq!(result1.unwrap().user_id, "user-1");
        assert_eq!(result2.unwrap().user_id, "user-1");
    }

    #[tokio::test]
    async fn test_cli_token_registry_overwrite_same_id() {
        let registry = CLITokenRegistry::new();

        // Add token with ID "token-1"
        let entry1 = create_test_entry("token-1", "user-1", [1u8; 32]);
        registry.add(entry1).await;

        // Add another token with same ID but different hash
        let entry2 = create_test_entry("token-1", "user-2", [2u8; 32]);
        registry.add(entry2).await;

        // Old hash should no longer work
        assert!(registry.validate(&[1u8; 32]).await.is_none());

        // New hash should work
        let result = registry.validate(&[2u8; 32]).await;
        assert!(result.is_some());
        assert_eq!(result.unwrap().user_id, "user-2");
    }

    #[test]
    fn test_cli_token_entry_clone() {
        let entry = create_test_entry("token-1", "user-1", [1u8; 32]);
        let cloned = entry.clone();

        assert_eq!(entry.token_id, cloned.token_id);
        assert_eq!(entry.user_id, cloned.user_id);
        assert_eq!(entry.token_hash, cloned.token_hash);
        assert_eq!(entry.name, cloned.name);
    }

    #[test]
    fn test_terminal_connection_fields() {
        let conn = TerminalConnection {
            session_id: "session-123".to_string(),
            connected_at: Instant::now(),
        };

        assert_eq!(conn.session_id, "session-123");
        // connected_at should be recent
        assert!(conn.connected_at.elapsed().as_secs() < 1);
    }
}
