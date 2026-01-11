//! MCP Server implementation.
//!
//! This server provides both static tools (defined via #[tool_router]) and
//! dynamic extension tools (registered at runtime via DynamicToolRouter).

use rmcp::{
    handler::server::{
        router::tool::ToolRouter,
        tool::ToolCallContext,
        wrapper::Parameters,
    },
    model::{
        CallToolRequestParam, CallToolResult, Content, ListToolsResult,
        PaginatedRequestParam, ServerCapabilities, ServerInfo, Tool,
    },
    schemars::{self, JsonSchema},
    tool, tool_router, ErrorData, RoleServer, ServerHandler,
};
use rdv_sdk::extensions::{MCPToolAdapter, ToolInput, ToolContext};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tracing::{debug, info, warn};

use crate::state::AppState;

/// Remote Dev MCP Server
///
/// Provides MCP tools for AI assistant integration.
#[derive(Clone)]
pub struct McpServer {
    state: Arc<AppState>,
    tool_router: ToolRouter<Self>,
}

impl McpServer {
    pub fn new(state: Arc<AppState>) -> Self {
        Self {
            state,
            tool_router: Self::tool_router(),
        }
    }
}

/// Parameters for session_list tool
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
struct SessionListParams {
    /// Filter sessions by status (active, suspended, closed)
    #[serde(skip_serializing_if = "Option::is_none")]
    status: Option<String>,
    /// Filter sessions by folder ID
    #[serde(rename = "folderId", skip_serializing_if = "Option::is_none")]
    folder_id: Option<String>,
}

/// Parameters for session_create tool
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
struct SessionCreateParams {
    /// Display name for the session
    #[serde(skip_serializing_if = "Option::is_none")]
    name: Option<String>,
    /// Working directory for the terminal
    #[serde(rename = "projectPath", skip_serializing_if = "Option::is_none")]
    project_path: Option<String>,
    /// Folder to create session in
    #[serde(rename = "folderId", skip_serializing_if = "Option::is_none")]
    folder_id: Option<String>,
    /// Agent provider (claude, codex, gemini, opencode, none)
    #[serde(rename = "agentProvider", skip_serializing_if = "Option::is_none")]
    agent_provider: Option<String>,
}

/// Parameters for session_get tool
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
struct SessionGetParams {
    /// Session ID
    #[schemars(description = "The session ID to retrieve")]
    id: String,
}

/// Parameters for folder_list tool
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
struct FolderListParams {
    /// Parent folder ID to list children
    #[serde(rename = "parentId", skip_serializing_if = "Option::is_none")]
    parent_id: Option<String>,
}

/// Parameters for orchestrator_status tool
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
struct OrchestratorStatusParams {
    /// Orchestrator ID (optional, defaults to master)
    #[serde(rename = "orchestratorId", skip_serializing_if = "Option::is_none")]
    orchestrator_id: Option<String>,
}

#[tool_router]
impl McpServer {
    /// List all terminal sessions for the current user
    #[tool(description = "List all terminal sessions. Can filter by status (active, suspended, closed) or folder.")]
    fn session_list(&self, Parameters(params): Parameters<SessionListParams>) -> String {
        let user = match self.state.db.get_default_user() {
            Ok(Some(u)) => u,
            Ok(None) => return serde_json::json!({"success": false, "error": "No user found"}).to_string(),
            Err(e) => return serde_json::json!({"success": false, "error": e.to_string()}).to_string(),
        };

        let sessions = match self.state.db.list_sessions(&user.id, params.folder_id.as_deref()) {
            Ok(s) => s,
            Err(e) => return serde_json::json!({"success": false, "error": e.to_string()}).to_string(),
        };

        // Filter by status if specified
        let filtered: Vec<_> = if let Some(status) = &params.status {
            sessions.into_iter().filter(|s| &s.status == status).collect()
        } else {
            sessions
        };

        let result = serde_json::json!({
            "success": true,
            "count": filtered.len(),
            "sessions": filtered.iter().map(|s| serde_json::json!({
                "id": s.id,
                "name": s.name,
                "status": s.status,
                "tmuxSessionName": s.tmux_session_name,
                "projectPath": s.project_path,
                "folderId": s.folder_id,
                "agentProvider": s.agent_provider,
                "isOrchestratorSession": s.is_orchestrator_session,
            })).collect::<Vec<_>>()
        });

        debug!("session_list: returning {} sessions", filtered.len());
        result.to_string()
    }

    /// Create a new terminal session
    #[tool(description = "Create a new terminal session with optional working directory. Returns the session ID.")]
    fn session_create(&self, Parameters(params): Parameters<SessionCreateParams>) -> String {
        let user = match self.state.db.get_default_user() {
            Ok(Some(u)) => u,
            Ok(None) => return serde_json::json!({"success": false, "error": "No user found"}).to_string(),
            Err(e) => return serde_json::json!({"success": false, "error": e.to_string()}).to_string(),
        };

        // Generate session name and tmux name
        let session_name = params.name.unwrap_or_else(|| "New Session".to_string());
        let tmux_name = format!("rdv-{}", uuid::Uuid::new_v4().to_string().split('-').next().unwrap_or("x"));

        // Create session in database
        let new_session = rdv_core::NewSession {
            user_id: user.id.clone(),
            name: session_name.clone(),
            tmux_session_name: tmux_name.clone(),
            project_path: params.project_path.clone(),
            folder_id: params.folder_id,
            worktree_branch: None,
            agent_provider: params.agent_provider,
            is_orchestrator_session: false,
        };

        let session_id = match self.state.db.create_session(&new_session) {
            Ok(id) => id,
            Err(e) => return serde_json::json!({"success": false, "error": e.to_string()}).to_string(),
        };

        // Create tmux session
        let tmux_config = rdv_core::tmux::CreateSessionConfig {
            session_name: tmux_name.clone(),
            working_directory: params.project_path.clone(),
            ..Default::default()
        };
        if let Err(e) = rdv_core::tmux::create_session(&tmux_config) {
            // Clean up DB record on tmux failure
            let _ = self.state.db.update_session_status(&session_id, "closed");
            return serde_json::json!({"success": false, "error": format!("Failed to create tmux session: {}", e)}).to_string();
        }

        info!("Created session {} (tmux: {})", &session_id[..8], tmux_name);

        serde_json::json!({
            "success": true,
            "session": {
                "id": session_id,
                "name": session_name,
                "tmuxSessionName": tmux_name,
            }
        }).to_string()
    }

    /// Get details of a specific session
    #[tool(description = "Get details of a terminal session by ID.")]
    fn session_get(&self, Parameters(params): Parameters<SessionGetParams>) -> String {
        let session = match self.state.db.get_session(&params.id) {
            Ok(Some(s)) => s,
            Ok(None) => return serde_json::json!({"success": false, "error": format!("Session not found: {}", params.id)}).to_string(),
            Err(e) => return serde_json::json!({"success": false, "error": e.to_string()}).to_string(),
        };

        serde_json::json!({
            "success": true,
            "session": {
                "id": session.id,
                "name": session.name,
                "status": session.status,
                "tmuxSessionName": session.tmux_session_name,
                "projectPath": session.project_path,
                "folderId": session.folder_id,
                "worktreeBranch": session.worktree_branch,
                "agentProvider": session.agent_provider,
                "isOrchestratorSession": session.is_orchestrator_session,
                "createdAt": session.created_at,
                "updatedAt": session.updated_at,
            }
        }).to_string()
    }

    /// List all folders for the current user
    #[tool(description = "List all folders for organizing sessions.")]
    fn folder_list(&self, Parameters(params): Parameters<FolderListParams>) -> String {
        let user = match self.state.db.get_default_user() {
            Ok(Some(u)) => u,
            Ok(None) => return serde_json::json!({"success": false, "error": "No user found"}).to_string(),
            Err(e) => return serde_json::json!({"success": false, "error": e.to_string()}).to_string(),
        };

        let folders = if let Some(parent_id) = &params.parent_id {
            match self.state.db.get_child_folders(parent_id) {
                Ok(f) => f,
                Err(e) => return serde_json::json!({"success": false, "error": e.to_string()}).to_string(),
            }
        } else {
            match self.state.db.list_folders(&user.id) {
                Ok(f) => f,
                Err(e) => return serde_json::json!({"success": false, "error": e.to_string()}).to_string(),
            }
        };

        let result = serde_json::json!({
            "success": true,
            "count": folders.len(),
            "folders": folders.iter().map(|f| serde_json::json!({
                "id": f.id,
                "name": f.name,
                "parentId": f.parent_id,
                "path": f.path,
                "color": f.color,
                "icon": f.icon,
            })).collect::<Vec<_>>()
        });

        debug!("folder_list: returning {} folders", folders.len());
        result.to_string()
    }

    /// Get orchestrator status and statistics
    #[tool(description = "Get status of an orchestrator (master or folder-level).")]
    fn orchestrator_status(&self, Parameters(params): Parameters<OrchestratorStatusParams>) -> String {
        let user = match self.state.db.get_default_user() {
            Ok(Some(u)) => u,
            Ok(None) => return serde_json::json!({"success": false, "error": "No user found"}).to_string(),
            Err(e) => return serde_json::json!({"success": false, "error": e.to_string()}).to_string(),
        };

        let orchestrator = if let Some(orch_id) = &params.orchestrator_id {
            match self.state.db.get_orchestrator(orch_id) {
                Ok(o) => o,
                Err(e) => return serde_json::json!({"success": false, "error": e.to_string()}).to_string(),
            }
        } else {
            // Get master orchestrator by default
            let orchestrators = match self.state.db.list_orchestrators(&user.id) {
                Ok(o) => o,
                Err(e) => return serde_json::json!({"success": false, "error": e.to_string()}).to_string(),
            };
            orchestrators.into_iter().find(|o| o.orchestrator_type == "master")
        };

        match orchestrator {
            Some(orch) => {
                let insight_counts = match self.state.db.get_insight_counts(&orch.id) {
                    Ok(c) => c,
                    Err(e) => return serde_json::json!({"success": false, "error": e.to_string()}).to_string(),
                };

                serde_json::json!({
                    "success": true,
                    "orchestrator": {
                        "id": orch.id,
                        "type": orch.orchestrator_type,
                        "status": orch.status,
                        "folderId": orch.folder_id,
                        "monitoringIntervalSecs": orch.monitoring_interval_secs,
                        "stallThresholdSecs": orch.stall_threshold_secs,
                    },
                    "insights": {
                        "total": insight_counts.total,
                        "unresolved": insight_counts.unresolved,
                        "critical": insight_counts.critical,
                        "high": insight_counts.high,
                    }
                }).to_string()
            }
            None => {
                serde_json::json!({
                    "success": false,
                    "error": "No orchestrator found"
                }).to_string()
            }
        }
    }
}

impl ServerHandler for McpServer {
    fn get_info(&self) -> ServerInfo {
        ServerInfo {
            instructions: Some(
                "Remote Dev MCP Server - Manage terminal sessions, folders, orchestrators, and extension tools."
                    .to_string(),
            ),
            capabilities: ServerCapabilities::builder()
                .enable_tools()
                .build(),
            ..Default::default()
        }
    }

    fn list_tools(
        &self,
        _request: Option<PaginatedRequestParam>,
        _context: rmcp::service::RequestContext<RoleServer>,
    ) -> impl std::future::Future<Output = Result<ListToolsResult, ErrorData>> + Send + '_ {
        async move {
            // Get static tools from the tool router
            let mut tools = self.tool_router.list_all();

            // Get dynamic extension tools
            let extension_tools = self.state.extension_tools.list_mcp_tools().await;
            for mcp_tool in extension_tools {
                // Convert our MCPTool to rmcp's Tool format
                // input_schema must be a JSON object, extract it from the Value
                let input_schema = match mcp_tool.input_schema {
                    serde_json::Value::Object(obj) => Arc::new(obj),
                    _ => Arc::new(serde_json::Map::new()),
                };

                tools.push(Tool {
                    name: mcp_tool.name.into(),
                    title: None,
                    description: Some(mcp_tool.description.into()),
                    input_schema,
                    output_schema: None,
                    annotations: None,
                    icons: None,
                    meta: None,
                });
            }

            debug!("list_tools: returning {} tools ({} static, {} extension)",
                tools.len(),
                self.tool_router.list_all().len(),
                self.state.extension_tools.tool_count().await
            );

            Ok(ListToolsResult {
                tools,
                next_cursor: None,
            })
        }
    }

    fn call_tool(
        &self,
        request: CallToolRequestParam,
        context: rmcp::service::RequestContext<RoleServer>,
    ) -> impl std::future::Future<Output = Result<CallToolResult, ErrorData>> + Send + '_ {
        debug!("Calling tool: {}", request.name);
        async move {
            let tool_name = request.name.as_ref();

            // Check if this is an extension tool (contains ':' separator)
            if tool_name.contains(':') {
                // Try to call as extension tool
                if self.state.extension_tools.has_tool(tool_name).await {
                    // Convert Map to Value for our API
                    let args = request.arguments.map(serde_json::Value::Object);
                    return self.call_extension_tool(tool_name, args).await;
                }
                // Fall through to static router if not found
                warn!("Extension tool not found, trying static router: {}", tool_name);
            }

            // Call static tool via router
            let tool_context = ToolCallContext::new(self, request, context);
            self.tool_router.call(tool_context).await
        }
    }
}

impl McpServer {
    /// Call an extension tool by name
    async fn call_extension_tool(
        &self,
        tool_name: &str,
        arguments: Option<serde_json::Value>,
    ) -> Result<CallToolResult, ErrorData> {
        // Get user context
        let user = match self.state.db.get_default_user() {
            Ok(Some(u)) => u,
            Ok(None) => {
                return Ok(CallToolResult::error(vec![Content::text(
                    serde_json::json!({"success": false, "error": "No user found"}).to_string()
                )]));
            }
            Err(e) => {
                return Ok(CallToolResult::error(vec![Content::text(
                    serde_json::json!({"success": false, "error": e.to_string()}).to_string()
                )]));
            }
        };

        // Build tool input
        let input = ToolInput {
            args: arguments.unwrap_or(serde_json::json!({})),
            context: ToolContext {
                session_id: None,
                user_id: user.id,
                folder_id: None,
                task_id: None,
                metadata: HashMap::new(),
            },
        };

        // Call the extension tool
        match self.state.extension_tools.call_tool(tool_name, input).await {
            Ok(output) => {
                let result = MCPToolAdapter::to_mcp_result(output);
                let text_content: String = result.content.iter()
                    .filter_map(|c| match c {
                        rdv_sdk::extensions::MCPContent::Text { text } => Some(text.clone()),
                        _ => None,
                    })
                    .collect::<Vec<_>>()
                    .join("\n");

                if result.is_error.unwrap_or(false) {
                    Ok(CallToolResult::error(vec![Content::text(text_content)]))
                } else {
                    Ok(CallToolResult::success(vec![Content::text(text_content)]))
                }
            }
            Err(e) => {
                Ok(CallToolResult::error(vec![Content::text(
                    serde_json::json!({"success": false, "error": e.to_string()}).to_string()
                )]))
            }
        }
    }
}
