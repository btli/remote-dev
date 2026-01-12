//! Extension Composition Patterns
//!
//! This module provides patterns and utilities for composing extensions,
//! creating dependencies between them, and building reusable extension traits.
//!
//! # Composition Patterns
//!
//! ## 1. Extension Dependencies
//!
//! Extensions can declare dependencies on other extensions:
//!
//! ```rust,ignore
//! use rdv_sdk::extensions::composition::*;
//!
//! let manifest = ExtensionManifest {
//!     id: "my-extension".into(),
//!     dependencies: vec![
//!         ExtensionDependency {
//!             id: "base-tools".into(),
//!             version: "^1.0.0".into(),
//!             optional: false,
//!         },
//!     ],
//!     ..Default::default()
//! };
//! ```
//!
//! ## 2. Extension Traits (Capability Categories)
//!
//! Extensions are categorized by their traits:
//!
//! - **Perception**: Extensions that gather information (file reading, web scraping)
//! - **Reasoning**: Extensions that analyze and transform data (code analysis, summarization)
//! - **Action**: Extensions that modify state (file writing, API calls)
//! - **Memory**: Extensions that store and retrieve information
//! - **UI**: Extensions that provide user interface components
//!
//! ## 3. Composition Builder
//!
//! Use the composition builder to create complex extension stacks:
//!
//! ```rust,ignore
//! let stack = ExtensionComposer::new()
//!     .with_perception("file-tools")
//!     .with_perception("web-tools")
//!     .with_reasoning("code-analyzer")
//!     .with_action("shell-executor")
//!     .with_memory("semantic-memory")
//!     .build()?;
//! ```

use std::collections::{HashMap, HashSet};
use serde::{Deserialize, Serialize};
use thiserror::Error;

use super::types::{ExtensionCapability, ExtensionManifest};

// ─────────────────────────────────────────────────────────────────────────────
// Error Types
// ─────────────────────────────────────────────────────────────────────────────

/// Errors that can occur during extension composition
#[derive(Debug, Error)]
pub enum CompositionError {
    #[error("Missing required dependency: {extension} requires {dependency}")]
    MissingDependency {
        extension: String,
        dependency: String,
    },

    #[error("Circular dependency detected: {cycle:?}")]
    CircularDependency { cycle: Vec<String> },

    #[error("Version conflict: {extension} requires {required}, but {available} is available")]
    VersionConflict {
        extension: String,
        required: String,
        available: String,
    },

    #[error("Incompatible traits: {extension} has traits {traits:?} which conflict")]
    IncompatibleTraits {
        extension: String,
        traits: Vec<ExtensionTrait>,
    },

    #[error("Extension not found: {0}")]
    ExtensionNotFound(String),
}

pub type CompositionResult<T> = Result<T, CompositionError>;

// ─────────────────────────────────────────────────────────────────────────────
// Extension Traits (Capability Categories)
// ─────────────────────────────────────────────────────────────────────────────

/// Extension traits categorize extensions by their primary purpose
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExtensionTrait {
    /// Perception: Gathers information from the environment
    /// Examples: file reading, web scraping, API fetching, sensor data
    Perception,

    /// Reasoning: Analyzes, transforms, and derives insights from data
    /// Examples: code analysis, summarization, classification, planning
    Reasoning,

    /// Action: Modifies state in the environment
    /// Examples: file writing, command execution, API mutations
    Action,

    /// Memory: Stores and retrieves information persistently
    /// Examples: semantic memory, episodic memory, knowledge graphs
    Memory,

    /// UI: Provides user interface components
    /// Examples: dashboards, forms, visualizations
    UI,

    /// Orchestration: Coordinates other extensions and workflows
    /// Examples: task scheduling, pipeline management, event routing
    Orchestration,
}

impl ExtensionTrait {
    /// Get all traits
    pub fn all() -> Vec<Self> {
        vec![
            Self::Perception,
            Self::Reasoning,
            Self::Action,
            Self::Memory,
            Self::UI,
            Self::Orchestration,
        ]
    }

    /// Get the description for this trait
    pub fn description(&self) -> &'static str {
        match self {
            Self::Perception => "Gathers information from the environment",
            Self::Reasoning => "Analyzes and transforms data",
            Self::Action => "Modifies state in the environment",
            Self::Memory => "Stores and retrieves information",
            Self::UI => "Provides user interface components",
            Self::Orchestration => "Coordinates extensions and workflows",
        }
    }

    /// Infer traits from capabilities
    pub fn from_capabilities(capabilities: &[ExtensionCapability]) -> Vec<Self> {
        let mut traits = Vec::new();

        for cap in capabilities {
            match cap {
                ExtensionCapability::Tools => {
                    // Tools can be perception, reasoning, or action
                    // This is a simplification - real detection would be more nuanced
                    traits.push(Self::Action);
                }
                ExtensionCapability::Prompts => {
                    traits.push(Self::Reasoning);
                }
                ExtensionCapability::MemoryProviders => {
                    traits.push(Self::Memory);
                }
                ExtensionCapability::UIComponents => {
                    traits.push(Self::UI);
                }
                ExtensionCapability::Resources => {
                    traits.push(Self::Perception);
                }
                ExtensionCapability::Hooks => {
                    traits.push(Self::Orchestration);
                }
            }
        }

        // Deduplicate
        traits.sort_by_key(|t| *t as u8);
        traits.dedup();
        traits
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Extension Dependencies
// ─────────────────────────────────────────────────────────────────────────────

/// Represents a dependency on another extension
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtensionDependency {
    /// ID of the required extension
    pub id: String,
    /// Version requirement (semver range)
    pub version: String,
    /// Whether this dependency is optional
    pub optional: bool,
    /// Feature flags required from the dependency
    pub features: Vec<String>,
}

impl ExtensionDependency {
    /// Create a required dependency
    pub fn required(id: impl Into<String>, version: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            version: version.into(),
            optional: false,
            features: Vec::new(),
        }
    }

    /// Create an optional dependency
    pub fn optional(id: impl Into<String>, version: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            version: version.into(),
            optional: true,
            features: Vec::new(),
        }
    }

    /// Add required features
    pub fn with_features(mut self, features: Vec<String>) -> Self {
        self.features = features;
        self
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Extension Composition Builder
// ─────────────────────────────────────────────────────────────────────────────

/// Builder for composing extensions into a coherent stack
#[derive(Debug, Default)]
pub struct ExtensionComposer {
    extensions: HashMap<ExtensionTrait, Vec<String>>,
    explicit_order: Vec<String>,
    disabled: HashSet<String>,
    config_overrides: HashMap<String, serde_json::Value>,
}

impl ExtensionComposer {
    /// Create a new composer
    pub fn new() -> Self {
        Self::default()
    }

    /// Add a perception extension
    pub fn with_perception(mut self, extension_id: impl Into<String>) -> Self {
        self.extensions
            .entry(ExtensionTrait::Perception)
            .or_default()
            .push(extension_id.into());
        self
    }

    /// Add a reasoning extension
    pub fn with_reasoning(mut self, extension_id: impl Into<String>) -> Self {
        self.extensions
            .entry(ExtensionTrait::Reasoning)
            .or_default()
            .push(extension_id.into());
        self
    }

    /// Add an action extension
    pub fn with_action(mut self, extension_id: impl Into<String>) -> Self {
        self.extensions
            .entry(ExtensionTrait::Action)
            .or_default()
            .push(extension_id.into());
        self
    }

    /// Add a memory extension
    pub fn with_memory(mut self, extension_id: impl Into<String>) -> Self {
        self.extensions
            .entry(ExtensionTrait::Memory)
            .or_default()
            .push(extension_id.into());
        self
    }

    /// Add a UI extension
    pub fn with_ui(mut self, extension_id: impl Into<String>) -> Self {
        self.extensions
            .entry(ExtensionTrait::UI)
            .or_default()
            .push(extension_id.into());
        self
    }

    /// Add an orchestration extension
    pub fn with_orchestration(mut self, extension_id: impl Into<String>) -> Self {
        self.extensions
            .entry(ExtensionTrait::Orchestration)
            .or_default()
            .push(extension_id.into());
        self
    }

    /// Add an extension with explicit loading order
    pub fn with_ordered(mut self, extension_id: impl Into<String>) -> Self {
        self.explicit_order.push(extension_id.into());
        self
    }

    /// Disable an extension
    pub fn without(mut self, extension_id: impl Into<String>) -> Self {
        self.disabled.insert(extension_id.into());
        self
    }

    /// Override configuration for an extension
    pub fn with_config(mut self, extension_id: impl Into<String>, config: serde_json::Value) -> Self {
        self.config_overrides.insert(extension_id.into(), config);
        self
    }

    /// Build the composed extension stack
    pub fn build(self) -> CompositionResult<ComposedExtensionStack> {
        let mut all_extensions = Vec::new();

        // Add explicitly ordered extensions first
        for ext_id in &self.explicit_order {
            if !self.disabled.contains(ext_id) {
                all_extensions.push(ext_id.clone());
            }
        }

        // Add extensions by trait category (recommended order)
        let trait_order = [
            ExtensionTrait::Memory,       // Load memory first (foundation)
            ExtensionTrait::Perception,   // Then perception (gather info)
            ExtensionTrait::Reasoning,    // Then reasoning (analyze)
            ExtensionTrait::Action,       // Then action (modify)
            ExtensionTrait::UI,           // Then UI (display)
            ExtensionTrait::Orchestration, // Finally orchestration (coordinate)
        ];

        for trait_type in trait_order {
            if let Some(extensions) = self.extensions.get(&trait_type) {
                for ext_id in extensions {
                    if !self.disabled.contains(ext_id) && !all_extensions.contains(ext_id) {
                        all_extensions.push(ext_id.clone());
                    }
                }
            }
        }

        Ok(ComposedExtensionStack {
            extensions: all_extensions,
            config_overrides: self.config_overrides,
        })
    }
}

/// A composed stack of extensions ready for loading
#[derive(Debug)]
pub struct ComposedExtensionStack {
    /// Extension IDs in load order
    pub extensions: Vec<String>,
    /// Configuration overrides by extension ID
    pub config_overrides: HashMap<String, serde_json::Value>,
}

impl ComposedExtensionStack {
    /// Get the extension IDs in load order
    pub fn extension_ids(&self) -> &[String] {
        &self.extensions
    }

    /// Get configuration override for an extension
    pub fn get_config(&self, extension_id: &str) -> Option<&serde_json::Value> {
        self.config_overrides.get(extension_id)
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Dependency Resolution
// ─────────────────────────────────────────────────────────────────────────────

/// Resolves dependencies between extensions
pub struct DependencyResolver {
    /// Available extensions and their manifests
    available: HashMap<String, ExtensionManifest>,
    /// Resolved load order
    resolved: Vec<String>,
    /// Currently being resolved (for cycle detection)
    resolving: HashSet<String>,
}

impl DependencyResolver {
    /// Create a new resolver with available extensions
    pub fn new(available: HashMap<String, ExtensionManifest>) -> Self {
        Self {
            available,
            resolved: Vec::new(),
            resolving: HashSet::new(),
        }
    }

    /// Resolve dependencies for an extension
    pub fn resolve(&mut self, extension_id: &str) -> CompositionResult<Vec<String>> {
        self.resolved.clear();
        self.resolving.clear();
        self.resolve_recursive(extension_id)?;
        Ok(std::mem::take(&mut self.resolved))
    }

    /// Resolve dependencies for multiple extensions
    pub fn resolve_all(&mut self, extension_ids: &[String]) -> CompositionResult<Vec<String>> {
        self.resolved.clear();
        self.resolving.clear();

        for ext_id in extension_ids {
            self.resolve_recursive(ext_id)?;
        }

        Ok(std::mem::take(&mut self.resolved))
    }

    fn resolve_recursive(&mut self, extension_id: &str) -> CompositionResult<()> {
        // Already resolved
        if self.resolved.contains(&extension_id.to_string()) {
            return Ok(());
        }

        // Cycle detection
        if self.resolving.contains(extension_id) {
            let cycle: Vec<_> = self.resolving.iter().cloned().collect();
            return Err(CompositionError::CircularDependency { cycle });
        }

        // Get manifest
        let manifest = self
            .available
            .get(extension_id)
            .ok_or_else(|| CompositionError::ExtensionNotFound(extension_id.to_string()))?
            .clone();

        // Mark as resolving
        self.resolving.insert(extension_id.to_string());

        // Resolve dependencies first
        if let Some(deps) = manifest.dependencies() {
            for dep in deps {
                if !dep.optional {
                    self.resolve_recursive(&dep.id)?;
                }
            }
        }

        // Remove from resolving, add to resolved
        self.resolving.remove(extension_id);
        self.resolved.push(extension_id.to_string());

        Ok(())
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Extended Manifest with Dependencies
// ─────────────────────────────────────────────────────────────────────────────

/// Extension manifest trait for dependency support
pub trait ManifestWithDependencies {
    /// Get extension dependencies
    fn dependencies(&self) -> Option<&Vec<ExtensionDependency>>;

    /// Get extension traits
    fn traits(&self) -> Vec<ExtensionTrait>;
}

// Extend ExtensionManifest with dependencies field
// This is done via an extension trait since we can't modify the original struct
impl ManifestWithDependencies for ExtensionManifest {
    fn dependencies(&self) -> Option<&Vec<ExtensionDependency>> {
        // Note: In a real implementation, ExtensionManifest would have a
        // dependencies field. This is a placeholder that returns None.
        None
    }

    fn traits(&self) -> Vec<ExtensionTrait> {
        ExtensionTrait::from_capabilities(&self.capabilities)
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Prebuilt Compositions
// ─────────────────────────────────────────────────────────────────────────────

/// Prebuilt extension compositions for common use cases
pub mod presets {
    use super::*;

    /// Minimal composition for basic file operations
    pub fn minimal() -> ExtensionComposer {
        ExtensionComposer::new()
            .with_perception("core-file-tools")
            .with_action("core-shell-tools")
    }

    /// Full development composition
    pub fn development() -> ExtensionComposer {
        ExtensionComposer::new()
            .with_memory("semantic-memory")
            .with_memory("episodic-memory")
            .with_perception("core-file-tools")
            .with_perception("git-tools")
            .with_perception("code-search")
            .with_reasoning("code-analyzer")
            .with_reasoning("test-runner")
            .with_action("core-shell-tools")
            .with_action("file-editor")
            .with_orchestration("task-planner")
    }

    /// Web development composition
    pub fn web_development() -> ExtensionComposer {
        development()
            .with_perception("browser-tools")
            .with_perception("network-inspector")
            .with_reasoning("css-analyzer")
            .with_action("npm-tools")
    }

    /// Data science composition
    pub fn data_science() -> ExtensionComposer {
        development()
            .with_perception("data-loader")
            .with_reasoning("data-analyzer")
            .with_reasoning("visualization-tools")
            .with_action("notebook-tools")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extension_trait_from_capabilities() {
        let caps = vec![ExtensionCapability::Tools, ExtensionCapability::MemoryProviders];
        let traits = ExtensionTrait::from_capabilities(&caps);
        assert!(traits.contains(&ExtensionTrait::Action));
        assert!(traits.contains(&ExtensionTrait::Memory));
    }

    #[test]
    fn test_extension_dependency_creation() {
        let dep = ExtensionDependency::required("my-ext", "^1.0.0")
            .with_features(vec!["feature-a".into()]);
        assert_eq!(dep.id, "my-ext");
        assert_eq!(dep.version, "^1.0.0");
        assert!(!dep.optional);
        assert_eq!(dep.features, vec!["feature-a"]);
    }

    #[test]
    fn test_composer_build_order() {
        let stack = ExtensionComposer::new()
            .with_action("action-ext")
            .with_perception("perception-ext")
            .with_memory("memory-ext")
            .build()
            .unwrap();

        // Memory should come first
        let memory_pos = stack.extensions.iter().position(|e| e == "memory-ext").unwrap();
        let perception_pos = stack.extensions.iter().position(|e| e == "perception-ext").unwrap();
        let action_pos = stack.extensions.iter().position(|e| e == "action-ext").unwrap();

        assert!(memory_pos < perception_pos);
        assert!(perception_pos < action_pos);
    }

    #[test]
    fn test_composer_disable() {
        let stack = ExtensionComposer::new()
            .with_action("action-ext")
            .with_perception("perception-ext")
            .without("action-ext")
            .build()
            .unwrap();

        assert!(!stack.extensions.contains(&"action-ext".to_string()));
        assert!(stack.extensions.contains(&"perception-ext".to_string()));
    }
}
