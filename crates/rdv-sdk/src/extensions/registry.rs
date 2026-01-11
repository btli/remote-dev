//! Extension Registry
//!
//! Manages extension lifecycle and provides lookup.

use std::collections::HashMap;
use std::sync::Arc;
use chrono::Utc;
use rusqlite::Connection;
use tokio::sync::RwLock;

use crate::{SDKResult, SDKError};
use super::types::*;

/// Extension registry
pub struct ExtensionRegistry {
    db: Arc<RwLock<Connection>>,
    extensions: RwLock<HashMap<String, Extension>>,
    tools: RwLock<HashMap<String, (String, ToolDefinition)>>, // tool_name -> (ext_id, def)
    prompts: RwLock<HashMap<String, (String, PromptTemplate)>>, // prompt_name -> (ext_id, def)
}

impl ExtensionRegistry {
    /// Create a new extension registry
    pub fn new(db: Arc<RwLock<Connection>>) -> Self {
        Self {
            db,
            extensions: RwLock::new(HashMap::new()),
            tools: RwLock::new(HashMap::new()),
            prompts: RwLock::new(HashMap::new()),
        }
    }

    /// Register an extension
    pub async fn register(&self, extension: Extension) -> SDKResult<()> {
        let ext_id = extension.manifest.id.clone();

        // Check if already registered
        {
            let extensions = self.extensions.read().await;
            if extensions.contains_key(&ext_id) {
                return Err(SDKError::extension(format!(
                    "Extension already registered: {}",
                    ext_id
                )));
            }
        }

        // Store in database
        self.save_extension(&extension).await?;

        // Index tools
        {
            let mut tools = self.tools.write().await;
            for tool in &extension.tools {
                let full_name = format!("{}:{}", ext_id, tool.name);
                tools.insert(full_name, (ext_id.clone(), tool.clone()));
            }
        }

        // Index prompts
        {
            let mut prompts = self.prompts.write().await;
            for prompt in &extension.prompts {
                let full_name = format!("{}:{}", ext_id, prompt.name);
                prompts.insert(full_name, (ext_id.clone(), prompt.clone()));
            }
        }

        // Add to memory
        {
            let mut extensions = self.extensions.write().await;
            extensions.insert(ext_id, extension);
        }

        Ok(())
    }

    /// Unregister an extension
    pub async fn unregister(&self, extension_id: &str) -> SDKResult<Extension> {
        // Remove from memory
        let extension = {
            let mut extensions = self.extensions.write().await;
            extensions.remove(extension_id).ok_or_else(|| {
                SDKError::not_found("Extension", extension_id)
            })?
        };

        // Remove tools index
        {
            let mut tools = self.tools.write().await;
            tools.retain(|_, (ext_id, _)| ext_id != extension_id);
        }

        // Remove prompts index
        {
            let mut prompts = self.prompts.write().await;
            prompts.retain(|_, (ext_id, _)| ext_id != extension_id);
        }

        // Remove from database
        self.delete_extension(extension_id).await?;

        Ok(extension)
    }

    /// Get extension by ID
    pub async fn get(&self, extension_id: &str) -> Option<Extension> {
        let extensions = self.extensions.read().await;
        extensions.get(extension_id).cloned()
    }

    /// List all extensions
    pub async fn list(&self) -> Vec<Extension> {
        let extensions = self.extensions.read().await;
        extensions.values().cloned().collect()
    }

    /// List active extensions
    pub async fn list_active(&self) -> Vec<Extension> {
        let extensions = self.extensions.read().await;
        extensions
            .values()
            .filter(|e| e.is_active())
            .cloned()
            .collect()
    }

    /// Enable an extension
    pub async fn enable(&self, extension_id: &str) -> SDKResult<()> {
        let mut extensions = self.extensions.write().await;
        let extension = extensions.get_mut(extension_id).ok_or_else(|| {
            SDKError::not_found("Extension", extension_id)
        })?;

        extension.state = ExtensionState::Active;
        extension.loaded_at = Some(Utc::now());
        extension.error = None;

        // Update database
        drop(extensions);
        self.update_extension_state(extension_id, ExtensionState::Active, None)
            .await?;

        Ok(())
    }

    /// Disable an extension
    pub async fn disable(&self, extension_id: &str) -> SDKResult<()> {
        let mut extensions = self.extensions.write().await;
        let extension = extensions.get_mut(extension_id).ok_or_else(|| {
            SDKError::not_found("Extension", extension_id)
        })?;

        extension.state = ExtensionState::Disabled;

        // Update database
        drop(extensions);
        self.update_extension_state(extension_id, ExtensionState::Disabled, None)
            .await?;

        Ok(())
    }

    /// Get tool by full name (extension:tool)
    pub async fn get_tool(&self, full_name: &str) -> Option<(Extension, ToolDefinition)> {
        let tools = self.tools.read().await;
        if let Some((ext_id, tool)) = tools.get(full_name) {
            let extensions = self.extensions.read().await;
            if let Some(ext) = extensions.get(ext_id) {
                if ext.is_active() {
                    return Some((ext.clone(), tool.clone()));
                }
            }
        }
        None
    }

    /// List all tools
    pub async fn list_tools(&self) -> Vec<(String, ToolDefinition)> {
        let tools = self.tools.read().await;
        let extensions = self.extensions.read().await;

        tools
            .iter()
            .filter_map(|(name, (ext_id, tool))| {
                extensions
                    .get(ext_id)
                    .filter(|e| e.is_active())
                    .map(|_| (name.clone(), tool.clone()))
            })
            .collect()
    }

    /// Get prompt by full name (extension:prompt)
    pub async fn get_prompt(&self, full_name: &str) -> Option<(Extension, PromptTemplate)> {
        let prompts = self.prompts.read().await;
        if let Some((ext_id, prompt)) = prompts.get(full_name) {
            let extensions = self.extensions.read().await;
            if let Some(ext) = extensions.get(ext_id) {
                if ext.is_active() {
                    return Some((ext.clone(), prompt.clone()));
                }
            }
        }
        None
    }

    /// List all prompts
    pub async fn list_prompts(&self) -> Vec<(String, PromptTemplate)> {
        let prompts = self.prompts.read().await;
        let extensions = self.extensions.read().await;

        prompts
            .iter()
            .filter_map(|(name, (ext_id, prompt))| {
                extensions
                    .get(ext_id)
                    .filter(|e| e.is_active())
                    .map(|_| (name.clone(), prompt.clone()))
            })
            .collect()
    }

    /// Update extension configuration
    pub async fn update_config(
        &self,
        extension_id: &str,
        config: serde_json::Value,
    ) -> SDKResult<()> {
        let mut extensions = self.extensions.write().await;
        let extension = extensions.get_mut(extension_id).ok_or_else(|| {
            SDKError::not_found("Extension", extension_id)
        })?;

        extension.config = config.clone();

        // Update database
        let db = self.db.read().await;
        db.execute(
            "UPDATE sdk_extensions SET config = ?1, updated_at = ?2 WHERE id = ?3",
            rusqlite::params![config.to_string(), Utc::now().to_rfc3339(), extension_id],
        )?;

        Ok(())
    }

    /// Load extensions from database
    pub async fn load_from_db(&self) -> SDKResult<usize> {
        let records = {
            let db = self.db.read().await;
            let mut stmt = db.prepare(
                "SELECT id, manifest, config, state, enabled, installed_at, updated_at, error
                 FROM sdk_extensions WHERE enabled = 1"
            )?;

            let records: Vec<ExtensionRecord> = stmt
                .query_map([], |row| {
                    Ok(ExtensionRecord {
                        id: row.get(0)?,
                        manifest: serde_json::from_str(&row.get::<_, String>(1)?).unwrap_or_default(),
                        config: serde_json::from_str(&row.get::<_, String>(2)?).unwrap_or_default(),
                        state: row.get(3)?,
                        enabled: row.get(4)?,
                        installed_at: chrono::DateTime::parse_from_rfc3339(&row.get::<_, String>(5)?)
                            .map(|dt| dt.with_timezone(&Utc))
                            .unwrap_or_else(|_| Utc::now()),
                        updated_at: chrono::DateTime::parse_from_rfc3339(&row.get::<_, String>(6)?)
                            .map(|dt| dt.with_timezone(&Utc))
                            .unwrap_or_else(|_| Utc::now()),
                        error: row.get(7)?,
                    })
                })?
                .filter_map(|r| r.ok())
                .collect();

            records
        };

        let mut loaded = 0;
        for record in records {
            if let Ok(manifest) = serde_json::from_value::<ExtensionManifest>(record.manifest) {
                let mut extension = Extension::new(manifest);
                extension.config = record.config;
                extension.state = match record.state.as_str() {
                    "active" => ExtensionState::Active,
                    "disabled" => ExtensionState::Disabled,
                    "failed" => ExtensionState::Failed,
                    _ => ExtensionState::Unloaded,
                };
                extension.loaded_at = Some(Utc::now());
                extension.error = record.error;

                if let Ok(_) = self.register(extension).await {
                    loaded += 1;
                }
            }
        }

        Ok(loaded)
    }

    // Private helpers

    async fn save_extension(&self, extension: &Extension) -> SDKResult<()> {
        let db = self.db.read().await;
        let now = Utc::now().to_rfc3339();

        db.execute(
            "INSERT INTO sdk_extensions (id, manifest, config, state, enabled, installed_at, updated_at, error)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT(id) DO UPDATE SET
                manifest = excluded.manifest,
                config = excluded.config,
                state = excluded.state,
                enabled = excluded.enabled,
                updated_at = excluded.updated_at,
                error = excluded.error",
            rusqlite::params![
                extension.manifest.id,
                serde_json::to_string(&extension.manifest)?,
                extension.config.to_string(),
                format!("{:?}", extension.state).to_lowercase(),
                extension.state == ExtensionState::Active || extension.state == ExtensionState::Disabled,
                now,
                now,
                extension.error,
            ],
        )?;

        Ok(())
    }

    async fn delete_extension(&self, extension_id: &str) -> SDKResult<()> {
        let db = self.db.read().await;
        db.execute(
            "DELETE FROM sdk_extensions WHERE id = ?1",
            rusqlite::params![extension_id],
        )?;
        Ok(())
    }

    async fn update_extension_state(
        &self,
        extension_id: &str,
        state: ExtensionState,
        error: Option<String>,
    ) -> SDKResult<()> {
        let db = self.db.read().await;
        db.execute(
            "UPDATE sdk_extensions SET state = ?1, error = ?2, updated_at = ?3 WHERE id = ?4",
            rusqlite::params![
                format!("{:?}", state).to_lowercase(),
                error,
                Utc::now().to_rfc3339(),
                extension_id,
            ],
        )?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn setup_test_registry() -> ExtensionRegistry {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(include_str!("./migrations/001_extensions_tables.sql")).unwrap();

        let db = Arc::new(RwLock::new(conn));
        ExtensionRegistry::new(db)
    }

    fn create_test_manifest() -> ExtensionManifest {
        ExtensionManifest {
            id: "test-extension".into(),
            name: "Test Extension".into(),
            version: "1.0.0".into(),
            description: "A test extension".into(),
            author: Some("Test Author".into()),
            homepage: None,
            license: Some("MIT".into()),
            sdk_version: "0.1.0".into(),
            capabilities: vec![ExtensionCapability::Tools],
            permissions: Vec::new(),
            config_schema: None,
            default_config: None,
        }
    }

    #[tokio::test]
    async fn test_register_extension() {
        let registry = setup_test_registry().await;
        let manifest = create_test_manifest();
        let extension = Extension::new(manifest);

        registry.register(extension).await.unwrap();

        let retrieved = registry.get("test-extension").await;
        assert!(retrieved.is_some());
        assert_eq!(retrieved.unwrap().manifest.name, "Test Extension");
    }

    #[tokio::test]
    async fn test_enable_disable() {
        let registry = setup_test_registry().await;
        let manifest = create_test_manifest();
        let extension = Extension::new(manifest);

        registry.register(extension).await.unwrap();
        registry.enable("test-extension").await.unwrap();

        let ext = registry.get("test-extension").await.unwrap();
        assert_eq!(ext.state, ExtensionState::Active);

        registry.disable("test-extension").await.unwrap();

        let ext = registry.get("test-extension").await.unwrap();
        assert_eq!(ext.state, ExtensionState::Disabled);
    }
}
