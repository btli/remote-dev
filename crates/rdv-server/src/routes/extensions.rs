//! Extension management routes.
//!
//! REST API endpoints for managing extensions:
//! - GET /extensions - List all registered extensions
//! - GET /extensions/:id - Get extension details
//! - POST /extensions - Register a new extension
//! - DELETE /extensions/:id - Unregister an extension
//! - POST /extensions/:id/enable - Enable an extension
//! - POST /extensions/:id/disable - Disable an extension
//! - GET /extensions/:id/tools - List tools provided by an extension

use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::{get, post},
    Extension, Json, Router,
};
use rdv_sdk::extensions::ToolDefinition;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tracing::{debug, info, warn};

use crate::middleware::AuthContext;
use crate::state::AppState;

/// Create extensions router
pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/extensions", get(list_extensions).post(register_extension))
        .route(
            "/extensions/{id}",
            get(get_extension).delete(unregister_extension),
        )
        .route("/extensions/{id}/enable", post(enable_extension))
        .route("/extensions/{id}/disable", post(disable_extension))
        .route("/extensions/{id}/tools", get(list_extension_tools))
}

// ============================================================================
// Request/Response Types
// ============================================================================

/// Extension list response
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionListResponse {
    pub extensions: Vec<ExtensionInfo>,
    pub total: usize,
}

/// Extension info for list responses
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionInfo {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: String,
    pub state: String,
    pub tool_count: usize,
    pub prompt_count: usize,
}

/// Extension details response
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionDetailsResponse {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: String,
    pub author: Option<String>,
    pub license: Option<String>,
    pub state: String,
    pub capabilities: Vec<String>,
    pub permissions: Vec<String>,
    pub tools: Vec<ToolInfo>,
    pub config: serde_json::Value,
}

/// Tool info for extension details
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolInfo {
    pub name: String,
    pub display_name: String,
    pub description: String,
    pub category: Option<String>,
    pub is_async: bool,
    pub has_side_effects: bool,
}

/// Register extension request
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegisterExtensionRequest {
    /// Extension manifest
    pub manifest: ExtensionManifestInput,
    /// Initial configuration
    #[serde(default)]
    pub config: serde_json::Value,
    /// Tool definitions (optional - can be added later)
    #[serde(default)]
    pub tools: Vec<ToolDefinitionInput>,
}

/// Extension manifest input
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionManifestInput {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: String,
    #[serde(default)]
    pub author: Option<String>,
    #[serde(default)]
    pub license: Option<String>,
    pub sdk_version: String,
    #[serde(default)]
    pub capabilities: Vec<String>,
    #[serde(default)]
    pub permissions: Vec<String>,
}

/// Tool definition input
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolDefinitionInput {
    pub name: String,
    #[serde(default)]
    pub display_name: Option<String>,
    pub description: String,
    #[serde(default)]
    pub category: Option<String>,
    pub input_schema: serde_json::Value,
    #[serde(default)]
    pub output_schema: Option<serde_json::Value>,
    #[serde(default)]
    pub is_async: bool,
    #[serde(default)]
    pub has_side_effects: bool,
    #[serde(default)]
    pub permissions: Vec<String>,
}

/// Success response
#[derive(Debug, Serialize)]
pub struct SuccessResponse {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

/// Error response
#[derive(Debug, Serialize)]
pub struct ErrorResponse {
    pub success: bool,
    pub error: String,
}

// ============================================================================
// Route Handlers
// ============================================================================

/// List all registered extensions
async fn list_extensions(
    State(state): State<Arc<AppState>>,
    Extension(_auth): Extension<AuthContext>,
) -> Result<Json<ExtensionListResponse>, (StatusCode, Json<ErrorResponse>)> {
    // Get extension tools info from the dynamic router
    let tools = state.extension_tools.list_tools().await;

    // Group tools by extension
    let mut extension_tools: std::collections::HashMap<String, Vec<ToolDefinition>> =
        std::collections::HashMap::new();

    for (full_name, tool) in tools {
        if let Some((ext_id, _)) = full_name.split_once(':') {
            extension_tools
                .entry(ext_id.to_string())
                .or_default()
                .push(tool);
        }
    }

    let extensions: Vec<ExtensionInfo> = extension_tools
        .into_iter()
        .map(|(ext_id, tools)| ExtensionInfo {
            id: ext_id.clone(),
            name: ext_id.clone(), // Default to id if no manifest
            version: "0.0.0".to_string(),
            description: format!("Extension with {} tools", tools.len()),
            state: "active".to_string(),
            tool_count: tools.len(),
            prompt_count: 0,
        })
        .collect();

    let total = extensions.len();

    debug!("list_extensions: returning {} extensions", total);

    Ok(Json(ExtensionListResponse { extensions, total }))
}

/// Get extension details by ID
async fn get_extension(
    State(state): State<Arc<AppState>>,
    Extension(_auth): Extension<AuthContext>,
    Path(id): Path<String>,
) -> Result<Json<ExtensionDetailsResponse>, (StatusCode, Json<ErrorResponse>)> {
    // Get tools for this extension
    let tools = state.extension_tools.tools_by_extension(&id).await;

    if tools.is_empty() {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                success: false,
                error: format!("Extension not found: {}", id),
            }),
        ));
    }

    let tool_infos: Vec<ToolInfo> = tools
        .iter()
        .map(|t| ToolInfo {
            name: t.name.clone(),
            display_name: t.display_name.clone(),
            description: t.description.clone(),
            category: t.category.clone(),
            is_async: t.is_async,
            has_side_effects: t.has_side_effects,
        })
        .collect();

    Ok(Json(ExtensionDetailsResponse {
        id: id.clone(),
        name: id.clone(),
        version: "0.0.0".to_string(),
        description: format!("Extension with {} tools", tools.len()),
        author: None,
        license: None,
        state: "active".to_string(),
        capabilities: vec!["tools".to_string()],
        permissions: vec![],
        tools: tool_infos,
        config: serde_json::json!({}),
    }))
}

/// Register a new extension
async fn register_extension(
    State(state): State<Arc<AppState>>,
    Extension(_auth): Extension<AuthContext>,
    Json(request): Json<RegisterExtensionRequest>,
) -> Result<Json<SuccessResponse>, (StatusCode, Json<ErrorResponse>)> {
    let ext_id = request.manifest.id.clone();

    // Convert input tools to ToolDefinition
    let tools: Vec<ToolDefinition> = request
        .tools
        .into_iter()
        .map(|t| ToolDefinition {
            name: t.name.clone(),
            display_name: t.display_name.unwrap_or_else(|| t.name.clone()),
            description: t.description,
            category: t.category,
            input_schema: t.input_schema,
            output_schema: t.output_schema,
            is_async: t.is_async,
            has_side_effects: t.has_side_effects,
            permissions: t.permissions,
            examples: vec![],
        })
        .collect();

    // Register tools with the dynamic router
    match state.extension_tools.register_tools(&ext_id, tools).await {
        Ok(count) => {
            info!("Registered extension {} with {} tools", ext_id, count);
            Ok(Json(SuccessResponse {
                success: true,
                message: Some(format!(
                    "Extension {} registered with {} tools",
                    ext_id, count
                )),
            }))
        }
        Err(e) => {
            warn!("Failed to register extension {}: {}", ext_id, e);
            Err((
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    success: false,
                    error: e.to_string(),
                }),
            ))
        }
    }
}

/// Unregister an extension
async fn unregister_extension(
    State(state): State<Arc<AppState>>,
    Extension(_auth): Extension<AuthContext>,
    Path(id): Path<String>,
) -> Result<Json<SuccessResponse>, (StatusCode, Json<ErrorResponse>)> {
    match state.extension_tools.unregister_extension(&id).await {
        Ok(count) => {
            info!("Unregistered extension {} ({} tools removed)", id, count);
            Ok(Json(SuccessResponse {
                success: true,
                message: Some(format!(
                    "Extension {} unregistered ({} tools removed)",
                    id, count
                )),
            }))
        }
        Err(e) => {
            warn!("Failed to unregister extension {}: {}", id, e);
            Err((
                StatusCode::NOT_FOUND,
                Json(ErrorResponse {
                    success: false,
                    error: e.to_string(),
                }),
            ))
        }
    }
}

/// Enable an extension (placeholder - extensions are always active in DynamicToolRouter)
async fn enable_extension(
    State(_state): State<Arc<AppState>>,
    Extension(_auth): Extension<AuthContext>,
    Path(id): Path<String>,
) -> Result<Json<SuccessResponse>, (StatusCode, Json<ErrorResponse>)> {
    // In the current implementation, registered extensions are always active
    // This endpoint is a placeholder for future ExtensionRegistry integration
    info!("Enable extension {} (no-op in current implementation)", id);
    Ok(Json(SuccessResponse {
        success: true,
        message: Some(format!("Extension {} is active", id)),
    }))
}

/// Disable an extension (placeholder)
async fn disable_extension(
    State(_state): State<Arc<AppState>>,
    Extension(_auth): Extension<AuthContext>,
    Path(id): Path<String>,
) -> Result<Json<SuccessResponse>, (StatusCode, Json<ErrorResponse>)> {
    // Placeholder for future implementation
    info!("Disable extension {} (no-op in current implementation)", id);
    Ok(Json(SuccessResponse {
        success: true,
        message: Some(format!("Extension {} disabled (tools still registered)", id)),
    }))
}

/// List tools provided by an extension
async fn list_extension_tools(
    State(state): State<Arc<AppState>>,
    Extension(_auth): Extension<AuthContext>,
    Path(id): Path<String>,
) -> Result<Json<Vec<ToolInfo>>, (StatusCode, Json<ErrorResponse>)> {
    let tools = state.extension_tools.tools_by_extension(&id).await;

    if tools.is_empty() {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                success: false,
                error: format!("Extension not found or has no tools: {}", id),
            }),
        ));
    }

    let tool_infos: Vec<ToolInfo> = tools
        .iter()
        .map(|t| ToolInfo {
            name: t.name.clone(),
            display_name: t.display_name.clone(),
            description: t.description.clone(),
            category: t.category.clone(),
            is_async: t.is_async,
            has_side_effects: t.has_side_effects,
        })
        .collect();

    debug!(
        "list_extension_tools: returning {} tools for {}",
        tool_infos.len(),
        id
    );

    Ok(Json(tool_infos))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extension_info_serialize() {
        let info = ExtensionInfo {
            id: "test-ext".to_string(),
            name: "Test Extension".to_string(),
            version: "1.0.0".to_string(),
            description: "A test extension".to_string(),
            state: "active".to_string(),
            tool_count: 3,
            prompt_count: 0,
        };

        let json = serde_json::to_value(&info).unwrap();
        assert_eq!(json["id"], "test-ext");
        assert_eq!(json["toolCount"], 3);
    }

    #[test]
    fn test_register_request_deserialize() {
        let json = r#"{
            "manifest": {
                "id": "my-ext",
                "name": "My Extension",
                "version": "1.0.0",
                "description": "Test",
                "sdkVersion": "0.1.0"
            },
            "tools": [{
                "name": "test_tool",
                "description": "A test tool",
                "inputSchema": {"type": "object"}
            }]
        }"#;

        let request: RegisterExtensionRequest = serde_json::from_str(json).unwrap();
        assert_eq!(request.manifest.id, "my-ext");
        assert_eq!(request.tools.len(), 1);
        assert_eq!(request.tools[0].name, "test_tool");
    }

    #[test]
    fn test_tool_definition_input_defaults() {
        let json = r#"{
            "name": "minimal_tool",
            "description": "Minimal",
            "inputSchema": {}
        }"#;

        let tool: ToolDefinitionInput = serde_json::from_str(json).unwrap();
        assert!(!tool.is_async);
        assert!(!tool.has_side_effects);
        assert!(tool.permissions.is_empty());
    }
}
