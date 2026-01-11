//! SDK-powered MCP tools.
//!
//! Provides MCP tools that wrap rdv-core functionality:
//! - memory_store: Store a memory entry
//! - memory_search: Search memories with text matching
//! - note_capture: Quick note capture with type-based tier selection
//! - insight_extract: Extract insights from session context
//! - knowledge_add: Add project knowledge entry
//! - knowledge_get: Get project knowledge

use rdv_core::Database;
use rdv_core::types::{MemoryQueryFilter, NewMemoryEntry};
use rdv_sdk::extensions::{
    DynamicToolRouter, SDK, ToolHandler, ToolInput, ToolOutput,
};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::sync::Arc;
use tracing::{debug, info};

/// Extension ID for SDK tools
const SDK_EXTENSION_ID: &str = "sdk";

/// Register all SDK tools with the dynamic tool router
pub async fn register_sdk_tools(
    router: Arc<DynamicToolRouter>,
    db: Arc<Database>,
) -> Result<(), String> {
    info!("Registering SDK tools...");

    // Register memory_store tool
    let db_clone = Arc::clone(&db);
    register_memory_store(&router, db_clone).await?;

    // Register memory_search tool
    let db_clone = Arc::clone(&db);
    register_memory_search(&router, db_clone).await?;

    // Register note_capture tool
    let db_clone = Arc::clone(&db);
    register_note_capture(&router, db_clone).await?;

    // Register insight_extract tool
    let db_clone = Arc::clone(&db);
    register_insight_extract(&router, db_clone).await?;

    // Register knowledge_add tool
    let db_clone = Arc::clone(&db);
    register_knowledge_add(&router, db_clone).await?;

    // Register knowledge_get tool
    let db_clone = Arc::clone(&db);
    register_knowledge_get(&router, db_clone).await?;

    let count = router.tool_count().await;
    info!("Registered {} SDK tools", count);

    Ok(())
}

/// Register memory_store tool
async fn register_memory_store(
    router: &DynamicToolRouter,
    db: Arc<Database>,
) -> Result<(), String> {
    let tool = SDK::tool("memory_store")
        .display_name("Store Memory")
        .description("Store a memory entry in the hierarchical memory system. Memories can be short-term (TTL-based), working (session-scoped), or long-term (persistent).")
        .input_schema(json!({
            "type": "object",
            "properties": {
                "tier": {
                    "type": "string",
                    "enum": ["short_term", "working", "long_term"],
                    "description": "Memory tier: short_term (5min TTL), working (24h TTL), long_term (no expiration)"
                },
                "contentType": {
                    "type": "string",
                    "description": "Type of content (observation, convention, pattern, skill, gotcha, etc.)"
                },
                "content": {
                    "type": "string",
                    "description": "The memory content to store"
                },
                "name": {
                    "type": "string",
                    "description": "Optional name/title for the memory"
                },
                "description": {
                    "type": "string",
                    "description": "Optional description"
                },
                "sessionId": {
                    "type": "string",
                    "description": "Optional session ID to associate with"
                },
                "folderId": {
                    "type": "string",
                    "description": "Optional folder ID to associate with"
                },
                "confidence": {
                    "type": "number",
                    "minimum": 0,
                    "maximum": 1,
                    "description": "Confidence score (0-1)"
                },
                "relevance": {
                    "type": "number",
                    "minimum": 0,
                    "maximum": 1,
                    "description": "Relevance score (0-1)"
                },
                "ttl": {
                    "type": "integer",
                    "description": "Time-to-live in seconds (overrides tier default)"
                },
                "metadata": {
                    "type": "object",
                    "description": "Optional metadata JSON object"
                }
            },
            "required": ["tier", "contentType", "content"]
        }))
        .category("memory")
        .with_side_effects()
        .build();

    let handler: ToolHandler = Arc::new(move |input: ToolInput| {
        let db = Arc::clone(&db);
        Box::pin(async move {
            let args = &input.args;
            let user_id = input.context.user_id.clone();

            // Extract parameters
            let tier = args.get("tier").and_then(|v| v.as_str()).unwrap_or("short_term");
            let content_type = args.get("contentType").and_then(|v| v.as_str()).unwrap_or("observation");
            let content = match args.get("content").and_then(|v| v.as_str()) {
                Some(c) => c,
                None => return ToolOutput {
                    data: json!({"success": false, "error": "content is required"}),
                    success: false,
                    error: Some("content is required".to_string()),
                    duration_ms: 0,
                    side_effects: vec![],
                },
            };

            // Validate tier
            if !["short_term", "working", "long_term"].contains(&tier) {
                return ToolOutput {
                    data: json!({"success": false, "error": "Invalid tier"}),
                    success: false,
                    error: Some("Invalid tier. Must be short_term, working, or long_term".to_string()),
                    duration_ms: 0,
                    side_effects: vec![],
                };
            }

            // Compute content hash for deduplication
            let mut hasher = Sha256::new();
            hasher.update(content.as_bytes());
            let content_hash = format!("{:x}", hasher.finalize());

            // Check for duplicate
            let filter = MemoryQueryFilter {
                user_id: user_id.clone(),
                tier: Some(tier.to_string()),
                ..Default::default()
            };

            if let Ok(existing) = db.list_memory_entries(&filter) {
                for entry in &existing {
                    if entry.content_hash == content_hash {
                        // Update access count and return existing
                        let _ = db.touch_memory_entry(&entry.id);
                        return ToolOutput {
                            data: json!({
                                "success": true,
                                "id": entry.id,
                                "deduplicated": true,
                                "message": "Memory already exists, updated access count"
                            }),
                            success: true,
                            error: None,
                            duration_ms: 0,
                            side_effects: vec!["Updated existing memory access count".to_string()],
                        };
                    }
                }
            }

            // Default TTLs by tier
            let default_ttl = match tier {
                "short_term" => Some(300),   // 5 minutes
                "working" => Some(86400),    // 24 hours
                "long_term" => None,         // No expiration
                _ => Some(300),
            };

            let ttl = args.get("ttl")
                .and_then(|v| v.as_i64())
                .map(|v| v as i32)
                .or(default_ttl);

            let entry = NewMemoryEntry {
                user_id,
                session_id: args.get("sessionId").and_then(|v| v.as_str()).map(String::from),
                folder_id: args.get("folderId").and_then(|v| v.as_str()).map(String::from),
                tier: tier.to_string(),
                content_type: content_type.to_string(),
                name: args.get("name").and_then(|v| v.as_str()).map(String::from),
                description: args.get("description").and_then(|v| v.as_str()).map(String::from),
                content: content.to_string(),
                task_id: None,
                priority: args.get("priority").and_then(|v| v.as_i64()).map(|v| v as i32),
                confidence: args.get("confidence").and_then(|v| v.as_f64()),
                relevance: args.get("relevance").and_then(|v| v.as_f64()),
                ttl_seconds: ttl,
                metadata_json: args.get("metadata").map(|v| v.to_string()),
            };

            match db.create_memory_entry(&entry) {
                Ok(id) => {
                    debug!("Created memory entry: {}", &id[..8]);
                    ToolOutput {
                        data: json!({
                            "success": true,
                            "id": id,
                            "tier": tier,
                            "contentType": content_type
                        }),
                        success: true,
                        error: None,
                        duration_ms: 0,
                        side_effects: vec!["Created memory entry".to_string()],
                    }
                }
                Err(e) => ToolOutput {
                    data: json!({"success": false, "error": e.to_string()}),
                    success: false,
                    error: Some(e.to_string()),
                    duration_ms: 0,
                    side_effects: vec![],
                },
            }
        })
    });

    router
        .register_tool_with_handler(SDK_EXTENSION_ID, tool, handler)
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// Register memory_search tool
async fn register_memory_search(
    router: &DynamicToolRouter,
    db: Arc<Database>,
) -> Result<(), String> {
    let tool = SDK::tool("memory_search")
        .display_name("Search Memories")
        .description("Search memories with text matching and optional filters. Returns scored results based on relevance.")
        .input_schema(json!({
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Search query text"
                },
                "tier": {
                    "type": "string",
                    "enum": ["short_term", "working", "long_term"],
                    "description": "Filter by memory tier"
                },
                "contentType": {
                    "type": "string",
                    "description": "Filter by content type"
                },
                "sessionId": {
                    "type": "string",
                    "description": "Filter by session ID"
                },
                "folderId": {
                    "type": "string",
                    "description": "Filter by folder ID"
                },
                "minScore": {
                    "type": "number",
                    "minimum": 0,
                    "maximum": 1,
                    "description": "Minimum relevance score (0-1)"
                },
                "limit": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 100,
                    "description": "Maximum number of results (default: 20)"
                }
            },
            "required": ["query"]
        }))
        .category("memory")
        .build();

    let handler: ToolHandler = Arc::new(move |input: ToolInput| {
        let db = Arc::clone(&db);
        Box::pin(async move {
            let args = &input.args;
            let user_id = input.context.user_id.clone();

            let query = match args.get("query").and_then(|v| v.as_str()) {
                Some(q) => q,
                None => return ToolOutput {
                    data: json!({"success": false, "error": "query is required"}),
                    success: false,
                    error: Some("query is required".to_string()),
                    duration_ms: 0,
                    side_effects: vec![],
                },
            };

            let filter = MemoryQueryFilter {
                user_id: user_id.clone(),
                session_id: args.get("sessionId").and_then(|v| v.as_str()).map(String::from),
                folder_id: args.get("folderId").and_then(|v| v.as_str()).map(String::from),
                tier: args.get("tier").and_then(|v| v.as_str()).map(String::from),
                content_type: args.get("contentType").and_then(|v| v.as_str()).map(String::from),
                min_relevance: args.get("minScore").and_then(|v| v.as_f64()),
                limit: args.get("limit").and_then(|v| v.as_u64()).map(|v| v as usize),
                ..Default::default()
            };

            let memories = match db.list_memory_entries(&filter) {
                Ok(m) => m,
                Err(e) => return ToolOutput {
                    data: json!({"success": false, "error": e.to_string()}),
                    success: false,
                    error: Some(e.to_string()),
                    duration_ms: 0,
                    side_effects: vec![],
                },
            };

            // Score results based on text matching
            let query_lower = query.to_lowercase();
            let query_words: Vec<&str> = query_lower.split_whitespace().filter(|w| w.len() > 2).collect();

            let min_score = args.get("minScore").and_then(|v| v.as_f64()).unwrap_or(0.0);
            let limit = args.get("limit").and_then(|v| v.as_u64()).unwrap_or(20) as usize;

            let mut results: Vec<serde_json::Value> = memories
                .into_iter()
                .map(|entry| {
                    let content_lower = entry.content.to_lowercase();
                    let name_lower = entry.name.as_deref().unwrap_or("").to_lowercase();

                    // Calculate match score
                    let mut score = 0.0f64;
                    for word in &query_words {
                        if content_lower.contains(word) {
                            score += 0.2;
                        }
                        if name_lower.contains(word) {
                            score += 0.3;
                        }
                    }

                    // Combine with relevance
                    let base_relevance = entry.relevance.unwrap_or(0.5);
                    let final_score = (base_relevance * 0.5 + score * 0.5).min(1.0);

                    (entry, final_score)
                })
                .filter(|(_, score)| *score > min_score)
                .map(|(entry, score)| {
                    json!({
                        "id": entry.id,
                        "tier": entry.tier,
                        "contentType": entry.content_type,
                        "content": entry.content,
                        "name": entry.name,
                        "score": score,
                        "confidence": entry.confidence,
                        "relevance": entry.relevance,
                        "createdAt": entry.created_at
                    })
                })
                .collect();

            // Sort by score descending
            results.sort_by(|a, b| {
                let sa = a.get("score").and_then(|v| v.as_f64()).unwrap_or(0.0);
                let sb = b.get("score").and_then(|v| v.as_f64()).unwrap_or(0.0);
                sb.partial_cmp(&sa).unwrap_or(std::cmp::Ordering::Equal)
            });

            results.truncate(limit);

            let total = results.len();

            ToolOutput {
                data: json!({
                    "success": true,
                    "query": query,
                    "results": results,
                    "total": total
                }),
                success: true,
                error: None,
                duration_ms: 0,
                side_effects: vec![],
            }
        })
    });

    router
        .register_tool_with_handler(SDK_EXTENSION_ID, tool, handler)
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// Register note_capture tool
async fn register_note_capture(
    router: &DynamicToolRouter,
    db: Arc<Database>,
) -> Result<(), String> {
    let tool = SDK::tool("note_capture")
        .display_name("Capture Note")
        .description("Quick note capture with type-based tier selection. TODOs and decisions go to working memory, others to short-term.")
        .input_schema(json!({
            "type": "object",
            "properties": {
                "content": {
                    "type": "string",
                    "description": "The note content"
                },
                "noteType": {
                    "type": "string",
                    "enum": ["todo", "reminder", "question", "observation", "warning", "decision"],
                    "description": "Type of note (determines tier and TTL)"
                },
                "folderId": {
                    "type": "string",
                    "description": "Optional folder ID to associate with"
                },
                "tags": {
                    "type": "array",
                    "items": { "type": "string" },
                    "description": "Optional tags for categorization"
                },
                "priority": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 4,
                    "description": "Priority level (1=critical, 4=low)"
                },
                "ttl": {
                    "type": "integer",
                    "description": "Custom TTL in seconds (overrides default)"
                }
            },
            "required": ["content", "noteType"]
        }))
        .category("notes")
        .with_side_effects()
        .build();

    let handler: ToolHandler = Arc::new(move |input: ToolInput| {
        let db = Arc::clone(&db);
        Box::pin(async move {
            let args = &input.args;
            let user_id = input.context.user_id.clone();

            let content = match args.get("content").and_then(|v| v.as_str()) {
                Some(c) => c,
                None => return ToolOutput {
                    data: json!({"success": false, "error": "content is required"}),
                    success: false,
                    error: Some("content is required".to_string()),
                    duration_ms: 0,
                    side_effects: vec![],
                },
            };

            let note_type = args.get("noteType").and_then(|v| v.as_str()).unwrap_or("observation");

            // Determine tier based on note type
            let tier = match note_type {
                "todo" | "decision" => "working",
                _ => "short_term",
            };

            // Default TTLs
            let default_ttl = match tier {
                "short_term" => Some(3600),   // 1 hour
                "working" => Some(86400),     // 24 hours
                _ => None,
            };

            let ttl = args.get("ttl")
                .and_then(|v| v.as_i64())
                .map(|v| v as i32)
                .or(default_ttl);

            // Build metadata
            let metadata = {
                let mut meta = serde_json::Map::new();
                if let Some(tags) = args.get("tags") {
                    meta.insert("tags".to_string(), tags.clone());
                }
                if let Some(priority) = args.get("priority") {
                    meta.insert("priority".to_string(), priority.clone());
                }
                if meta.is_empty() {
                    None
                } else {
                    Some(serde_json::Value::Object(meta).to_string())
                }
            };

            // Create display name
            let display_name = format!(
                "[{}] {}",
                note_type.to_uppercase(),
                &content[..content.len().min(50)]
            );

            let entry = NewMemoryEntry {
                user_id,
                session_id: None,
                folder_id: args.get("folderId").and_then(|v| v.as_str()).map(String::from),
                tier: tier.to_string(),
                content_type: format!("note:{}", note_type),
                name: Some(display_name),
                description: None,
                content: content.to_string(),
                task_id: None,
                priority: args.get("priority").and_then(|v| v.as_i64()).map(|v| v as i32),
                confidence: Some(1.0),  // User-created notes have full confidence
                relevance: Some(0.7),   // Default relevance
                ttl_seconds: ttl,
                metadata_json: metadata,
            };

            match db.create_memory_entry(&entry) {
                Ok(id) => {
                    debug!("Created note: {} (type: {})", &id[..8], note_type);

                    let ttl_display = ttl.map(|t| {
                        let hours = t / 3600;
                        if hours > 0 {
                            format!("{}h", hours)
                        } else {
                            format!("{}m", t / 60)
                        }
                    });

                    ToolOutput {
                        data: json!({
                            "success": true,
                            "id": id,
                            "noteType": note_type,
                            "tier": tier,
                            "expiresIn": ttl_display
                        }),
                        success: true,
                        error: None,
                        duration_ms: 0,
                        side_effects: vec!["Created note".to_string()],
                    }
                }
                Err(e) => ToolOutput {
                    data: json!({"success": false, "error": e.to_string()}),
                    success: false,
                    error: Some(e.to_string()),
                    duration_ms: 0,
                    side_effects: vec![],
                },
            }
        })
    });

    router
        .register_tool_with_handler(SDK_EXTENSION_ID, tool, handler)
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// Register insight_extract tool
async fn register_insight_extract(
    router: &DynamicToolRouter,
    db: Arc<Database>,
) -> Result<(), String> {
    let tool = SDK::tool("insight_extract")
        .display_name("Extract Insight")
        .description("Extract an insight from session context. Insights are stored as long-term memories with high confidence.")
        .input_schema(json!({
            "type": "object",
            "properties": {
                "insight": {
                    "type": "string",
                    "description": "The insight content"
                },
                "insightType": {
                    "type": "string",
                    "enum": ["convention", "pattern", "gotcha", "skill", "tool"],
                    "description": "Type of insight"
                },
                "context": {
                    "type": "string",
                    "description": "Context that led to this insight"
                },
                "source": {
                    "type": "string",
                    "description": "Source of the insight (e.g., session ID, file path)"
                },
                "sessionId": {
                    "type": "string",
                    "description": "Session where insight was discovered"
                },
                "folderId": {
                    "type": "string",
                    "description": "Folder to associate with"
                },
                "confidence": {
                    "type": "number",
                    "minimum": 0,
                    "maximum": 1,
                    "description": "Confidence level (0-1, default: 0.8)"
                }
            },
            "required": ["insight", "insightType"]
        }))
        .category("insights")
        .with_side_effects()
        .build();

    let handler: ToolHandler = Arc::new(move |input: ToolInput| {
        let db = Arc::clone(&db);
        Box::pin(async move {
            let args = &input.args;
            let user_id = input.context.user_id.clone();

            let insight = match args.get("insight").and_then(|v| v.as_str()) {
                Some(i) => i,
                None => return ToolOutput {
                    data: json!({"success": false, "error": "insight is required"}),
                    success: false,
                    error: Some("insight is required".to_string()),
                    duration_ms: 0,
                    side_effects: vec![],
                },
            };

            let insight_type = args.get("insightType").and_then(|v| v.as_str()).unwrap_or("pattern");

            // Build metadata with context and source
            let mut metadata = serde_json::Map::new();
            if let Some(context) = args.get("context") {
                metadata.insert("context".to_string(), context.clone());
            }
            if let Some(source) = args.get("source") {
                metadata.insert("source".to_string(), source.clone());
            }

            let entry = NewMemoryEntry {
                user_id,
                session_id: args.get("sessionId").and_then(|v| v.as_str()).map(String::from),
                folder_id: args.get("folderId").and_then(|v| v.as_str()).map(String::from),
                tier: "long_term".to_string(),  // Insights are long-term
                content_type: insight_type.to_string(),
                name: Some(format!("[Insight] {}", &insight[..insight.len().min(50)])),
                description: args.get("context").and_then(|v| v.as_str()).map(String::from),
                content: insight.to_string(),
                task_id: None,
                priority: None,
                confidence: args.get("confidence").and_then(|v| v.as_f64()).or(Some(0.8)),
                relevance: Some(0.9),  // Insights are highly relevant
                ttl_seconds: None,     // No expiration for long-term
                metadata_json: if metadata.is_empty() {
                    None
                } else {
                    Some(serde_json::Value::Object(metadata).to_string())
                },
            };

            match db.create_memory_entry(&entry) {
                Ok(id) => {
                    debug!("Created insight: {} (type: {})", &id[..8], insight_type);
                    ToolOutput {
                        data: json!({
                            "success": true,
                            "id": id,
                            "insightType": insight_type,
                            "tier": "long_term"
                        }),
                        success: true,
                        error: None,
                        duration_ms: 0,
                        side_effects: vec!["Created insight".to_string()],
                    }
                }
                Err(e) => ToolOutput {
                    data: json!({"success": false, "error": e.to_string()}),
                    success: false,
                    error: Some(e.to_string()),
                    duration_ms: 0,
                    side_effects: vec![],
                },
            }
        })
    });

    router
        .register_tool_with_handler(SDK_EXTENSION_ID, tool, handler)
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// Register knowledge_add tool
async fn register_knowledge_add(
    router: &DynamicToolRouter,
    db: Arc<Database>,
) -> Result<(), String> {
    let tool = SDK::tool("knowledge_add")
        .display_name("Add Knowledge")
        .description("Add a knowledge entry (convention, pattern, skill, tool, gotcha) to a folder's project knowledge.")
        .input_schema(json!({
            "type": "object",
            "properties": {
                "folderId": {
                    "type": "string",
                    "description": "Folder ID to add knowledge to"
                },
                "type": {
                    "type": "string",
                    "enum": ["convention", "pattern", "skill", "tool", "gotcha"],
                    "description": "Type of knowledge entry"
                },
                "name": {
                    "type": "string",
                    "description": "Name of the knowledge entry (required for skill/tool)"
                },
                "description": {
                    "type": "string",
                    "description": "Description of the knowledge"
                },
                "category": {
                    "type": "string",
                    "description": "Category (for conventions)"
                },
                "confidence": {
                    "type": "number",
                    "minimum": 0,
                    "maximum": 1,
                    "description": "Confidence level (0-1)"
                },
                "source": {
                    "type": "string",
                    "description": "Source of knowledge (manual, auto-detected, session)"
                }
            },
            "required": ["folderId", "type", "description"]
        }))
        .category("knowledge")
        .with_side_effects()
        .build();

    let handler: ToolHandler = Arc::new(move |input: ToolInput| {
        let db = Arc::clone(&db);
        Box::pin(async move {
            let args = &input.args;
            let user_id = input.context.user_id.clone();

            let folder_id = match args.get("folderId").and_then(|v| v.as_str()) {
                Some(f) => f,
                None => return ToolOutput {
                    data: json!({"success": false, "error": "folderId is required"}),
                    success: false,
                    error: Some("folderId is required".to_string()),
                    duration_ms: 0,
                    side_effects: vec![],
                },
            };

            let knowledge_type = args.get("type").and_then(|v| v.as_str()).unwrap_or("pattern");
            let description = match args.get("description").and_then(|v| v.as_str()) {
                Some(d) => d,
                None => return ToolOutput {
                    data: json!({"success": false, "error": "description is required"}),
                    success: false,
                    error: Some("description is required".to_string()),
                    duration_ms: 0,
                    side_effects: vec![],
                },
            };

            // Verify folder exists
            let folder = match db.get_folder(folder_id) {
                Ok(Some(f)) => f,
                Ok(None) => return ToolOutput {
                    data: json!({"success": false, "error": "Folder not found"}),
                    success: false,
                    error: Some("Folder not found".to_string()),
                    duration_ms: 0,
                    side_effects: vec![],
                },
                Err(e) => return ToolOutput {
                    data: json!({"success": false, "error": e.to_string()}),
                    success: false,
                    error: Some(e.to_string()),
                    duration_ms: 0,
                    side_effects: vec![],
                },
            };

            if folder.user_id != user_id {
                return ToolOutput {
                    data: json!({"success": false, "error": "Access denied"}),
                    success: false,
                    error: Some("Access denied".to_string()),
                    duration_ms: 0,
                    side_effects: vec![],
                };
            }

            // Get or create project knowledge
            let mut knowledge = match db.get_project_knowledge_by_folder(folder_id, &user_id) {
                Ok(Some(k)) => k,
                Ok(None) => {
                    // Create new knowledge
                    use rdv_core::db::types::NewProjectKnowledge;
                    match db.create_project_knowledge(&NewProjectKnowledge {
                        folder_id: folder_id.to_string(),
                        user_id: user_id.clone(),
                    }) {
                        Ok(_id) => match db.get_project_knowledge_by_folder(folder_id, &user_id) {
                            Ok(Some(k)) => k,
                            _ => return ToolOutput {
                                data: json!({"success": false, "error": "Failed to create knowledge"}),
                                success: false,
                                error: Some("Failed to create knowledge".to_string()),
                                duration_ms: 0,
                                side_effects: vec![],
                            },
                        },
                        Err(e) => return ToolOutput {
                            data: json!({"success": false, "error": e.to_string()}),
                            success: false,
                            error: Some(e.to_string()),
                            duration_ms: 0,
                            side_effects: vec![],
                        },
                    }
                }
                Err(e) => return ToolOutput {
                    data: json!({"success": false, "error": e.to_string()}),
                    success: false,
                    error: Some(e.to_string()),
                    duration_ms: 0,
                    side_effects: vec![],
                },
            };

            let now = chrono::Utc::now().timestamp_millis();
            let entry_id = uuid::Uuid::new_v4().to_string();
            let confidence = args.get("confidence").and_then(|v| v.as_f64()).unwrap_or(0.8);
            let source = args.get("source").and_then(|v| v.as_str()).unwrap_or("mcp-tool");

            // Add knowledge entry based on type
            match knowledge_type {
                "convention" => {
                    use rdv_core::db::types::Convention;
                    let category = args.get("category").and_then(|v| v.as_str()).unwrap_or("general");
                    knowledge.conventions.push(Convention {
                        id: entry_id.clone(),
                        category: category.to_string(),
                        description: description.to_string(),
                        examples: vec![],
                        confidence,
                        source: source.to_string(),
                        created_at: now,
                    });
                }
                "pattern" => {
                    use rdv_core::db::types::LearnedPattern;
                    knowledge.patterns.push(LearnedPattern {
                        id: entry_id.clone(),
                        pattern_type: args.get("category").and_then(|v| v.as_str()).unwrap_or("general").to_string(),
                        description: description.to_string(),
                        context: args.get("context").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                        confidence,
                        usage_count: 0,
                        last_used_at: None,
                        created_at: now,
                    });
                }
                "skill" => {
                    use rdv_core::db::types::SkillDefinition;
                    let name = args.get("name").and_then(|v| v.as_str()).unwrap_or("unnamed");
                    knowledge.skills.push(SkillDefinition {
                        id: entry_id.clone(),
                        name: name.to_string(),
                        description: description.to_string(),
                        command: args.get("command").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                        steps: vec![],
                        triggers: vec![],
                        scope: "project".to_string(),
                        verified: false,
                        usage_count: 0,
                        created_at: now,
                    });
                }
                "tool" => {
                    use rdv_core::db::types::{ToolDefinition as KToolDef, ToolImplementation};
                    let name = args.get("name").and_then(|v| v.as_str()).unwrap_or("unnamed");
                    knowledge.tools.push(KToolDef {
                        id: entry_id.clone(),
                        name: name.to_string(),
                        description: description.to_string(),
                        input_schema: json!({}),
                        implementation: ToolImplementation {
                            impl_type: "command".to_string(),
                            code: "".to_string(),
                        },
                        triggers: vec![],
                        confidence,
                        verified: false,
                        created_at: now,
                    });
                }
                "gotcha" => {
                    // Gotchas are stored as conventions with a special category
                    use rdv_core::db::types::Convention;
                    knowledge.conventions.push(Convention {
                        id: entry_id.clone(),
                        category: "gotcha".to_string(),
                        description: description.to_string(),
                        examples: vec![],
                        confidence,
                        source: source.to_string(),
                        created_at: now,
                    });
                }
                _ => {
                    return ToolOutput {
                        data: json!({"success": false, "error": "Invalid knowledge type"}),
                        success: false,
                        error: Some("Invalid knowledge type".to_string()),
                        duration_ms: 0,
                        side_effects: vec![],
                    };
                }
            }

            // Save updated knowledge
            match db.update_project_knowledge(&knowledge) {
                Ok(_) => {
                    debug!("Added {} to folder {}: {}", knowledge_type, &folder_id[..8], &entry_id[..8]);
                    ToolOutput {
                        data: json!({
                            "success": true,
                            "id": entry_id,
                            "type": knowledge_type,
                            "folderId": folder_id
                        }),
                        success: true,
                        error: None,
                        duration_ms: 0,
                        side_effects: vec![format!("Added {} knowledge entry", knowledge_type)],
                    }
                }
                Err(e) => ToolOutput {
                    data: json!({"success": false, "error": e.to_string()}),
                    success: false,
                    error: Some(e.to_string()),
                    duration_ms: 0,
                    side_effects: vec![],
                },
            }
        })
    });

    router
        .register_tool_with_handler(SDK_EXTENSION_ID, tool, handler)
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// Register knowledge_get tool
async fn register_knowledge_get(
    router: &DynamicToolRouter,
    db: Arc<Database>,
) -> Result<(), String> {
    let tool = SDK::tool("knowledge_get")
        .display_name("Get Knowledge")
        .description("Get project knowledge for a folder. Can filter by type or search.")
        .input_schema(json!({
            "type": "object",
            "properties": {
                "folderId": {
                    "type": "string",
                    "description": "Folder ID to get knowledge from"
                },
                "type": {
                    "type": "string",
                    "enum": ["convention", "pattern", "skill", "tool"],
                    "description": "Filter by knowledge type"
                },
                "search": {
                    "type": "string",
                    "description": "Search query to filter results"
                },
                "category": {
                    "type": "string",
                    "description": "Filter by category (for conventions)"
                }
            },
            "required": ["folderId"]
        }))
        .category("knowledge")
        .build();

    let handler: ToolHandler = Arc::new(move |input: ToolInput| {
        let db = Arc::clone(&db);
        Box::pin(async move {
            let args = &input.args;
            let user_id = input.context.user_id.clone();

            let folder_id = match args.get("folderId").and_then(|v| v.as_str()) {
                Some(f) => f,
                None => return ToolOutput {
                    data: json!({"success": false, "error": "folderId is required"}),
                    success: false,
                    error: Some("folderId is required".to_string()),
                    duration_ms: 0,
                    side_effects: vec![],
                },
            };

            // Verify folder access
            let folder = match db.get_folder(folder_id) {
                Ok(Some(f)) => f,
                Ok(None) => return ToolOutput {
                    data: json!({"success": false, "error": "Folder not found"}),
                    success: false,
                    error: Some("Folder not found".to_string()),
                    duration_ms: 0,
                    side_effects: vec![],
                },
                Err(e) => return ToolOutput {
                    data: json!({"success": false, "error": e.to_string()}),
                    success: false,
                    error: Some(e.to_string()),
                    duration_ms: 0,
                    side_effects: vec![],
                },
            };

            if folder.user_id != user_id {
                return ToolOutput {
                    data: json!({"success": false, "error": "Access denied"}),
                    success: false,
                    error: Some("Access denied".to_string()),
                    duration_ms: 0,
                    side_effects: vec![],
                };
            }

            // Get knowledge
            let knowledge = match db.get_project_knowledge_by_folder(folder_id, &user_id) {
                Ok(Some(k)) => k,
                Ok(None) => return ToolOutput {
                    data: json!({
                        "success": true,
                        "exists": false,
                        "message": "No knowledge found for this folder"
                    }),
                    success: true,
                    error: None,
                    duration_ms: 0,
                    side_effects: vec![],
                },
                Err(e) => return ToolOutput {
                    data: json!({"success": false, "error": e.to_string()}),
                    success: false,
                    error: Some(e.to_string()),
                    duration_ms: 0,
                    side_effects: vec![],
                },
            };

            let type_filter = args.get("type").and_then(|v| v.as_str());
            let search_query = args.get("search").and_then(|v| v.as_str());
            let category_filter = args.get("category").and_then(|v| v.as_str());

            // Handle search
            if let Some(query) = search_query {
                let query_lower = query.to_lowercase();
                let mut results = Vec::new();

                // Search conventions
                for conv in &knowledge.conventions {
                    if conv.description.to_lowercase().contains(&query_lower) {
                        results.push(json!({
                            "type": "convention",
                            "id": conv.id,
                            "category": conv.category,
                            "description": conv.description,
                            "confidence": conv.confidence
                        }));
                    }
                }

                // Search patterns
                for pattern in &knowledge.patterns {
                    if pattern.description.to_lowercase().contains(&query_lower) {
                        results.push(json!({
                            "type": "pattern",
                            "id": pattern.id,
                            "patternType": pattern.pattern_type,
                            "description": pattern.description,
                            "confidence": pattern.confidence
                        }));
                    }
                }

                // Search skills
                for skill in &knowledge.skills {
                    if skill.name.to_lowercase().contains(&query_lower)
                        || skill.description.to_lowercase().contains(&query_lower)
                    {
                        results.push(json!({
                            "type": "skill",
                            "id": skill.id,
                            "name": skill.name,
                            "description": skill.description
                        }));
                    }
                }

                // Search tools
                for tool in &knowledge.tools {
                    if tool.name.to_lowercase().contains(&query_lower)
                        || tool.description.to_lowercase().contains(&query_lower)
                    {
                        results.push(json!({
                            "type": "tool",
                            "id": tool.id,
                            "name": tool.name,
                            "description": tool.description
                        }));
                    }
                }

                return ToolOutput {
                    data: json!({
                        "success": true,
                        "exists": true,
                        "query": query,
                        "results": results,
                        "total": results.len()
                    }),
                    success: true,
                    error: None,
                    duration_ms: 0,
                    side_effects: vec![],
                };
            }

            // Filter by type
            let mut response = json!({
                "success": true,
                "exists": true,
                "folderId": folder_id,
                "techStack": knowledge.tech_stack
            });

            if type_filter.is_none() || type_filter == Some("convention") {
                let mut convs: Vec<_> = knowledge.conventions.clone();
                if let Some(cat) = category_filter {
                    convs.retain(|c| c.category == cat);
                }
                response["conventions"] = json!(convs);
            }

            if type_filter.is_none() || type_filter == Some("pattern") {
                response["patterns"] = json!(knowledge.patterns);
            }

            if type_filter.is_none() || type_filter == Some("skill") {
                response["skills"] = json!(knowledge.skills);
            }

            if type_filter.is_none() || type_filter == Some("tool") {
                response["tools"] = json!(knowledge.tools);
            }

            ToolOutput {
                data: response,
                success: true,
                error: None,
                duration_ms: 0,
                side_effects: vec![],
            }
        })
    });

    router
        .register_tool_with_handler(SDK_EXTENSION_ID, tool, handler)
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rdv_sdk::extensions::ToolContext;
    use std::collections::HashMap;

    fn create_test_input(args: serde_json::Value) -> ToolInput {
        ToolInput {
            args,
            context: ToolContext {
                session_id: None,
                user_id: "test-user".to_string(),
                folder_id: None,
                task_id: None,
                metadata: HashMap::new(),
            },
        }
    }

    #[test]
    fn test_sdk_extension_id() {
        assert_eq!(SDK_EXTENSION_ID, "sdk");
    }
}
