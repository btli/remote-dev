//! Extension Lifecycle Hooks
//!
//! Named callback hooks for extension lifecycle events, following the arXiv 2512.10398v5
//! agent UX patterns. These hooks allow extensions to intercept and modify agent I/O
//! at various stages of the processing pipeline.
//!
//! # Hook Types
//!
//! - `on_input_messages`: Before processing user input - can filter/transform messages
//! - `on_plain_text`: For text content handling - extract structured data from text
//! - `on_tag`: For structured tag parsing - handle custom XML-like tags
//! - `on_llm_output`: After LLM response - post-process or log responses
//!
//! # Run Context
//!
//! All hooks receive a shared `RunContext` that exposes:
//! - I/O channels for communication
//! - Session storage for state persistence
//! - Memory access for episodic/semantic retrieval
//!
//! # Example
//!
//! ```rust
//! use rdv_sdk::extensions::hooks::{Hook, HookPhase, HookContext, HookResult};
//! use serde_json::Value;
//! use async_trait::async_trait;
//!
//! struct LoggingHook;
//!
//! #[async_trait]
//! impl Hook for LoggingHook {
//!     fn name(&self) -> &str {
//!         "logging"
//!     }
//!
//!     fn phase(&self) -> HookPhase {
//!         HookPhase::OnInputMessages
//!     }
//!
//!     async fn execute(&self, ctx: &mut HookContext) -> HookResult {
//!         println!("Processing {} messages", ctx.messages.len());
//!         HookResult::Continue
//!     }
//! }
//! ```

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fmt;
use std::sync::Arc;
use tokio::sync::RwLock;

// ─────────────────────────────────────────────────────────────────────────────
// Hook Phase Enum
// ─────────────────────────────────────────────────────────────────────────────

/// Phase at which a hook executes in the agent processing pipeline.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HookPhase {
    /// Before processing user input messages.
    /// Hooks at this phase can filter, transform, or reject messages.
    OnInputMessages,

    /// For processing plain text content.
    /// Hooks at this phase can extract structured data from text.
    OnPlainText,

    /// For processing structured tags in content.
    /// Hooks at this phase handle custom XML-like tags.
    OnTag,

    /// After LLM generates a response.
    /// Hooks at this phase can log, transform, or enrich responses.
    OnLlmOutput,

    /// Before executing a tool.
    /// Hooks at this phase can modify tool inputs or block execution.
    PreToolUse,

    /// After executing a tool.
    /// Hooks at this phase can transform tool outputs or log results.
    PostToolUse,

    /// When the session starts.
    SessionStart,

    /// When the session ends.
    SessionEnd,

    /// When an error occurs.
    OnError,
}

impl fmt::Display for HookPhase {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            HookPhase::OnInputMessages => write!(f, "on_input_messages"),
            HookPhase::OnPlainText => write!(f, "on_plain_text"),
            HookPhase::OnTag => write!(f, "on_tag"),
            HookPhase::OnLlmOutput => write!(f, "on_llm_output"),
            HookPhase::PreToolUse => write!(f, "pre_tool_use"),
            HookPhase::PostToolUse => write!(f, "post_tool_use"),
            HookPhase::SessionStart => write!(f, "session_start"),
            HookPhase::SessionEnd => write!(f, "session_end"),
            HookPhase::OnError => write!(f, "on_error"),
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Message Types
// ─────────────────────────────────────────────────────────────────────────────

/// Role of a message participant.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MessageRole {
    User,
    Assistant,
    System,
    Tool,
}

/// A message in the conversation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Message {
    /// Role of the message sender.
    pub role: MessageRole,
    /// Text content of the message.
    pub content: String,
    /// Optional structured metadata.
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub metadata: HashMap<String, serde_json::Value>,
    /// Optional tool call ID for tool messages.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
}

/// A structured tag parsed from content.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParsedTag {
    /// Tag name (e.g., "thinking", "code", "result").
    pub name: String,
    /// Tag attributes as key-value pairs.
    #[serde(default)]
    pub attributes: HashMap<String, String>,
    /// Inner content of the tag.
    pub content: String,
    /// Start position in original text.
    pub start: usize,
    /// End position in original text.
    pub end: usize,
}

// ─────────────────────────────────────────────────────────────────────────────
// Run Context
// ─────────────────────────────────────────────────────────────────────────────

/// Session storage for persisting state across hook invocations.
#[derive(Debug, Default)]
pub struct SessionStorage {
    data: HashMap<String, serde_json::Value>,
}

impl SessionStorage {
    /// Create a new empty session storage.
    pub fn new() -> Self {
        Self::default()
    }

    /// Get a value from storage.
    pub fn get(&self, key: &str) -> Option<&serde_json::Value> {
        self.data.get(key)
    }

    /// Set a value in storage.
    pub fn set(&mut self, key: impl Into<String>, value: serde_json::Value) {
        self.data.insert(key.into(), value);
    }

    /// Remove a value from storage.
    pub fn remove(&mut self, key: &str) -> Option<serde_json::Value> {
        self.data.remove(key)
    }

    /// Check if a key exists.
    pub fn contains_key(&self, key: &str) -> bool {
        self.data.contains_key(key)
    }

    /// Get all keys.
    pub fn keys(&self) -> impl Iterator<Item = &str> {
        self.data.keys().map(|s| s.as_str())
    }
}

/// Memory access interface for hooks.
#[derive(Debug)]
pub struct MemoryAccess {
    /// Session ID for scoped access.
    pub session_id: Option<String>,
    /// Folder ID for scoped access.
    pub folder_id: Option<String>,
}

impl MemoryAccess {
    /// Create a new memory access interface.
    pub fn new(session_id: Option<String>, folder_id: Option<String>) -> Self {
        Self { session_id, folder_id }
    }
}

/// Shared run context passed to all hooks.
///
/// Provides access to I/O, session storage, and memory.
#[derive(Debug)]
pub struct RunContext {
    /// Session storage for state persistence.
    pub storage: SessionStorage,
    /// Memory access for retrieval.
    pub memory: MemoryAccess,
    /// Session ID.
    pub session_id: Option<String>,
    /// Folder ID.
    pub folder_id: Option<String>,
    /// User ID.
    pub user_id: Option<String>,
    /// Agent provider (claude, codex, gemini, opencode).
    pub agent_provider: Option<String>,
    /// Custom context data.
    pub context: HashMap<String, serde_json::Value>,
}

impl RunContext {
    /// Create a new run context.
    pub fn new() -> Self {
        Self {
            storage: SessionStorage::new(),
            memory: MemoryAccess::new(None, None),
            session_id: None,
            folder_id: None,
            user_id: None,
            agent_provider: None,
            context: HashMap::new(),
        }
    }

    /// Set session ID.
    pub fn with_session_id(mut self, session_id: impl Into<String>) -> Self {
        let id = session_id.into();
        self.session_id = Some(id.clone());
        self.memory.session_id = Some(id);
        self
    }

    /// Set folder ID.
    pub fn with_folder_id(mut self, folder_id: impl Into<String>) -> Self {
        let id = folder_id.into();
        self.folder_id = Some(id.clone());
        self.memory.folder_id = Some(id);
        self
    }

    /// Set user ID.
    pub fn with_user_id(mut self, user_id: impl Into<String>) -> Self {
        self.user_id = Some(user_id.into());
        self
    }

    /// Set agent provider.
    pub fn with_agent_provider(mut self, provider: impl Into<String>) -> Self {
        self.agent_provider = Some(provider.into());
        self
    }

    /// Add custom context data.
    pub fn with_context(mut self, key: impl Into<String>, value: serde_json::Value) -> Self {
        self.context.insert(key.into(), value);
        self
    }
}

impl Default for RunContext {
    fn default() -> Self {
        Self::new()
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook Context
// ─────────────────────────────────────────────────────────────────────────────

/// Context passed to hook execution.
#[derive(Debug)]
pub struct HookContext {
    /// Current phase.
    pub phase: HookPhase,
    /// Messages being processed (for OnInputMessages/OnLlmOutput).
    pub messages: Vec<Message>,
    /// Plain text being processed (for OnPlainText).
    pub text: Option<String>,
    /// Parsed tags (for OnTag).
    pub tags: Vec<ParsedTag>,
    /// Tool name (for PreToolUse/PostToolUse).
    pub tool_name: Option<String>,
    /// Tool input (for PreToolUse).
    pub tool_input: Option<serde_json::Value>,
    /// Tool output (for PostToolUse).
    pub tool_output: Option<serde_json::Value>,
    /// Error information (for OnError).
    pub error: Option<HookError>,
    /// Shared run context.
    pub run_context: RunContext,
}

impl HookContext {
    /// Create a new hook context for a phase.
    pub fn new(phase: HookPhase) -> Self {
        Self {
            phase,
            messages: Vec::new(),
            text: None,
            tags: Vec::new(),
            tool_name: None,
            tool_input: None,
            tool_output: None,
            error: None,
            run_context: RunContext::new(),
        }
    }

    /// Create context for OnInputMessages.
    pub fn for_input_messages(messages: Vec<Message>, run_context: RunContext) -> Self {
        Self {
            phase: HookPhase::OnInputMessages,
            messages,
            run_context,
            ..Self::new(HookPhase::OnInputMessages)
        }
    }

    /// Create context for OnPlainText.
    pub fn for_plain_text(text: impl Into<String>, run_context: RunContext) -> Self {
        Self {
            phase: HookPhase::OnPlainText,
            text: Some(text.into()),
            run_context,
            ..Self::new(HookPhase::OnPlainText)
        }
    }

    /// Create context for OnTag.
    pub fn for_tags(tags: Vec<ParsedTag>, run_context: RunContext) -> Self {
        Self {
            phase: HookPhase::OnTag,
            tags,
            run_context,
            ..Self::new(HookPhase::OnTag)
        }
    }

    /// Create context for OnLlmOutput.
    pub fn for_llm_output(messages: Vec<Message>, run_context: RunContext) -> Self {
        Self {
            phase: HookPhase::OnLlmOutput,
            messages,
            run_context,
            ..Self::new(HookPhase::OnLlmOutput)
        }
    }

    /// Create context for PreToolUse.
    pub fn for_pre_tool_use(
        tool_name: impl Into<String>,
        tool_input: serde_json::Value,
        run_context: RunContext,
    ) -> Self {
        Self {
            phase: HookPhase::PreToolUse,
            tool_name: Some(tool_name.into()),
            tool_input: Some(tool_input),
            run_context,
            ..Self::new(HookPhase::PreToolUse)
        }
    }

    /// Create context for PostToolUse.
    pub fn for_post_tool_use(
        tool_name: impl Into<String>,
        tool_output: serde_json::Value,
        run_context: RunContext,
    ) -> Self {
        Self {
            phase: HookPhase::PostToolUse,
            tool_name: Some(tool_name.into()),
            tool_output: Some(tool_output),
            run_context,
            ..Self::new(HookPhase::PostToolUse)
        }
    }

    /// Create context for OnError.
    pub fn for_error(error: HookError, run_context: RunContext) -> Self {
        Self {
            phase: HookPhase::OnError,
            error: Some(error),
            run_context,
            ..Self::new(HookPhase::OnError)
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook Result
// ─────────────────────────────────────────────────────────────────────────────

/// Error information for hooks.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HookError {
    /// Error code.
    pub code: String,
    /// Error message.
    pub message: String,
    /// Whether the error is recoverable.
    pub recoverable: bool,
    /// Additional context.
    #[serde(default)]
    pub context: HashMap<String, serde_json::Value>,
}

impl HookError {
    /// Create a new hook error.
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            recoverable: true,
            context: HashMap::new(),
        }
    }

    /// Mark error as unrecoverable.
    pub fn unrecoverable(mut self) -> Self {
        self.recoverable = false;
        self
    }

    /// Add context to the error.
    pub fn with_context(mut self, key: impl Into<String>, value: serde_json::Value) -> Self {
        self.context.insert(key.into(), value);
        self
    }
}

impl fmt::Display for HookError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "[{}] {}", self.code, self.message)
    }
}

impl std::error::Error for HookError {}

/// Result of hook execution.
#[derive(Debug)]
pub enum HookResult {
    /// Continue processing with the (possibly modified) context.
    Continue,
    /// Skip remaining hooks in this phase.
    Skip,
    /// Abort processing with an error.
    Abort(HookError),
    /// Replace messages (for OnInputMessages/OnLlmOutput).
    ReplaceMessages(Vec<Message>),
    /// Replace text (for OnPlainText).
    ReplaceText(String),
    /// Replace tool input (for PreToolUse).
    ReplaceToolInput(serde_json::Value),
    /// Replace tool output (for PostToolUse).
    ReplaceToolOutput(serde_json::Value),
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook Trait
// ─────────────────────────────────────────────────────────────────────────────

/// Trait for implementing extension hooks.
#[async_trait]
pub trait Hook: Send + Sync {
    /// Name of the hook (for logging/debugging).
    fn name(&self) -> &str;

    /// Phase at which this hook executes.
    fn phase(&self) -> HookPhase;

    /// Priority (lower runs first, default 100).
    fn priority(&self) -> i32 {
        100
    }

    /// Optional matcher pattern (for filtering which invocations to handle).
    fn matcher(&self) -> Option<&str> {
        None
    }

    /// Execute the hook.
    async fn execute(&self, ctx: &mut HookContext) -> HookResult;
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook Registry
// ─────────────────────────────────────────────────────────────────────────────

/// Registry for managing hooks.
#[derive(Default)]
pub struct HookRegistry {
    hooks: RwLock<HashMap<HookPhase, Vec<Arc<dyn Hook>>>>,
}

impl HookRegistry {
    /// Create a new empty registry.
    pub fn new() -> Self {
        Self::default()
    }

    /// Register a hook.
    pub async fn register(&self, hook: Arc<dyn Hook>) {
        let mut hooks = self.hooks.write().await;
        let phase = hook.phase();
        hooks.entry(phase).or_default().push(hook);

        // Sort by priority
        if let Some(phase_hooks) = hooks.get_mut(&phase) {
            phase_hooks.sort_by_key(|h| h.priority());
        }
    }

    /// Unregister a hook by name.
    pub async fn unregister(&self, name: &str) {
        let mut hooks = self.hooks.write().await;
        for phase_hooks in hooks.values_mut() {
            phase_hooks.retain(|h| h.name() != name);
        }
    }

    /// Get all hooks for a phase.
    pub async fn get_hooks(&self, phase: HookPhase) -> Vec<Arc<dyn Hook>> {
        let hooks = self.hooks.read().await;
        hooks.get(&phase).cloned().unwrap_or_default()
    }

    /// Execute all hooks for a phase.
    pub async fn execute(&self, ctx: &mut HookContext) -> Result<(), HookError> {
        let hooks = self.get_hooks(ctx.phase).await;

        for hook in hooks {
            // Check matcher if present
            if let Some(matcher) = hook.matcher() {
                // Simple glob-style matching
                let should_run = match ctx.phase {
                    HookPhase::PreToolUse | HookPhase::PostToolUse => {
                        if let Some(ref tool_name) = ctx.tool_name {
                            glob_match(matcher, tool_name)
                        } else {
                            false
                        }
                    }
                    HookPhase::OnTag => {
                        ctx.tags.iter().any(|t| glob_match(matcher, &t.name))
                    }
                    _ => true,
                };

                if !should_run {
                    continue;
                }
            }

            match hook.execute(ctx).await {
                HookResult::Continue => {}
                HookResult::Skip => break,
                HookResult::Abort(err) => return Err(err),
                HookResult::ReplaceMessages(msgs) => {
                    ctx.messages = msgs;
                }
                HookResult::ReplaceText(text) => {
                    ctx.text = Some(text);
                }
                HookResult::ReplaceToolInput(input) => {
                    ctx.tool_input = Some(input);
                }
                HookResult::ReplaceToolOutput(output) => {
                    ctx.tool_output = Some(output);
                }
            }
        }

        Ok(())
    }
}

/// Simple glob-style pattern matching.
fn glob_match(pattern: &str, value: &str) -> bool {
    if pattern == "*" {
        return true;
    }
    if pattern.starts_with('*') && pattern.ends_with('*') {
        let inner = &pattern[1..pattern.len() - 1];
        return value.contains(inner);
    }
    if pattern.starts_with('*') {
        let suffix = &pattern[1..];
        return value.ends_with(suffix);
    }
    if pattern.ends_with('*') {
        let prefix = &pattern[..pattern.len() - 1];
        return value.starts_with(prefix);
    }
    pattern == value
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook Builder
// ─────────────────────────────────────────────────────────────────────────────

/// Builder for creating hooks from closures.
pub struct HookBuilder {
    name: String,
    phase: HookPhase,
    priority: i32,
    matcher: Option<String>,
}

impl HookBuilder {
    /// Create a new hook builder.
    pub fn new(name: impl Into<String>, phase: HookPhase) -> Self {
        Self {
            name: name.into(),
            phase,
            priority: 100,
            matcher: None,
        }
    }

    /// Set priority.
    pub fn priority(mut self, priority: i32) -> Self {
        self.priority = priority;
        self
    }

    /// Set matcher pattern.
    pub fn matcher(mut self, pattern: impl Into<String>) -> Self {
        self.matcher = Some(pattern.into());
        self
    }

    /// Build with an async closure.
    pub fn build<F, Fut>(self, handler: F) -> ClosureHook<F>
    where
        F: Fn(&mut HookContext) -> Fut + Send + Sync + 'static,
        Fut: std::future::Future<Output = HookResult> + Send + 'static,
    {
        ClosureHook {
            name: self.name,
            phase: self.phase,
            priority: self.priority,
            matcher: self.matcher,
            handler,
        }
    }
}

/// Hook implementation using a closure.
pub struct ClosureHook<F> {
    name: String,
    phase: HookPhase,
    priority: i32,
    matcher: Option<String>,
    handler: F,
}

#[async_trait]
impl<F, Fut> Hook for ClosureHook<F>
where
    F: Fn(&mut HookContext) -> Fut + Send + Sync + 'static,
    Fut: std::future::Future<Output = HookResult> + Send + 'static,
{
    fn name(&self) -> &str {
        &self.name
    }

    fn phase(&self) -> HookPhase {
        self.phase
    }

    fn priority(&self) -> i32 {
        self.priority
    }

    fn matcher(&self) -> Option<&str> {
        self.matcher.as_deref()
    }

    async fn execute(&self, ctx: &mut HookContext) -> HookResult {
        (self.handler)(ctx).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_glob_match() {
        assert!(glob_match("*", "anything"));
        assert!(glob_match("test*", "test_hook"));
        assert!(glob_match("*hook", "test_hook"));
        assert!(glob_match("*_*", "test_hook"));
        assert!(glob_match("exact", "exact"));
        assert!(!glob_match("exact", "not_exact"));
    }

    #[test]
    fn test_hook_phase_display() {
        assert_eq!(HookPhase::OnInputMessages.to_string(), "on_input_messages");
        assert_eq!(HookPhase::OnLlmOutput.to_string(), "on_llm_output");
        assert_eq!(HookPhase::PreToolUse.to_string(), "pre_tool_use");
    }

    #[tokio::test]
    async fn test_hook_registry() {
        let registry = HookRegistry::new();

        // Create a simple hook
        let hook = HookBuilder::new("test", HookPhase::OnInputMessages)
            .priority(50)
            .build(|_ctx| async { HookResult::Continue });

        registry.register(Arc::new(hook)).await;

        let hooks = registry.get_hooks(HookPhase::OnInputMessages).await;
        assert_eq!(hooks.len(), 1);
        assert_eq!(hooks[0].name(), "test");
    }

    #[test]
    fn test_session_storage() {
        let mut storage = SessionStorage::new();

        storage.set("key1", serde_json::json!("value1"));
        assert_eq!(storage.get("key1"), Some(&serde_json::json!("value1")));
        assert!(storage.contains_key("key1"));

        storage.remove("key1");
        assert!(!storage.contains_key("key1"));
    }
}
