//! Main SDK Entry Point
//!
//! Provides the main SDK struct that ties together all components.

use std::sync::Arc;
use rusqlite::Connection;
use tokio::sync::RwLock;

use crate::{SDKConfig, SDKResult};

#[cfg(feature = "memory")]
use crate::memory::HierarchicalMemory;

#[cfg(feature = "meta-agent")]
use crate::meta_agent::MetaAgent;

#[cfg(feature = "extensions")]
use crate::extensions::ExtensionRegistry;

/// Remote Dev SDK - Main entry point
///
/// The SDK provides access to:
/// - Hierarchical memory system
/// - Meta-agent for configuration optimization
/// - Extension registry for custom tools
///
/// # Example
///
/// ```rust,no_run
/// use rdv_sdk::{SDK, SDKConfig};
///
/// async fn example() -> anyhow::Result<()> {
///     let sdk = SDK::new(SDKConfig::new("sqlite.db", "user-123"))?;
///
///     // Use hierarchical memory
///     sdk.memory().remember("User ran `git status`", Default::default()).await?;
///
///     // Get relevant context
///     let context = sdk.memory().recall("git", Default::default()).await?;
///
///     Ok(())
/// }
/// ```
pub struct SDK {
    /// SDK configuration
    config: SDKConfig,

    /// Database connection (thread-safe)
    db: Arc<RwLock<Connection>>,

    /// Hierarchical memory system
    #[cfg(feature = "memory")]
    memory: HierarchicalMemory,

    /// Meta-agent for configuration optimization
    #[cfg(feature = "meta-agent")]
    meta_agent: MetaAgent,

    /// Extension registry
    #[cfg(feature = "extensions")]
    extensions: ExtensionRegistry,

    /// Whether the SDK has been initialized
    initialized: bool,
}

impl SDK {
    /// Create a new SDK instance
    ///
    /// # Arguments
    ///
    /// * `config` - SDK configuration
    ///
    /// # Errors
    ///
    /// Returns an error if:
    /// - Configuration validation fails
    /// - Database connection fails
    pub fn new(config: SDKConfig) -> SDKResult<Self> {
        // Validate configuration
        config.validate()?;

        // Open database connection
        let conn = Connection::open(&config.database_path)?;

        // Enable WAL mode for better concurrency
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;")?;

        let db = Arc::new(RwLock::new(conn));

        // Initialize components
        #[cfg(feature = "memory")]
        let memory = HierarchicalMemory::new(
            db.clone(),
            config.user_id.clone(),
            config.folder_id.clone(),
            config.memory.clone(),
        );

        #[cfg(feature = "meta-agent")]
        let meta_agent = MetaAgent::new(
            db.clone(),
            config.meta_agent.clone(),
        );

        #[cfg(feature = "extensions")]
        let extensions = ExtensionRegistry::new(db.clone());

        Ok(Self {
            config,
            db,
            #[cfg(feature = "memory")]
            memory,
            #[cfg(feature = "meta-agent")]
            meta_agent,
            #[cfg(feature = "extensions")]
            extensions,
            initialized: false,
        })
    }

    /// Initialize the SDK
    ///
    /// This runs database migrations and starts background tasks.
    pub async fn initialize(&mut self) -> SDKResult<()> {
        if self.initialized {
            return Ok(());
        }

        // Run migrations
        self.run_migrations().await?;

        // Start background tasks
        #[cfg(feature = "memory")]
        if self.config.memory.auto_consolidate {
            self.memory.start_background_consolidation().await;
        }

        self.initialized = true;
        Ok(())
    }

    /// Shutdown the SDK
    ///
    /// This stops background tasks and closes connections.
    pub async fn shutdown(&mut self) -> SDKResult<()> {
        #[cfg(feature = "memory")]
        self.memory.stop_background_consolidation().await;

        self.initialized = false;
        Ok(())
    }

    /// Check if the SDK is initialized
    pub fn is_initialized(&self) -> bool {
        self.initialized
    }

    /// Get the SDK configuration
    pub fn config(&self) -> &SDKConfig {
        &self.config
    }

    /// Get the hierarchical memory system
    #[cfg(feature = "memory")]
    pub fn memory(&self) -> &HierarchicalMemory {
        &self.memory
    }

    /// Get the meta-agent
    #[cfg(feature = "meta-agent")]
    pub fn meta_agent(&self) -> &MetaAgent {
        &self.meta_agent
    }

    /// Get the extension registry
    #[cfg(feature = "extensions")]
    pub fn extensions(&self) -> &ExtensionRegistry {
        &self.extensions
    }

    /// Get a mutable reference to the extension registry
    #[cfg(feature = "extensions")]
    pub fn extensions_mut(&mut self) -> &mut ExtensionRegistry {
        &mut self.extensions
    }

    /// Run database migrations
    async fn run_migrations(&self) -> SDKResult<()> {
        let db = self.db.write().await;

        // Create memory tables
        #[cfg(feature = "memory")]
        db.execute_batch(include_str!("./memory/migrations/001_memory_tables.sql"))?;

        // Create meta-agent tables
        #[cfg(feature = "meta-agent")]
        db.execute_batch(include_str!("./meta_agent/migrations/001_meta_agent_tables.sql"))?;

        // Create extension tables
        #[cfg(feature = "extensions")]
        db.execute_batch(include_str!("./extensions/migrations/001_extensions_tables.sql"))?;

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::NamedTempFile;

    #[tokio::test]
    async fn test_sdk_creation() {
        let temp_db = NamedTempFile::new().unwrap();
        let config = SDKConfig::new(temp_db.path(), "test-user");

        let sdk = SDK::new(config);
        assert!(sdk.is_ok());

        let sdk = sdk.unwrap();
        assert!(!sdk.is_initialized());
        assert_eq!(sdk.config().user_id, "test-user");
    }

    #[tokio::test]
    async fn test_sdk_validation() {
        let config = SDKConfig::default(); // Missing user_id
        let sdk = SDK::new(config);
        assert!(sdk.is_err());
    }
}
