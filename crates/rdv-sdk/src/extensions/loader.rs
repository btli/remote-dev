//! Extension Loader
//!
//! Loads extensions from filesystem and validates manifests.

use std::path::{Path, PathBuf};
use chrono::Utc;
use tokio::fs;

use super::types::*;

/// Extension loader configuration
#[derive(Debug, Clone)]
pub struct LoaderConfig {
    /// Extension directories to scan
    pub directories: Vec<PathBuf>,
    /// Whether to auto-enable new extensions
    pub auto_enable: bool,
    /// Validate manifests strictly
    pub strict_validation: bool,
}

impl Default for LoaderConfig {
    fn default() -> Self {
        Self {
            directories: vec![],
            auto_enable: false,
            strict_validation: true,
        }
    }
}

/// Extension loader
pub struct ExtensionLoader {
    config: LoaderConfig,
}

impl ExtensionLoader {
    /// Create a new extension loader
    pub fn new(config: LoaderConfig) -> Self {
        Self { config }
    }

    /// Load extension from a directory
    pub async fn load_from_dir(&self, path: &Path) -> ExtensionResult<Extension> {
        let manifest_path = path.join("manifest.json");

        if !manifest_path.exists() {
            return Err(ExtensionError::LoadFailed(format!(
                "No manifest.json found in {:?}",
                path
            )));
        }

        // Read manifest
        let manifest_content = fs::read_to_string(&manifest_path)
            .await
            .map_err(|e| ExtensionError::LoadFailed(format!("Failed to read manifest: {}", e)))?;

        let manifest: ExtensionManifest = serde_json::from_str(&manifest_content)
            .map_err(|e| ExtensionError::InvalidManifest(format!("Invalid JSON: {}", e)))?;

        // Validate manifest
        self.validate_manifest(&manifest)?;

        // Create extension
        let mut extension = Extension::new(manifest);

        // Load tools if capability present
        if extension.has_capability(ExtensionCapability::Tools) {
            extension.tools = self.load_tools(path).await?;
        }

        // Load prompts if capability present
        if extension.has_capability(ExtensionCapability::Prompts) {
            extension.prompts = self.load_prompts(path).await?;
        }

        // Set initial state
        extension.state = if self.config.auto_enable {
            ExtensionState::Active
        } else {
            ExtensionState::Disabled
        };
        extension.loaded_at = Some(Utc::now());

        Ok(extension)
    }

    /// Scan directories for extensions
    pub async fn scan(&self) -> Vec<ExtensionResult<Extension>> {
        let mut results = Vec::new();

        for dir in &self.config.directories {
            if !dir.exists() {
                continue;
            }

            let Ok(mut entries) = fs::read_dir(dir).await else {
                continue;
            };

            while let Ok(Some(entry)) = entries.next_entry().await {
                let path = entry.path();
                if path.is_dir() && path.join("manifest.json").exists() {
                    results.push(self.load_from_dir(&path).await);
                }
            }
        }

        results
    }

    /// Validate a manifest
    fn validate_manifest(&self, manifest: &ExtensionManifest) -> ExtensionResult<()> {
        // Required fields
        if manifest.id.is_empty() {
            return Err(ExtensionError::InvalidManifest("Missing extension ID".into()));
        }

        if manifest.name.is_empty() {
            return Err(ExtensionError::InvalidManifest("Missing extension name".into()));
        }

        if manifest.version.is_empty() {
            return Err(ExtensionError::InvalidManifest("Missing version".into()));
        }

        // Validate ID format (lowercase, alphanumeric, hyphens)
        if !manifest.id.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-') {
            return Err(ExtensionError::InvalidManifest(
                "Extension ID must be lowercase alphanumeric with hyphens".into(),
            ));
        }

        // Validate version (semver-ish)
        let version_parts: Vec<&str> = manifest.version.split('.').collect();
        if self.config.strict_validation && version_parts.len() < 2 {
            return Err(ExtensionError::InvalidManifest(
                "Version must be semver format (e.g., 1.0.0)".into(),
            ));
        }

        // Validate SDK version compatibility
        // For now, we accept any SDK version
        if manifest.sdk_version.is_empty() {
            return Err(ExtensionError::InvalidManifest("Missing SDK version".into()));
        }

        // Validate capabilities
        if manifest.capabilities.is_empty() {
            return Err(ExtensionError::InvalidManifest(
                "Extension must have at least one capability".into(),
            ));
        }

        Ok(())
    }

    /// Load tools from extension directory
    async fn load_tools(&self, path: &Path) -> ExtensionResult<Vec<ToolDefinition>> {
        let tools_path = path.join("tools.json");

        if !tools_path.exists() {
            return Ok(Vec::new());
        }

        let content = fs::read_to_string(&tools_path)
            .await
            .map_err(|e| ExtensionError::LoadFailed(format!("Failed to read tools.json: {}", e)))?;

        let tools: Vec<ToolDefinition> = serde_json::from_str(&content)
            .map_err(|e| ExtensionError::InvalidManifest(format!("Invalid tools.json: {}", e)))?;

        // Validate each tool
        for tool in &tools {
            self.validate_tool(tool)?;
        }

        Ok(tools)
    }

    /// Load prompts from extension directory
    async fn load_prompts(&self, path: &Path) -> ExtensionResult<Vec<PromptTemplate>> {
        let prompts_path = path.join("prompts.json");

        if !prompts_path.exists() {
            return Ok(Vec::new());
        }

        let content = fs::read_to_string(&prompts_path)
            .await
            .map_err(|e| ExtensionError::LoadFailed(format!("Failed to read prompts.json: {}", e)))?;

        let prompts: Vec<PromptTemplate> = serde_json::from_str(&content)
            .map_err(|e| ExtensionError::InvalidManifest(format!("Invalid prompts.json: {}", e)))?;

        // Validate each prompt
        for prompt in &prompts {
            self.validate_prompt(prompt)?;
        }

        Ok(prompts)
    }

    /// Validate a tool definition
    fn validate_tool(&self, tool: &ToolDefinition) -> ExtensionResult<()> {
        if tool.name.is_empty() {
            return Err(ExtensionError::InvalidManifest("Tool missing name".into()));
        }

        if tool.description.is_empty() {
            return Err(ExtensionError::InvalidManifest(
                format!("Tool '{}' missing description", tool.name),
            ));
        }

        // Validate input schema is an object
        if !tool.input_schema.is_object() {
            return Err(ExtensionError::InvalidManifest(
                format!("Tool '{}' input_schema must be a JSON object", tool.name),
            ));
        }

        Ok(())
    }

    /// Validate a prompt template
    fn validate_prompt(&self, prompt: &PromptTemplate) -> ExtensionResult<()> {
        if prompt.name.is_empty() {
            return Err(ExtensionError::InvalidManifest("Prompt missing name".into()));
        }

        if prompt.template.is_empty() {
            return Err(ExtensionError::InvalidManifest(
                format!("Prompt '{}' missing template content", prompt.name),
            ));
        }

        // Validate variable references in template
        for var in &prompt.variables {
            let placeholder = format!("{{{{{}}}}}", var.name); // {{var_name}}
            if !prompt.template.contains(&placeholder) {
                tracing::warn!(
                    "Prompt '{}' declares variable '{}' but it's not used in template",
                    prompt.name,
                    var.name
                );
            }
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_manifest_validation() {
        let loader = ExtensionLoader::new(LoaderConfig::default());

        // Valid manifest
        let valid = ExtensionManifest {
            id: "test-extension".into(),
            name: "Test".into(),
            version: "1.0.0".into(),
            description: "Test".into(),
            author: None,
            homepage: None,
            license: None,
            sdk_version: "0.1.0".into(),
            capabilities: vec![ExtensionCapability::Tools],
            permissions: vec![],
            config_schema: None,
            default_config: None,
        };
        assert!(loader.validate_manifest(&valid).is_ok());

        // Invalid ID
        let invalid_id = ExtensionManifest {
            id: "Test Extension".into(),
            ..valid.clone()
        };
        assert!(loader.validate_manifest(&invalid_id).is_err());

        // Missing capabilities
        let no_caps = ExtensionManifest {
            capabilities: vec![],
            ..valid.clone()
        };
        assert!(loader.validate_manifest(&no_caps).is_err());
    }
}
