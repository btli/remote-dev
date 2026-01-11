//! Fluent Builder APIs for Extensions
//!
//! Provides ergonomic builder patterns for constructing extension components:
//! - `ToolBuilder` - Build tool definitions with fluent API
//! - `PromptBuilder` - Build prompt templates
//! - `ExtensionManifestBuilder` - Build extension manifests
//!
//! # Example
//!
//! ```rust
//! use rdv_sdk::extensions::builders::ToolBuilder;
//! use serde_json::json;
//!
//! let tool = ToolBuilder::new("search")
//!     .display_name("Search Files")
//!     .description("Search for files matching a pattern")
//!     .category("filesystem")
//!     .input_schema(json!({
//!         "type": "object",
//!         "properties": {
//!             "pattern": { "type": "string" },
//!             "path": { "type": "string" }
//!         },
//!         "required": ["pattern"]
//!     }))
//!     .output_schema(json!({
//!         "type": "array",
//!         "items": { "type": "string" }
//!     }))
//!     .async_tool()
//!     .with_side_effects()
//!     .permission("filesystem:read")
//!     .example("Search for Rust files", json!({"pattern": "*.rs"}), Some(json!(["src/main.rs"])))
//!     .build();
//! ```

use super::types::{
    ExtensionCapability, ExtensionManifest, PromptTemplate, PromptVariable, ToolDefinition,
    ToolExample,
};

/// Builder for creating `ToolDefinition` instances with fluent API
#[derive(Debug, Clone)]
pub struct ToolBuilder {
    name: String,
    display_name: Option<String>,
    description: Option<String>,
    category: Option<String>,
    input_schema: Option<serde_json::Value>,
    output_schema: Option<serde_json::Value>,
    is_async: bool,
    has_side_effects: bool,
    permissions: Vec<String>,
    examples: Vec<ToolExample>,
}

impl ToolBuilder {
    /// Create a new tool builder with the given name
    ///
    /// # Arguments
    /// * `name` - Unique tool name (within extension)
    pub fn new(name: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            display_name: None,
            description: None,
            category: None,
            input_schema: None,
            output_schema: None,
            is_async: false,
            has_side_effects: false,
            permissions: Vec::new(),
            examples: Vec::new(),
        }
    }

    /// Set the display name for the tool
    pub fn display_name(mut self, name: impl Into<String>) -> Self {
        self.display_name = Some(name.into());
        self
    }

    /// Set the tool description
    pub fn description(mut self, desc: impl Into<String>) -> Self {
        self.description = Some(desc.into());
        self
    }

    /// Set the category for grouping
    pub fn category(mut self, cat: impl Into<String>) -> Self {
        self.category = Some(cat.into());
        self
    }

    /// Set the input schema (JSON Schema)
    pub fn input_schema(mut self, schema: serde_json::Value) -> Self {
        self.input_schema = Some(schema);
        self
    }

    /// Set the input schema using a typed struct that implements JsonSchema
    #[cfg(feature = "schemars")]
    pub fn input_schema_from<T: schemars::JsonSchema>(mut self) -> Self {
        let schema = schemars::schema_for!(T);
        self.input_schema = Some(serde_json::to_value(schema).unwrap_or_default());
        self
    }

    /// Set the output schema (JSON Schema)
    pub fn output_schema(mut self, schema: serde_json::Value) -> Self {
        self.output_schema = Some(schema);
        self
    }

    /// Set the output schema using a typed struct that implements JsonSchema
    #[cfg(feature = "schemars")]
    pub fn output_schema_from<T: schemars::JsonSchema>(mut self) -> Self {
        let schema = schemars::schema_for!(T);
        self.output_schema = Some(serde_json::to_value(schema).unwrap_or_default());
        self
    }

    /// Mark tool as async
    pub fn async_tool(mut self) -> Self {
        self.is_async = true;
        self
    }

    /// Mark tool as synchronous (default)
    pub fn sync_tool(mut self) -> Self {
        self.is_async = false;
        self
    }

    /// Mark tool as having side effects
    pub fn with_side_effects(mut self) -> Self {
        self.has_side_effects = true;
        self
    }

    /// Mark tool as pure (no side effects, default)
    pub fn pure(mut self) -> Self {
        self.has_side_effects = false;
        self
    }

    /// Add a required permission
    pub fn permission(mut self, perm: impl Into<String>) -> Self {
        self.permissions.push(perm.into());
        self
    }

    /// Add multiple permissions at once
    pub fn permissions(mut self, perms: impl IntoIterator<Item = impl Into<String>>) -> Self {
        self.permissions.extend(perms.into_iter().map(Into::into));
        self
    }

    /// Add an example
    pub fn example(
        mut self,
        description: impl Into<String>,
        input: serde_json::Value,
        output: Option<serde_json::Value>,
    ) -> Self {
        self.examples.push(ToolExample {
            description: description.into(),
            input,
            output,
        });
        self
    }

    /// Build the tool definition
    ///
    /// # Panics
    /// Panics if required fields (description, input_schema) are not set
    pub fn build(self) -> ToolDefinition {
        ToolDefinition {
            name: self.name.clone(),
            display_name: self.display_name.unwrap_or_else(|| self.name.clone()),
            description: self
                .description
                .expect("ToolBuilder requires description to be set"),
            category: self.category,
            input_schema: self
                .input_schema
                .expect("ToolBuilder requires input_schema to be set"),
            output_schema: self.output_schema,
            is_async: self.is_async,
            has_side_effects: self.has_side_effects,
            permissions: self.permissions,
            examples: self.examples,
        }
    }

    /// Try to build the tool definition, returning an error if validation fails
    pub fn try_build(self) -> Result<ToolDefinition, BuilderError> {
        let description = self
            .description
            .ok_or(BuilderError::MissingField("description"))?;
        let input_schema = self
            .input_schema
            .ok_or(BuilderError::MissingField("input_schema"))?;

        Ok(ToolDefinition {
            name: self.name.clone(),
            display_name: self.display_name.unwrap_or_else(|| self.name.clone()),
            description,
            category: self.category,
            input_schema,
            output_schema: self.output_schema,
            is_async: self.is_async,
            has_side_effects: self.has_side_effects,
            permissions: self.permissions,
            examples: self.examples,
        })
    }
}

/// Builder for creating `PromptTemplate` instances with fluent API
#[derive(Debug, Clone)]
pub struct PromptBuilder {
    name: String,
    display_name: Option<String>,
    description: Option<String>,
    category: Option<String>,
    template: Option<String>,
    variables: Vec<PromptVariable>,
    tags: Vec<String>,
    examples: Vec<String>,
}

impl PromptBuilder {
    /// Create a new prompt builder with the given name
    pub fn new(name: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            display_name: None,
            description: None,
            category: None,
            template: None,
            variables: Vec::new(),
            tags: Vec::new(),
            examples: Vec::new(),
        }
    }

    /// Set the display name
    pub fn display_name(mut self, name: impl Into<String>) -> Self {
        self.display_name = Some(name.into());
        self
    }

    /// Set the description
    pub fn description(mut self, desc: impl Into<String>) -> Self {
        self.description = Some(desc.into());
        self
    }

    /// Set the category
    pub fn category(mut self, cat: impl Into<String>) -> Self {
        self.category = Some(cat.into());
        self
    }

    /// Set the template content
    pub fn template(mut self, tpl: impl Into<String>) -> Self {
        self.template = Some(tpl.into());
        self
    }

    /// Add a required string variable
    pub fn required_var(mut self, name: impl Into<String>, description: impl Into<String>) -> Self {
        self.variables.push(PromptVariable {
            name: name.into(),
            description: description.into(),
            var_type: "string".to_string(),
            required: true,
            default: None,
            pattern: None,
        });
        self
    }

    /// Add an optional string variable with default
    pub fn optional_var(
        mut self,
        name: impl Into<String>,
        description: impl Into<String>,
        default: impl Into<String>,
    ) -> Self {
        self.variables.push(PromptVariable {
            name: name.into(),
            description: description.into(),
            var_type: "string".to_string(),
            required: false,
            default: Some(serde_json::Value::String(default.into())),
            pattern: None,
        });
        self
    }

    /// Add a custom variable with full control
    pub fn variable(mut self, var: PromptVariable) -> Self {
        self.variables.push(var);
        self
    }

    /// Add a tag
    pub fn tag(mut self, tag: impl Into<String>) -> Self {
        self.tags.push(tag.into());
        self
    }

    /// Add multiple tags
    pub fn tags(mut self, tags: impl IntoIterator<Item = impl Into<String>>) -> Self {
        self.tags.extend(tags.into_iter().map(Into::into));
        self
    }

    /// Add an example output
    pub fn example(mut self, ex: impl Into<String>) -> Self {
        self.examples.push(ex.into());
        self
    }

    /// Build the prompt template
    ///
    /// # Panics
    /// Panics if required fields are not set
    pub fn build(self) -> PromptTemplate {
        PromptTemplate {
            name: self.name.clone(),
            display_name: self.display_name.unwrap_or_else(|| self.name.clone()),
            description: self
                .description
                .expect("PromptBuilder requires description to be set"),
            category: self.category,
            template: self
                .template
                .expect("PromptBuilder requires template to be set"),
            variables: self.variables,
            tags: self.tags,
            examples: self.examples,
        }
    }

    /// Try to build, returning error on validation failure
    pub fn try_build(self) -> Result<PromptTemplate, BuilderError> {
        let description = self
            .description
            .ok_or(BuilderError::MissingField("description"))?;
        let template = self
            .template
            .ok_or(BuilderError::MissingField("template"))?;

        Ok(PromptTemplate {
            name: self.name.clone(),
            display_name: self.display_name.unwrap_or_else(|| self.name.clone()),
            description,
            category: self.category,
            template,
            variables: self.variables,
            tags: self.tags,
            examples: self.examples,
        })
    }
}

/// Builder for creating `ExtensionManifest` instances with fluent API
#[derive(Debug, Clone)]
pub struct ExtensionManifestBuilder {
    id: String,
    name: Option<String>,
    version: Option<String>,
    description: Option<String>,
    author: Option<String>,
    homepage: Option<String>,
    license: Option<String>,
    sdk_version: Option<String>,
    capabilities: Vec<ExtensionCapability>,
    permissions: Vec<String>,
    config_schema: Option<serde_json::Value>,
    default_config: Option<serde_json::Value>,
}

impl ExtensionManifestBuilder {
    /// Create a new extension manifest builder
    ///
    /// # Arguments
    /// * `id` - Unique extension identifier (e.g., "org.example.my-extension")
    pub fn new(id: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            name: None,
            version: None,
            description: None,
            author: None,
            homepage: None,
            license: None,
            sdk_version: None,
            capabilities: Vec::new(),
            permissions: Vec::new(),
            config_schema: None,
            default_config: None,
        }
    }

    /// Set the display name
    pub fn name(mut self, name: impl Into<String>) -> Self {
        self.name = Some(name.into());
        self
    }

    /// Set the version (semver)
    pub fn version(mut self, ver: impl Into<String>) -> Self {
        self.version = Some(ver.into());
        self
    }

    /// Set the description
    pub fn description(mut self, desc: impl Into<String>) -> Self {
        self.description = Some(desc.into());
        self
    }

    /// Set the author
    pub fn author(mut self, author: impl Into<String>) -> Self {
        self.author = Some(author.into());
        self
    }

    /// Set the homepage URL
    pub fn homepage(mut self, url: impl Into<String>) -> Self {
        self.homepage = Some(url.into());
        self
    }

    /// Set the license
    pub fn license(mut self, license: impl Into<String>) -> Self {
        self.license = Some(license.into());
        self
    }

    /// Set the required SDK version
    pub fn sdk_version(mut self, ver: impl Into<String>) -> Self {
        self.sdk_version = Some(ver.into());
        self
    }

    /// Add a capability
    pub fn capability(mut self, cap: ExtensionCapability) -> Self {
        if !self.capabilities.contains(&cap) {
            self.capabilities.push(cap);
        }
        self
    }

    /// Add tools capability
    pub fn with_tools(self) -> Self {
        self.capability(ExtensionCapability::Tools)
    }

    /// Add prompts capability
    pub fn with_prompts(self) -> Self {
        self.capability(ExtensionCapability::Prompts)
    }

    /// Add memory providers capability
    pub fn with_memory_providers(self) -> Self {
        self.capability(ExtensionCapability::MemoryProviders)
    }

    /// Add UI components capability
    pub fn with_ui_components(self) -> Self {
        self.capability(ExtensionCapability::UIComponents)
    }

    /// Add resources capability
    pub fn with_resources(self) -> Self {
        self.capability(ExtensionCapability::Resources)
    }

    /// Add hooks capability
    pub fn with_hooks(self) -> Self {
        self.capability(ExtensionCapability::Hooks)
    }

    /// Add a required permission
    pub fn permission(mut self, perm: impl Into<String>) -> Self {
        self.permissions.push(perm.into());
        self
    }

    /// Add multiple permissions
    pub fn permissions(mut self, perms: impl IntoIterator<Item = impl Into<String>>) -> Self {
        self.permissions.extend(perms.into_iter().map(Into::into));
        self
    }

    /// Set the configuration schema
    pub fn config_schema(mut self, schema: serde_json::Value) -> Self {
        self.config_schema = Some(schema);
        self
    }

    /// Set the default configuration
    pub fn default_config(mut self, config: serde_json::Value) -> Self {
        self.default_config = Some(config);
        self
    }

    /// Build the extension manifest
    ///
    /// # Panics
    /// Panics if required fields are not set
    pub fn build(self) -> ExtensionManifest {
        ExtensionManifest {
            id: self.id.clone(),
            name: self.name.unwrap_or_else(|| self.id.clone()),
            version: self
                .version
                .expect("ExtensionManifestBuilder requires version to be set"),
            description: self
                .description
                .expect("ExtensionManifestBuilder requires description to be set"),
            author: self.author,
            homepage: self.homepage,
            license: self.license,
            sdk_version: self
                .sdk_version
                .expect("ExtensionManifestBuilder requires sdk_version to be set"),
            capabilities: self.capabilities,
            permissions: self.permissions,
            config_schema: self.config_schema,
            default_config: self.default_config,
        }
    }

    /// Try to build, returning error on validation failure
    pub fn try_build(self) -> Result<ExtensionManifest, BuilderError> {
        let version = self.version.ok_or(BuilderError::MissingField("version"))?;
        let description = self
            .description
            .ok_or(BuilderError::MissingField("description"))?;
        let sdk_version = self
            .sdk_version
            .ok_or(BuilderError::MissingField("sdk_version"))?;

        Ok(ExtensionManifest {
            id: self.id.clone(),
            name: self.name.unwrap_or_else(|| self.id.clone()),
            version,
            description,
            author: self.author,
            homepage: self.homepage,
            license: self.license,
            sdk_version,
            capabilities: self.capabilities,
            permissions: self.permissions,
            config_schema: self.config_schema,
            default_config: self.default_config,
        })
    }
}

/// Error type for builder validation failures
#[derive(Debug, Clone, thiserror::Error)]
pub enum BuilderError {
    #[error("Missing required field: {0}")]
    MissingField(&'static str),

    #[error("Invalid field value: {field} - {message}")]
    InvalidValue { field: &'static str, message: String },
}

/// Helper trait for creating tools inline
pub trait ToolExt {
    /// Create a new tool builder
    fn tool(name: impl Into<String>) -> ToolBuilder {
        ToolBuilder::new(name)
    }
}

/// Helper trait for creating prompts inline
pub trait PromptExt {
    /// Create a new prompt builder
    fn prompt(name: impl Into<String>) -> PromptBuilder {
        PromptBuilder::new(name)
    }
}

/// Helper trait for creating extension manifests inline
pub trait ExtensionExt {
    /// Create a new extension manifest builder
    fn extension(id: impl Into<String>) -> ExtensionManifestBuilder {
        ExtensionManifestBuilder::new(id)
    }
}

/// SDK marker struct that provides fluent builder access
///
/// # Example
///
/// ```rust
/// use rdv_sdk::extensions::builders::SDK;
/// use serde_json::json;
///
/// let tool = SDK::tool("my_tool")
///     .description("A tool")
///     .input_schema(json!({"type": "object"}))
///     .build();
/// ```
pub struct SDK;

impl SDK {
    /// Create a new tool builder
    pub fn tool(name: impl Into<String>) -> ToolBuilder {
        ToolBuilder::new(name)
    }

    /// Create a new prompt builder
    pub fn prompt(name: impl Into<String>) -> PromptBuilder {
        PromptBuilder::new(name)
    }

    /// Create a new extension manifest builder
    pub fn extension(id: impl Into<String>) -> ExtensionManifestBuilder {
        ExtensionManifestBuilder::new(id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_tool_builder_basic() {
        let tool = ToolBuilder::new("search")
            .description("Search for files")
            .input_schema(json!({
                "type": "object",
                "properties": {
                    "query": {"type": "string"}
                }
            }))
            .build();

        assert_eq!(tool.name, "search");
        assert_eq!(tool.display_name, "search");
        assert_eq!(tool.description, "Search for files");
        assert!(!tool.is_async);
        assert!(!tool.has_side_effects);
    }

    #[test]
    fn test_tool_builder_full() {
        let tool = ToolBuilder::new("write_file")
            .display_name("Write File")
            .description("Write content to a file")
            .category("filesystem")
            .input_schema(json!({
                "type": "object",
                "properties": {
                    "path": {"type": "string"},
                    "content": {"type": "string"}
                },
                "required": ["path", "content"]
            }))
            .output_schema(json!({
                "type": "object",
                "properties": {
                    "success": {"type": "boolean"}
                }
            }))
            .async_tool()
            .with_side_effects()
            .permission("filesystem:write")
            .permission("filesystem:create")
            .example(
                "Write hello world",
                json!({"path": "/tmp/test.txt", "content": "Hello, world!"}),
                Some(json!({"success": true})),
            )
            .build();

        assert_eq!(tool.name, "write_file");
        assert_eq!(tool.display_name, "Write File");
        assert_eq!(tool.category, Some("filesystem".to_string()));
        assert!(tool.is_async);
        assert!(tool.has_side_effects);
        assert_eq!(tool.permissions.len(), 2);
        assert_eq!(tool.examples.len(), 1);
    }

    #[test]
    fn test_tool_builder_try_build_missing_description() {
        let result = ToolBuilder::new("test")
            .input_schema(json!({}))
            .try_build();

        assert!(result.is_err());
        assert!(matches!(
            result.unwrap_err(),
            BuilderError::MissingField("description")
        ));
    }

    #[test]
    fn test_tool_builder_try_build_missing_schema() {
        let result = ToolBuilder::new("test").description("A test").try_build();

        assert!(result.is_err());
        assert!(matches!(
            result.unwrap_err(),
            BuilderError::MissingField("input_schema")
        ));
    }

    #[test]
    fn test_prompt_builder_basic() {
        let prompt = PromptBuilder::new("code_review")
            .description("Review code for issues")
            .template("Review the following code:\n\n{{code}}\n\nFocus on: {{focus}}")
            .build();

        assert_eq!(prompt.name, "code_review");
        assert_eq!(prompt.display_name, "code_review");
    }

    #[test]
    fn test_prompt_builder_with_variables() {
        let prompt = PromptBuilder::new("summarize")
            .display_name("Summarize Text")
            .description("Summarize text content")
            .category("writing")
            .template("Summarize the following in {{style}} style:\n\n{{text}}")
            .required_var("text", "The text to summarize")
            .optional_var("style", "Summary style", "concise")
            .tag("writing")
            .tag("summarization")
            .example("A brief summary of the key points...")
            .build();

        assert_eq!(prompt.variables.len(), 2);
        assert!(prompt.variables[0].required);
        assert!(!prompt.variables[1].required);
        assert_eq!(prompt.tags.len(), 2);
        assert_eq!(prompt.examples.len(), 1);
    }

    #[test]
    fn test_extension_manifest_builder() {
        let manifest = ExtensionManifestBuilder::new("com.example.my-extension")
            .name("My Extension")
            .version("1.0.0")
            .description("A sample extension")
            .author("Example Author")
            .homepage("https://example.com")
            .license("MIT")
            .sdk_version("0.1.0")
            .with_tools()
            .with_prompts()
            .permission("filesystem:read")
            .config_schema(json!({
                "type": "object",
                "properties": {
                    "enabled": {"type": "boolean"}
                }
            }))
            .default_config(json!({"enabled": true}))
            .build();

        assert_eq!(manifest.id, "com.example.my-extension");
        assert_eq!(manifest.name, "My Extension");
        assert_eq!(manifest.version, "1.0.0");
        assert_eq!(manifest.capabilities.len(), 2);
        assert!(manifest.capabilities.contains(&ExtensionCapability::Tools));
        assert!(manifest.capabilities.contains(&ExtensionCapability::Prompts));
    }

    #[test]
    fn test_sdk_marker() {
        let tool = SDK::tool("test")
            .description("Test tool")
            .input_schema(json!({}))
            .build();

        assert_eq!(tool.name, "test");

        let prompt = SDK::prompt("test_prompt")
            .description("Test prompt")
            .template("Hello {{name}}")
            .build();

        assert_eq!(prompt.name, "test_prompt");

        let manifest = SDK::extension("test.extension")
            .version("1.0.0")
            .description("Test extension")
            .sdk_version("0.1.0")
            .build();

        assert_eq!(manifest.id, "test.extension");
    }

    #[test]
    fn test_capability_deduplication() {
        let manifest = ExtensionManifestBuilder::new("test")
            .version("1.0.0")
            .description("Test")
            .sdk_version("0.1.0")
            .with_tools()
            .with_tools() // Duplicate
            .capability(ExtensionCapability::Tools) // Another duplicate
            .build();

        assert_eq!(manifest.capabilities.len(), 1);
    }
}
