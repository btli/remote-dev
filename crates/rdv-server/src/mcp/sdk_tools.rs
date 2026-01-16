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
use rdv_core::types::{MemoryQueryFilter, NewMemoryEntry, NewSdkEmbedding};
use rdv_sdk::extensions::{
    DynamicToolRouter, SDK, ToolHandler, ToolInput, ToolOutput,
};
use rdv_sdk::memory::embeddings::embedding_service;
use serde_json::json;
use sha2::{Digest, Sha256};
use std::sync::Arc;
use tracing::{debug, info, warn};

/// Extension ID for SDK tools (prefixes tool names as "rdv:tool_name")
const SDK_EXTENSION_ID: &str = "rdv";

/// Helper to create error ToolOutput responses consistently
fn tool_error(message: &str) -> ToolOutput {
    ToolOutput {
        data: json!({"success": false, "error": message}),
        success: false,
        error: Some(message.to_string()),
        duration_ms: 0,
        side_effects: vec![],
    }
}

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

    // Register memory_delete tool
    let db_clone = Arc::clone(&db);
    register_memory_delete(&router, db_clone).await?;

    // Register note_capture tool
    let db_clone = Arc::clone(&db);
    register_note_capture(&router, db_clone).await?;

    // Register insight_extract tool
    let db_clone = Arc::clone(&db);
    register_insight_extract(&router, db_clone).await?;

    // Register insight_apply tool
    let db_clone = Arc::clone(&db);
    register_insight_apply(&router, db_clone).await?;

    // Register note_to_memory tool
    let db_clone = Arc::clone(&db);
    register_note_to_memory(&router, db_clone).await?;

    // Register insight_to_memory tool
    let db_clone = Arc::clone(&db);
    register_insight_to_memory(&router, db_clone).await?;

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
                "userId": {
                    "type": "string",
                    "description": "Optional user ID (overrides default user from context)"
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
            // Single-user system - userId parameter kept for API compatibility but not used for memory scoping

            // Extract parameters
            let tier = args.get("tier").and_then(|v| v.as_str()).unwrap_or("short_term");
            let content_type = args.get("contentType").and_then(|v| v.as_str()).unwrap_or("observation");
            let content = match args.get("content").and_then(|v| v.as_str()) {
                Some(c) => c,
                None => return tool_error("content is required"),
            };

            // Validate tier
            if !["short_term", "working", "long_term"].contains(&tier) {
                return tool_error("Invalid tier. Must be short_term, working, or long_term");
            }

            // Compute content hash for deduplication
            let mut hasher = Sha256::new();
            hasher.update(content.as_bytes());
            let content_hash = format!("{:x}", hasher.finalize());

            // Check for duplicate - single-user system, filter by tier only
            let filter = MemoryQueryFilter {
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

            // Memory lifecycle managed by hooks/processes, not time-based expiration
            // Single-user system: working memory scoped to sessionId, short/long-term to folderId
            let entry = NewMemoryEntry {
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
                metadata_json: args.get("metadata").map(|v| v.to_string()),
            };

            match db.create_memory_entry(&entry) {
                Ok(id) => {
                    debug!("Created memory entry: {}", &id[..8]);

                    // Generate and store embedding for long_term and working memories
                    // Single-user system - no user_id in embeddings
                    let mut embedding_id = None;
                    if tier == "long_term" || tier == "working" {
                        let embed_service = embedding_service();
                        match embed_service.embed(content).await {
                            Ok(result) => {
                                let new_embedding = NewSdkEmbedding {
                                    entity_type: "memory".to_string(),
                                    entity_id: id.clone(),
                                    embedding: result.vector,
                                    model_name: None, // Use default
                                };

                                match db.create_embedding(&new_embedding) {
                                    Ok(emb_id) => {
                                        // Link embedding to memory
                                        if let Err(e) = db.set_memory_embedding(&id, &emb_id) {
                                            warn!("Failed to link embedding to memory {}: {}", &id[..8], e);
                                        } else {
                                            embedding_id = Some(emb_id);
                                            debug!("Created embedding for memory: {}", &id[..8]);
                                        }
                                    }
                                    Err(e) => {
                                        warn!("Failed to store embedding for memory {}: {}", &id[..8], e);
                                    }
                                }
                            }
                            Err(e) => {
                                warn!("Failed to generate embedding for memory {}: {}", &id[..8], e);
                            }
                        }
                    }

                    ToolOutput {
                        data: json!({
                            "success": true,
                            "id": id,
                            "tier": tier,
                            "contentType": content_type,
                            "embeddingId": embedding_id
                        }),
                        success: true,
                        error: None,
                        duration_ms: 0,
                        side_effects: vec!["Created memory entry".to_string()],
                    }
                }
                Err(e) => tool_error(&e.to_string()),
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
        .description("Search memories using hybrid semantic + text matching. Returns scored results based on combined relevance.")
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
                "userId": {
                    "type": "string",
                    "description": "Optional user ID (overrides default user from context)"
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
                },
                "semantic": {
                    "type": "boolean",
                    "description": "Enable semantic search using embeddings (default: true)"
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
            // Single-user system - no user_id scoping for memory search

            let query = match args.get("query").and_then(|v| v.as_str()) {
                Some(q) => q,
                None => return tool_error("query is required"),
            };

            let min_score = args.get("minScore").and_then(|v| v.as_f64()).unwrap_or(0.0);
            let limit = args.get("limit").and_then(|v| v.as_u64()).unwrap_or(20) as usize;
            let use_semantic = args.get("semantic").and_then(|v| v.as_bool()).unwrap_or(true);

            // Single-user system: filter by sessionId (working memory) or folderId (short/long-term)
            let filter = MemoryQueryFilter {
                session_id: args.get("sessionId").and_then(|v| v.as_str()).map(String::from),
                folder_id: args.get("folderId").and_then(|v| v.as_str()).map(String::from),
                tier: args.get("tier").and_then(|v| v.as_str()).map(String::from),
                content_type: args.get("contentType").and_then(|v| v.as_str()).map(String::from),
                min_relevance: None, // Don't filter by relevance yet, we'll do it after scoring
                limit: Some(limit * 3), // Get more results for re-ranking
                ..Default::default()
            };

            let memories = match db.list_memory_entries(&filter) {
                Ok(m) => m,
                Err(e) => return tool_error(&e.to_string()),
            };

            // Build a map of memory ID -> semantic score (if semantic search is enabled)
            let mut semantic_scores: std::collections::HashMap<String, f32> = std::collections::HashMap::new();
            let mut semantic_used = false;

            if use_semantic {
                let embed_service = embedding_service();
                match embed_service.embed(query).await {
                    Ok(query_embedding) => {
                        // Search for similar embeddings - single-user system, no user_id filter
                        match db.search_similar_embeddings("memory", &query_embedding.vector, limit * 2) {
                            Ok(results) => {
                                semantic_used = true;
                                for result in results {
                                    // Normalize cosine similarity (-1 to 1) to relevance score (0 to 1)
                                    let normalized = (result.similarity + 1.0) / 2.0;
                                    semantic_scores.insert(result.entity_id, normalized);
                                }
                                debug!("Semantic search found {} similar memories", semantic_scores.len());
                            }
                            Err(e) => {
                                warn!("Semantic search failed: {}", e);
                            }
                        }
                    }
                    Err(e) => {
                        warn!("Failed to generate query embedding: {}", e);
                    }
                }
            }

            // Score results using hybrid approach
            let query_lower = query.to_lowercase();
            let query_words: Vec<&str> = query_lower.split_whitespace().filter(|w| w.len() > 2).collect();

            let mut results: Vec<serde_json::Value> = memories
                .into_iter()
                .map(|entry| {
                    let content_lower = entry.content.to_lowercase();
                    let name_lower = entry.name.as_deref().unwrap_or("").to_lowercase();

                    // Calculate text match score
                    let mut text_score = 0.0f64;
                    for word in &query_words {
                        if content_lower.contains(word) {
                            text_score += 0.2;
                        }
                        if name_lower.contains(word) {
                            text_score += 0.3;
                        }
                    }
                    text_score = text_score.min(1.0);

                    // Get semantic score if available
                    let semantic_score = semantic_scores.get(&entry.id).copied().unwrap_or(0.0) as f64;

                    // Combine scores with hybrid weighting
                    // If semantic search was used, weight it more heavily
                    let final_score = if semantic_used && semantic_score > 0.0 {
                        // Hybrid: 60% semantic, 30% text, 10% base relevance
                        let base_relevance = entry.relevance.unwrap_or(0.5);
                        (semantic_score * 0.6 + text_score * 0.3 + base_relevance * 0.1).min(1.0)
                    } else {
                        // Text-only: 50% text, 50% base relevance
                        let base_relevance = entry.relevance.unwrap_or(0.5);
                        (text_score * 0.5 + base_relevance * 0.5).min(1.0)
                    };

                    (entry, final_score, semantic_score)
                })
                .filter(|(_, score, _)| *score > min_score)
                .map(|(entry, score, semantic_score)| {
                    json!({
                        "id": entry.id,
                        "tier": entry.tier,
                        "contentType": entry.content_type,
                        "content": entry.content,
                        "name": entry.name,
                        "score": score,
                        "semanticScore": if semantic_used { Some(semantic_score) } else { None },
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
                    "total": total,
                    "semanticSearchUsed": semantic_used
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

/// Register memory_delete tool
async fn register_memory_delete(
    router: &DynamicToolRouter,
    db: Arc<Database>,
) -> Result<(), String> {
    let tool = SDK::tool("memory_delete")
        .display_name("Delete Memory")
        .description("Delete a memory entry by ID. Use this to remove duplicate, outdated, or incorrect memories.")
        .input_schema(json!({
            "type": "object",
            "properties": {
                "id": {
                    "type": "string",
                    "description": "The memory entry ID to delete"
                },
                "userId": {
                    "type": "string",
                    "description": "Optional user ID (overrides default user from context)"
                }
            },
            "required": ["id"]
        }))
        .category("memory")
        .with_side_effects()
        .build();

    let handler: ToolHandler = Arc::new(move |input: ToolInput| {
        let db = Arc::clone(&db);
        Box::pin(async move {
            let args = &input.args;

            let memory_id = match args.get("id").and_then(|v| v.as_str()) {
                Some(id) => id,
                None => return tool_error("id is required"),
            };

            // Single-user system - no ownership check needed
            // Check if memory exists
            match db.get_memory_entry(memory_id) {
                Ok(Some(_entry)) => {
                    // Delete the memory
                    match db.delete_memory_entry(memory_id) {
                        Ok(deleted) => {
                            if deleted {
                                debug!("Deleted memory entry: {}", &memory_id[..8.min(memory_id.len())]);
                                ToolOutput {
                                    data: json!({
                                        "success": true,
                                        "id": memory_id,
                                        "deleted": true
                                    }),
                                    success: true,
                                    error: None,
                                    duration_ms: 0,
                                    side_effects: vec!["Deleted memory entry".to_string()],
                                }
                            } else {
                                tool_error("Memory not found")
                            }
                        }
                        Err(e) => tool_error(&e.to_string()),
                    }
                }
                Ok(None) => tool_error("Memory not found"),
                Err(e) => tool_error(&e.to_string()),
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
                "userId": {
                    "type": "string",
                    "description": "Optional user ID (overrides default user from context)"
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
            // Single-user system - no user_id scoping for notes

            let content = match args.get("content").and_then(|v| v.as_str()) {
                Some(c) => c,
                None => return tool_error("content is required"),
            };

            let note_type = args.get("noteType").and_then(|v| v.as_str()).unwrap_or("observation");

            // Determine tier based on note type
            let tier = match note_type {
                "todo" | "decision" => "working",
                _ => "short_term",
            };

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

            // Memory lifecycle managed by hooks/processes, not time-based expiration
            // Single-user system: notes scoped to folder_id
            let entry = NewMemoryEntry {
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
                metadata_json: metadata,
            };

            match db.create_memory_entry(&entry) {
                Ok(id) => {
                    debug!("Created note: {} (type: {})", &id[..8], note_type);

                    ToolOutput {
                        data: json!({
                            "success": true,
                            "id": id,
                            "noteType": note_type,
                            "tier": tier
                        }),
                        success: true,
                        error: None,
                        duration_ms: 0,
                        side_effects: vec!["Created note".to_string()],
                    }
                }
                Err(e) => tool_error(&e.to_string()),
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
                "userId": {
                    "type": "string",
                    "description": "Optional user ID (overrides default user from context)"
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
            // Single-user system - no user_id scoping for insights

            let insight = match args.get("insight").and_then(|v| v.as_str()) {
                Some(i) => i,
                None => return tool_error("insight is required"),
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

            // Single-user system: insights scoped to folder_id (long-term memory)
            let entry = NewMemoryEntry {
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
                Err(e) => tool_error(&e.to_string()),
            }
        })
    });

    router
        .register_tool_with_handler(SDK_EXTENSION_ID, tool, handler)
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// Register insight_apply tool
async fn register_insight_apply(
    router: &DynamicToolRouter,
    db: Arc<Database>,
) -> Result<(), String> {
    let tool = SDK::tool("insight_apply")
        .display_name("Apply Insight")
        .description("Record when an insight is applied/used. Increments application count for tracking insight utility.")
        .input_schema(json!({
            "type": "object",
            "properties": {
                "insightId": {
                    "type": "string",
                    "description": "ID of the insight being applied"
                },
                "context": {
                    "type": "string",
                    "description": "Optional context about how the insight was applied"
                },
                "userId": {
                    "type": "string",
                    "description": "Optional user ID (overrides default user from context)"
                }
            },
            "required": ["insightId"]
        }))
        .category("insights")
        .with_side_effects()
        .build();

    let handler: ToolHandler = Arc::new(move |input: ToolInput| {
        let db = Arc::clone(&db);
        Box::pin(async move {
            let args = &input.args;
            // Use userId from args if provided, otherwise use context
            let user_id = args.get("userId")
                .and_then(|v| v.as_str())
                .map(String::from)
                .unwrap_or_else(|| input.context.user_id.clone());

            let insight_id = match args.get("insightId").and_then(|v| v.as_str()) {
                Some(id) => id,
                None => return tool_error("insightId is required"),
            };

            // Verify insight exists (single-user system - no ownership check needed)
            match db.get_sdk_insight(insight_id) {
                Ok(Some(_insight)) => {
                    // Insight exists, proceed
                }
                Ok(None) => return tool_error("Insight not found"),
                Err(e) => return tool_error(&e.to_string()),
            }

            // Record the application
            match db.record_sdk_insight_application(insight_id) {
                Ok(_) => {
                    // Get updated application count
                    let application_count = db
                        .get_sdk_insight(insight_id)
                        .ok()
                        .flatten()
                        .map(|i| i.application_count)
                        .unwrap_or(1);

                    debug!("Applied insight: {} (count: {})", &insight_id[..8], application_count);
                    ToolOutput {
                        data: json!({
                            "success": true,
                            "insightId": insight_id,
                            "applicationCount": application_count
                        }),
                        success: true,
                        error: None,
                        duration_ms: 0,
                        side_effects: vec!["Recorded insight application".to_string()],
                    }
                }
                Err(e) => tool_error(&e.to_string()),
            }
        })
    });

    router
        .register_tool_with_handler(SDK_EXTENSION_ID, tool, handler)
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// Register note_to_memory tool
async fn register_note_to_memory(
    router: &DynamicToolRouter,
    db: Arc<Database>,
) -> Result<(), String> {
    let tool = SDK::tool("note_to_memory")
        .display_name("Promote Note to Memory")
        .description("Promote a note to a memory entry, optionally to a specific tier. The note is preserved.")
        .input_schema(json!({
            "type": "object",
            "properties": {
                "noteId": {
                    "type": "string",
                    "description": "ID of the note to promote"
                },
                "tier": {
                    "type": "string",
                    "enum": ["working", "long_term"],
                    "description": "Memory tier to promote to (default: working)"
                },
                "name": {
                    "type": "string",
                    "description": "Optional name for the memory entry"
                },
                "userId": {
                    "type": "string",
                    "description": "Optional user ID (overrides default user from context)"
                }
            },
            "required": ["noteId"]
        }))
        .category("notes")
        .with_side_effects()
        .build();

    let handler: ToolHandler = Arc::new(move |input: ToolInput| {
        let db = Arc::clone(&db);
        Box::pin(async move {
            let args = &input.args;
            // Use userId from args if provided, otherwise use context
            let user_id = args.get("userId")
                .and_then(|v| v.as_str())
                .map(String::from)
                .unwrap_or_else(|| input.context.user_id.clone());

            let note_id = match args.get("noteId").and_then(|v| v.as_str()) {
                Some(id) => id,
                None => return tool_error("noteId is required"),
            };

            // Get the note (single-user system - no ownership check needed)
            let note = match db.get_note(note_id) {
                Ok(Some(n)) => n,
                Ok(None) => return tool_error("Note not found"),
                Err(e) => return tool_error(&e.to_string()),
            };

            let tier = args.get("tier").and_then(|v| v.as_str()).unwrap_or("working");
            let name = args.get("name")
                .and_then(|v| v.as_str())
                .map(String::from)
                .or_else(|| note.title.clone())
                .or_else(|| Some(format!("[Note] {}", &note.content[..note.content.len().min(50)])));

            // Create memory entry from note (single-user system - no user_id field)
            let entry = NewMemoryEntry {
                session_id: note.session_id.clone(),
                folder_id: note.folder_id.clone(),
                tier: tier.to_string(),
                content_type: format!("note_{}", note.note_type),
                name,
                description: None,
                content: note.content.clone(),
                task_id: None,
                priority: Some(note.priority as i32),
                confidence: Some(0.8),
                relevance: Some(0.7),
                metadata_json: Some(json!({
                    "sourceNoteId": note_id,
                    "noteType": note.note_type,
                    "tags": note.tags()
                }).to_string()),
            };

            match db.create_memory_entry(&entry) {
                Ok(memory_id) => {
                    // Generate embedding for the new memory if it's working or long_term
                    let mut embedding_id = None;
                    let embed_service = embedding_service();
                    match embed_service.embed(&note.content).await {
                        Ok(result) => {
                            // Single-user system - no user_id field
                            let new_embedding = NewSdkEmbedding {
                                entity_type: "memory".to_string(),
                                entity_id: memory_id.clone(),
                                embedding: result.vector,
                                model_name: None,
                            };

                            if let Ok(emb_id) = db.create_embedding(&new_embedding) {
                                let _ = db.set_memory_embedding(&memory_id, &emb_id);
                                embedding_id = Some(emb_id);
                            }
                        }
                        Err(e) => {
                            warn!("Failed to generate embedding for promoted note: {}", e);
                        }
                    }

                    debug!("Promoted note {} to memory {}", &note_id[..8], &memory_id[..8]);
                    ToolOutput {
                        data: json!({
                            "success": true,
                            "memoryId": memory_id,
                            "tier": tier,
                            "sourceNoteId": note_id,
                            "embeddingId": embedding_id
                        }),
                        success: true,
                        error: None,
                        duration_ms: 0,
                        side_effects: vec!["Promoted note to memory".to_string()],
                    }
                }
                Err(e) => tool_error(&e.to_string()),
            }
        })
    });

    router
        .register_tool_with_handler(SDK_EXTENSION_ID, tool, handler)
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// Register insight_to_memory tool
async fn register_insight_to_memory(
    router: &DynamicToolRouter,
    db: Arc<Database>,
) -> Result<(), String> {
    let tool = SDK::tool("insight_to_memory")
        .display_name("Convert Insight to Memory")
        .description("Convert an SDK insight to a long-term memory entry for unified retrieval. Maps insight types to memory content types.")
        .input_schema(json!({
            "type": "object",
            "properties": {
                "insightId": {
                    "type": "string",
                    "description": "ID of the insight to convert"
                },
                "name": {
                    "type": "string",
                    "description": "Optional name for the memory entry"
                },
                "userId": {
                    "type": "string",
                    "description": "Optional user ID (overrides default user from context)"
                }
            },
            "required": ["insightId"]
        }))
        .category("insights")
        .with_side_effects()
        .build();

    let handler: ToolHandler = Arc::new(move |input: ToolInput| {
        let db = Arc::clone(&db);
        Box::pin(async move {
            let args = &input.args;
            // Use userId from args if provided, otherwise use context
            let user_id = args.get("userId")
                .and_then(|v| v.as_str())
                .map(String::from)
                .unwrap_or_else(|| input.context.user_id.clone());

            let insight_id = match args.get("insightId").and_then(|v| v.as_str()) {
                Some(id) => id,
                None => return tool_error("insightId is required"),
            };

            // Get the insight (single-user system - no ownership check needed)
            let insight = match db.get_sdk_insight(insight_id) {
                Ok(Some(i)) => i,
                Ok(None) => return tool_error("Insight not found"),
                Err(e) => return tool_error(&e.to_string()),
            };

            // Map insight type to memory content type
            let insight_type_str = insight.insight_type.to_string();
            let content_type = match insight_type_str.as_str() {
                "convention" => "convention",
                "pattern" => "pattern",
                "anti_pattern" => "gotcha",
                "skill" => "skill",
                "gotcha" => "gotcha",
                "best_practice" => "pattern",
                "dependency" => "reference",
                "performance" => "observation",
                _ => "insight",
            };

            let name = args.get("name")
                .and_then(|v| v.as_str())
                .map(String::from)
                .or_else(|| Some(insight.title.clone()));

            // Create memory entry from insight (single-user system - no user_id field)
            let entry = NewMemoryEntry {
                session_id: None,  // Insights don't have session_id
                folder_id: insight.folder_id.clone(),
                tier: "long_term".to_string(),  // Insights are always long-term
                content_type: content_type.to_string(),
                name,
                description: Some(insight.title.clone()),
                content: insight.description.clone(),
                task_id: None,
                priority: None,
                confidence: Some(insight.confidence),
                relevance: Some(0.9),  // High relevance for insights
                metadata_json: Some(json!({
                    "sourceInsightId": insight_id,
                    "insightType": insight_type_str,
                    "applicability": insight.applicability.to_string(),
                    "applicationCount": insight.application_count
                }).to_string()),
            };

            match db.create_memory_entry(&entry) {
                Ok(memory_id) => {
                    // Generate embedding for the new memory
                    let mut embedding_id = None;
                    let embed_service = embedding_service();
                    match embed_service.embed(&insight.description).await {
                        Ok(result) => {
                            // Single-user system - no user_id field
                            let new_embedding = NewSdkEmbedding {
                                entity_type: "memory".to_string(),
                                entity_id: memory_id.clone(),
                                embedding: result.vector,
                                model_name: None,
                            };

                            if let Ok(emb_id) = db.create_embedding(&new_embedding) {
                                let _ = db.set_memory_embedding(&memory_id, &emb_id);
                                embedding_id = Some(emb_id);
                            }
                        }
                        Err(e) => {
                            warn!("Failed to generate embedding for converted insight: {}", e);
                        }
                    }

                    // Update insight to track linked memory (if the db method exists)
                    // db.link_insight_to_memory(insight_id, &memory_id).ok();

                    debug!("Converted insight {} to memory {}", &insight_id[..8], &memory_id[..8]);
                    ToolOutput {
                        data: json!({
                            "success": true,
                            "memoryId": memory_id,
                            "contentType": content_type,
                            "sourceInsightId": insight_id,
                            "embeddingId": embedding_id
                        }),
                        success: true,
                        error: None,
                        duration_ms: 0,
                        side_effects: vec!["Converted insight to memory".to_string()],
                    }
                }
                Err(e) => tool_error(&e.to_string()),
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
                },
                "userId": {
                    "type": "string",
                    "description": "Optional user ID (overrides default user from context)"
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
            // Use userId from args if provided, otherwise use context
            let user_id = args.get("userId")
                .and_then(|v| v.as_str())
                .map(String::from)
                .unwrap_or_else(|| input.context.user_id.clone());

            let folder_id = match args.get("folderId").and_then(|v| v.as_str()) {
                Some(f) => f,
                None => return tool_error("folderId is required"),
            };

            let knowledge_type = args.get("type").and_then(|v| v.as_str()).unwrap_or("pattern");
            let description = match args.get("description").and_then(|v| v.as_str()) {
                Some(d) => d,
                None => return tool_error("description is required"),
            };

            // Verify folder exists
            let folder = match db.get_folder(folder_id) {
                Ok(Some(f)) => f,
                Ok(None) => return tool_error("Folder not found"),
                Err(e) => return tool_error(&e.to_string()),
            };

            if folder.user_id != user_id {
                return tool_error("Access denied");
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
                            _ => return tool_error("Failed to create knowledge"),
                        },
                        Err(e) => return tool_error(&e.to_string()),
                    }
                }
                Err(e) => return tool_error(&e.to_string()),
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
                _ => return tool_error("Invalid knowledge type"),
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
                Err(e) => tool_error(&e.to_string()),
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
                },
                "userId": {
                    "type": "string",
                    "description": "Optional user ID (overrides default user from context)"
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
            // Use userId from args if provided, otherwise use context
            let user_id = args.get("userId")
                .and_then(|v| v.as_str())
                .map(String::from)
                .unwrap_or_else(|| input.context.user_id.clone());

            let folder_id = match args.get("folderId").and_then(|v| v.as_str()) {
                Some(f) => f,
                None => return tool_error("folderId is required"),
            };

            // Verify folder access
            let folder = match db.get_folder(folder_id) {
                Ok(Some(f)) => f,
                Ok(None) => return tool_error("Folder not found"),
                Err(e) => return tool_error(&e.to_string()),
            };

            if folder.user_id != user_id {
                return tool_error("Access denied");
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
                Err(e) => return tool_error(&e.to_string()),
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
        assert_eq!(SDK_EXTENSION_ID, "rdv");
    }
}
