//! Project knowledge management routes.

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    routing::get,
    Extension, Json, Router,
};
use rdv_core::db::types::{
    AgentPerformance, Convention, LearnedPattern, NewProjectKnowledge,
    ProjectKnowledgeMetadata, SkillDefinition, ToolDefinition, ToolImplementation,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

use crate::middleware::AuthContext;
use crate::state::AppState;

/// Create knowledge router
pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/folders/:id/knowledge", get(get_knowledge).patch(update_knowledge).delete(delete_knowledge))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetKnowledgeQuery {
    pub search: Option<String>,
    #[serde(rename = "type")]
    pub filter_type: Option<String>,
    pub category: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeResponse {
    pub knowledge: Option<KnowledgeSummary>,
    pub exists: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub conventions: Option<Vec<Convention>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub patterns: Option<Vec<LearnedPattern>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skills: Option<Vec<SkillDefinition>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tools: Option<Vec<ToolDefinition>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_performance: Option<AgentPerformance>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub search_results: Option<Vec<SearchResult>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeSummary {
    pub id: String,
    pub folder_id: String,
    pub tech_stack: Vec<String>,
    pub metadata: ProjectKnowledgeMetadata,
    pub last_scanned_at: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    #[serde(rename = "type")]
    pub result_type: String,
    pub item: serde_json::Value,
    pub score: f64,
}

/// Get project knowledge for a folder
pub async fn get_knowledge(
    State(state): State<Arc<AppState>>,
    Extension(auth): Extension<AuthContext>,
    Path(folder_id): Path<String>,
    Query(query): Query<GetKnowledgeQuery>,
) -> Result<Json<KnowledgeResponse>, (StatusCode, String)> {
    let user_id = auth.user_id();

    // Verify folder exists and belongs to user
    let folder = state
        .db
        .get_folder(&folder_id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or_else(|| (StatusCode::NOT_FOUND, "Folder not found".to_string()))?;

    if folder.user_id != user_id {
        return Err((StatusCode::FORBIDDEN, "Access denied".to_string()));
    }

    // Get knowledge
    let knowledge = state
        .db
        .get_project_knowledge_by_folder(&folder_id, user_id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    match knowledge {
        None => Ok(Json(KnowledgeResponse {
            knowledge: None,
            exists: false,
            conventions: None,
            patterns: None,
            skills: None,
            tools: None,
            agent_performance: None,
            search_results: None,
        })),
        Some(k) => {
            let summary = KnowledgeSummary {
                id: k.id.clone(),
                folder_id: k.folder_id.clone(),
                tech_stack: k.tech_stack.clone(),
                metadata: k.metadata.clone(),
                last_scanned_at: k.last_scanned_at,
                created_at: k.created_at,
                updated_at: k.updated_at,
            };

            // Handle search (basic substring matching for now)
            if let Some(search_query) = &query.search {
                let search_lower = search_query.to_lowercase();
                let mut results = Vec::new();

                // Search conventions
                for conv in &k.conventions {
                    if conv.description.to_lowercase().contains(&search_lower) {
                        results.push(SearchResult {
                            result_type: "convention".to_string(),
                            item: serde_json::to_value(conv).unwrap_or_default(),
                            score: 0.8,
                        });
                    }
                }

                // Search patterns
                for pattern in &k.patterns {
                    if pattern.description.to_lowercase().contains(&search_lower) {
                        results.push(SearchResult {
                            result_type: "pattern".to_string(),
                            item: serde_json::to_value(pattern).unwrap_or_default(),
                            score: 0.7,
                        });
                    }
                }

                // Search skills
                for skill in &k.skills {
                    if skill.name.to_lowercase().contains(&search_lower)
                        || skill.description.to_lowercase().contains(&search_lower)
                    {
                        results.push(SearchResult {
                            result_type: "skill".to_string(),
                            item: serde_json::to_value(skill).unwrap_or_default(),
                            score: 0.7,
                        });
                    }
                }

                // Search tools
                for tool in &k.tools {
                    if tool.name.to_lowercase().contains(&search_lower)
                        || tool.description.to_lowercase().contains(&search_lower)
                    {
                        results.push(SearchResult {
                            result_type: "tool".to_string(),
                            item: serde_json::to_value(tool).unwrap_or_default(),
                            score: 0.6,
                        });
                    }
                }

                // Limit results
                results.truncate(10);

                return Ok(Json(KnowledgeResponse {
                    knowledge: Some(summary),
                    exists: true,
                    conventions: None,
                    patterns: None,
                    skills: None,
                    tools: None,
                    agent_performance: None,
                    search_results: Some(results),
                }));
            }

            // Handle type filter
            let type_filter = query.filter_type.as_deref();
            let category_filter = query.category.as_deref();

            let conventions = if type_filter.is_none() || type_filter == Some("convention") {
                let mut convs = k.conventions.clone();
                if let Some(cat) = category_filter {
                    convs.retain(|c| c.category == cat);
                }
                Some(convs)
            } else {
                None
            };

            let patterns = if type_filter.is_none() || type_filter == Some("pattern") {
                Some(k.patterns.clone())
            } else {
                None
            };

            let skills = if type_filter.is_none() || type_filter == Some("skill") {
                Some(k.skills.clone())
            } else {
                None
            };

            let tools = if type_filter.is_none() || type_filter == Some("tool") {
                Some(k.tools.clone())
            } else {
                None
            };

            let agent_performance = if type_filter.is_none() {
                Some(k.agent_performance.clone())
            } else {
                None
            };

            Ok(Json(KnowledgeResponse {
                knowledge: Some(summary),
                exists: true,
                conventions,
                patterns,
                skills,
                tools,
                agent_performance,
                search_results: None,
            }))
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateKnowledgeRequest {
    pub action: String,
    pub data: Option<serde_json::Value>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateKnowledgeResponse {
    pub knowledge: KnowledgeSummary,
    pub action: String,
    pub success: bool,
}

/// Update project knowledge
pub async fn update_knowledge(
    State(state): State<Arc<AppState>>,
    Extension(auth): Extension<AuthContext>,
    Path(folder_id): Path<String>,
    Json(req): Json<UpdateKnowledgeRequest>,
) -> Result<Json<UpdateKnowledgeResponse>, (StatusCode, String)> {
    let user_id = auth.user_id();

    // Verify folder exists and belongs to user
    let folder = state
        .db
        .get_folder(&folder_id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or_else(|| (StatusCode::NOT_FOUND, "Folder not found".to_string()))?;

    if folder.user_id != user_id {
        return Err((StatusCode::FORBIDDEN, "Access denied".to_string()));
    }

    // Get or create knowledge
    let mut knowledge = match state
        .db
        .get_project_knowledge_by_folder(&folder_id, user_id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    {
        Some(k) => k,
        None => {
            let _id = state
                .db
                .create_project_knowledge(&NewProjectKnowledge {
                    folder_id: folder_id.clone(),
                    user_id: user_id.to_string(),
                })
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

            state
                .db
                .get_project_knowledge_by_folder(&folder_id, user_id)
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
                .ok_or_else(|| (StatusCode::INTERNAL_SERVER_ERROR, "Failed to create knowledge".to_string()))?
        }
    };

    let data = req.data.clone().unwrap_or(serde_json::Value::Null);

    match req.action.as_str() {
        "add_convention" => {
            let description = data.get("description")
                .and_then(|v| v.as_str())
                .ok_or_else(|| (StatusCode::BAD_REQUEST, "description required".to_string()))?;
            let category = data.get("category")
                .and_then(|v| v.as_str())
                .ok_or_else(|| (StatusCode::BAD_REQUEST, "category required".to_string()))?;

            let conv = Convention {
                id: uuid::Uuid::new_v4().to_string(),
                category: category.to_string(),
                description: description.to_string(),
                examples: data.get("examples")
                    .and_then(|v| serde_json::from_value(v.clone()).ok())
                    .unwrap_or_default(),
                confidence: data.get("confidence")
                    .and_then(|v| v.as_f64())
                    .unwrap_or(0.8),
                source: "manual".to_string(),
                created_at: chrono::Utc::now().timestamp_millis(),
            };
            knowledge.conventions.push(conv);
        }
        "add_pattern" => {
            let pattern_type = data.get("type")
                .and_then(|v| v.as_str())
                .ok_or_else(|| (StatusCode::BAD_REQUEST, "type required".to_string()))?;
            let description = data.get("description")
                .and_then(|v| v.as_str())
                .ok_or_else(|| (StatusCode::BAD_REQUEST, "description required".to_string()))?;

            let pattern = LearnedPattern {
                id: uuid::Uuid::new_v4().to_string(),
                pattern_type: pattern_type.to_string(),
                description: description.to_string(),
                context: data.get("context")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                confidence: data.get("confidence")
                    .and_then(|v| v.as_f64())
                    .unwrap_or(0.7),
                usage_count: 0,
                last_used_at: None,
                created_at: chrono::Utc::now().timestamp_millis(),
            };
            knowledge.patterns.push(pattern);
        }
        "add_skill" => {
            let name = data.get("name")
                .and_then(|v| v.as_str())
                .ok_or_else(|| (StatusCode::BAD_REQUEST, "name required".to_string()))?;
            let command = data.get("command")
                .and_then(|v| v.as_str())
                .ok_or_else(|| (StatusCode::BAD_REQUEST, "command required".to_string()))?;

            let skill = SkillDefinition {
                id: uuid::Uuid::new_v4().to_string(),
                name: name.to_string(),
                description: data.get("description")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                command: command.to_string(),
                steps: data.get("steps")
                    .and_then(|v| serde_json::from_value(v.clone()).ok())
                    .unwrap_or_default(),
                triggers: data.get("triggers")
                    .and_then(|v| serde_json::from_value(v.clone()).ok())
                    .unwrap_or_default(),
                scope: "project".to_string(),
                verified: false,
                usage_count: 0,
                created_at: chrono::Utc::now().timestamp_millis(),
            };
            knowledge.skills.push(skill);
        }
        "add_tool" => {
            let name = data.get("name")
                .and_then(|v| v.as_str())
                .ok_or_else(|| (StatusCode::BAD_REQUEST, "name required".to_string()))?;
            let description = data.get("description")
                .and_then(|v| v.as_str())
                .ok_or_else(|| (StatusCode::BAD_REQUEST, "description required".to_string()))?;

            let tool = ToolDefinition {
                id: uuid::Uuid::new_v4().to_string(),
                name: name.to_string(),
                description: description.to_string(),
                input_schema: data.get("inputSchema")
                    .cloned()
                    .unwrap_or(serde_json::json!({})),
                implementation: ToolImplementation {
                    impl_type: data.get("implementationType")
                        .and_then(|v| v.as_str())
                        .unwrap_or("command")
                        .to_string(),
                    code: data.get("implementationCode")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string(),
                },
                triggers: data.get("triggers")
                    .and_then(|v| serde_json::from_value(v.clone()).ok())
                    .unwrap_or_default(),
                confidence: data.get("confidence")
                    .and_then(|v| v.as_f64())
                    .unwrap_or(0.5),
                verified: false,
                created_at: chrono::Utc::now().timestamp_millis(),
            };
            knowledge.tools.push(tool);
        }
        "update_tech_stack" => {
            let tech_stack: Vec<String> = data.get("techStack")
                .and_then(|v| serde_json::from_value(v.clone()).ok())
                .ok_or_else(|| (StatusCode::BAD_REQUEST, "techStack array required".to_string()))?;
            knowledge.tech_stack = tech_stack;
        }
        "update_metadata" => {
            if let Some(name) = data.get("projectName").and_then(|v| v.as_str()) {
                knowledge.metadata.project_name = Some(name.to_string());
            }
            if let Some(path) = data.get("projectPath").and_then(|v| v.as_str()) {
                knowledge.metadata.project_path = Some(path.to_string());
            }
            if let Some(framework) = data.get("framework").and_then(|v| v.as_str()) {
                knowledge.metadata.framework = Some(framework.to_string());
            }
            if let Some(pm) = data.get("packageManager").and_then(|v| v.as_str()) {
                knowledge.metadata.package_manager = Some(pm.to_string());
            }
            if let Some(tr) = data.get("testRunner").and_then(|v| v.as_str()) {
                knowledge.metadata.test_runner = Some(tr.to_string());
            }
            if let Some(linter) = data.get("linter").and_then(|v| v.as_str()) {
                knowledge.metadata.linter = Some(linter.to_string());
            }
            if let Some(bt) = data.get("buildTool").and_then(|v| v.as_str()) {
                knowledge.metadata.build_tool = Some(bt.to_string());
            }
        }
        "scan" => {
            knowledge.last_scanned_at = Some(chrono::Utc::now().timestamp_millis());
        }
        _ => {
            return Err((StatusCode::BAD_REQUEST, format!("Unknown action: {}", req.action)));
        }
    }

    // Save updates
    state
        .db
        .update_project_knowledge(&knowledge)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let summary = KnowledgeSummary {
        id: knowledge.id,
        folder_id: knowledge.folder_id,
        tech_stack: knowledge.tech_stack,
        metadata: knowledge.metadata,
        last_scanned_at: knowledge.last_scanned_at,
        created_at: knowledge.created_at,
        updated_at: chrono::Utc::now().timestamp_millis(),
    };

    Ok(Json(UpdateKnowledgeResponse {
        knowledge: summary,
        action: req.action,
        success: true,
    }))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteKnowledgeResponse {
    pub success: bool,
    pub deleted: bool,
}

/// Delete project knowledge
pub async fn delete_knowledge(
    State(state): State<Arc<AppState>>,
    Extension(auth): Extension<AuthContext>,
    Path(folder_id): Path<String>,
) -> Result<Json<DeleteKnowledgeResponse>, (StatusCode, String)> {
    let user_id = auth.user_id();

    // Verify folder exists and belongs to user
    let folder = state
        .db
        .get_folder(&folder_id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or_else(|| (StatusCode::NOT_FOUND, "Folder not found".to_string()))?;

    if folder.user_id != user_id {
        return Err((StatusCode::FORBIDDEN, "Access denied".to_string()));
    }

    // Get knowledge
    let knowledge = state
        .db
        .get_project_knowledge_by_folder(&folder_id, user_id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    match knowledge {
        None => Err((StatusCode::NOT_FOUND, "Knowledge not found".to_string())),
        Some(k) => {
            state
                .db
                .delete_project_knowledge(&k.id)
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

            Ok(Json(DeleteKnowledgeResponse {
                success: true,
                deleted: true,
            }))
        }
    }
}
