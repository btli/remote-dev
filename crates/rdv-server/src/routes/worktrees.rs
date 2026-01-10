//! Worktree management routes.

use axum::{
    extract::{Query, State},
    http::StatusCode,
    routing::{delete, get, post},
    Extension, Json, Router,
};
use rdv_core::worktree;
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::Arc;

use crate::middleware::AuthContext;
use crate::state::AppState;

/// Create worktree router
pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/worktrees", get(list_worktrees).post(create_worktree))
        .route("/worktrees/remove", delete(remove_worktree))
        .route("/worktrees/status", get(get_status))
}

#[derive(Debug, Deserialize)]
pub struct ListWorktreesQuery {
    pub repo_path: String,
}

#[derive(Debug, Serialize)]
pub struct WorktreeResponse {
    pub path: String,
    pub branch: String,
    pub commit: Option<String>,
    pub is_bare: bool,
}

/// List worktrees for a repository
pub async fn list_worktrees(
    State(_state): State<Arc<AppState>>,
    Extension(_auth): Extension<AuthContext>,
    Query(query): Query<ListWorktreesQuery>,
) -> Result<Json<Vec<WorktreeResponse>>, (StatusCode, String)> {
    let repo_path = Path::new(&query.repo_path);

    // Verify it's a git repo
    worktree::is_git_repo(repo_path)
        .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;

    // List worktrees using git command
    let output = std::process::Command::new("git")
        .args(["worktree", "list", "--porcelain"])
        .current_dir(repo_path)
        .output()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    if !output.status.success() {
        return Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to list worktrees".to_string(),
        ));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut worktrees = Vec::new();
    let mut current_path = None;
    let mut current_branch = None;
    let mut current_commit = None;
    let mut is_bare = false;

    for line in stdout.lines() {
        if line.starts_with("worktree ") {
            // Save previous worktree if any
            if let (Some(path), Some(branch)) = (current_path.take(), current_branch.take()) {
                worktrees.push(WorktreeResponse {
                    path,
                    branch,
                    commit: current_commit.take(),
                    is_bare,
                });
                is_bare = false;
            }
            current_path = Some(line.strip_prefix("worktree ").unwrap().to_string());
        } else if line.starts_with("HEAD ") {
            current_commit = Some(line.strip_prefix("HEAD ").unwrap().to_string());
        } else if line.starts_with("branch ") {
            current_branch = Some(
                line.strip_prefix("branch refs/heads/")
                    .unwrap_or(line.strip_prefix("branch ").unwrap())
                    .to_string(),
            );
        } else if line == "bare" {
            is_bare = true;
            current_branch = Some("(bare)".to_string());
        } else if line == "detached" {
            current_branch = Some("(detached)".to_string());
        }
    }

    // Don't forget the last worktree
    if let (Some(path), Some(branch)) = (current_path, current_branch) {
        worktrees.push(WorktreeResponse {
            path,
            branch,
            commit: current_commit,
            is_bare,
        });
    }

    Ok(Json(worktrees))
}

#[derive(Debug, Deserialize)]
pub struct CreateWorktreeRequest {
    pub repo_path: String,
    pub branch: String,
    pub worktree_path: Option<String>,
    pub create_branch: bool,
    pub base_branch: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct CreateWorktreeResponse {
    pub path: String,
    pub branch: String,
    pub created_branch: bool,
}

/// Create a new worktree
pub async fn create_worktree(
    State(_state): State<Arc<AppState>>,
    Extension(_auth): Extension<AuthContext>,
    Json(req): Json<CreateWorktreeRequest>,
) -> Result<(StatusCode, Json<CreateWorktreeResponse>), (StatusCode, String)> {
    let repo_path = Path::new(&req.repo_path);

    // Verify it's a git repo
    worktree::is_git_repo(repo_path)
        .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;

    let worktree_path = req.worktree_path.as_ref().map(|p| Path::new(p));

    let (path, created_branch) = if req.create_branch {
        // Create branch and worktree
        let info = worktree::create_branch_with_worktree(
            repo_path,
            &req.branch,
            req.base_branch.as_deref(),
            worktree_path,
        )
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

        (info.path, true)
    } else {
        // Create worktree for existing branch
        let path = worktree::create_worktree(repo_path, &req.branch, worktree_path)
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

        (path, false)
    };

    Ok((
        StatusCode::CREATED,
        Json(CreateWorktreeResponse {
            path: path.to_string_lossy().to_string(),
            branch: req.branch,
            created_branch,
        }),
    ))
}

#[derive(Debug, Deserialize)]
pub struct RemoveWorktreeQuery {
    pub worktree_path: String,
    pub force: Option<bool>,
}

/// Remove a worktree
pub async fn remove_worktree(
    State(_state): State<Arc<AppState>>,
    Extension(_auth): Extension<AuthContext>,
    Query(query): Query<RemoveWorktreeQuery>,
) -> Result<StatusCode, (StatusCode, String)> {
    let worktree_path = Path::new(&query.worktree_path);

    if !worktree_path.exists() {
        return Err((StatusCode::NOT_FOUND, "Worktree path not found".to_string()));
    }

    // Remove worktree using git command
    let mut args = vec!["worktree", "remove"];
    if query.force.unwrap_or(false) {
        args.push("--force");
    }
    args.push(&query.worktree_path);

    let output = std::process::Command::new("git")
        .args(&args)
        .output()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err((StatusCode::INTERNAL_SERVER_ERROR, stderr.to_string()));
    }

    Ok(StatusCode::NO_CONTENT)
}

#[derive(Debug, Deserialize)]
pub struct WorktreeStatusQuery {
    pub worktree_path: String,
}

#[derive(Debug, Serialize)]
pub struct WorktreeStatusResponse {
    pub exists: bool,
    pub is_clean: bool,
    pub branch: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    pub untracked: u32,
    pub modified: u32,
    pub staged: u32,
}

/// Get worktree status
pub async fn get_status(
    State(_state): State<Arc<AppState>>,
    Extension(_auth): Extension<AuthContext>,
    Query(query): Query<WorktreeStatusQuery>,
) -> Result<Json<WorktreeStatusResponse>, (StatusCode, String)> {
    let worktree_path = Path::new(&query.worktree_path);

    if !worktree_path.exists() {
        return Ok(Json(WorktreeStatusResponse {
            exists: false,
            is_clean: false,
            branch: None,
            ahead: 0,
            behind: 0,
            untracked: 0,
            modified: 0,
            staged: 0,
        }));
    }

    // Get current branch
    let branch_output = std::process::Command::new("git")
        .args(["rev-parse", "--abbrev-ref", "HEAD"])
        .current_dir(worktree_path)
        .output()
        .ok();

    let branch = branch_output.and_then(|o| {
        if o.status.success() {
            Some(String::from_utf8_lossy(&o.stdout).trim().to_string())
        } else {
            None
        }
    });

    // Get status
    let status_output = std::process::Command::new("git")
        .args(["status", "--porcelain"])
        .current_dir(worktree_path)
        .output()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let status_str = String::from_utf8_lossy(&status_output.stdout);
    let mut untracked = 0;
    let mut modified = 0;
    let mut staged = 0;

    for line in status_str.lines() {
        if line.starts_with("??") {
            untracked += 1;
        } else if line.starts_with(" M") || line.starts_with(" D") {
            modified += 1;
        } else if !line.is_empty() {
            staged += 1;
        }
    }

    let is_clean = untracked == 0 && modified == 0 && staged == 0;

    // Get ahead/behind counts
    let rev_list_output = std::process::Command::new("git")
        .args(["rev-list", "--left-right", "--count", "@{u}...HEAD"])
        .current_dir(worktree_path)
        .output()
        .ok();

    let (behind, ahead) = rev_list_output
        .and_then(|o| {
            if o.status.success() {
                let s = String::from_utf8_lossy(&o.stdout);
                let parts: Vec<&str> = s.trim().split('\t').collect();
                if parts.len() == 2 {
                    Some((
                        parts[0].parse().unwrap_or(0),
                        parts[1].parse().unwrap_or(0),
                    ))
                } else {
                    None
                }
            } else {
                None
            }
        })
        .unwrap_or((0, 0));

    Ok(Json(WorktreeStatusResponse {
        exists: true,
        is_clean,
        branch,
        ahead,
        behind,
        untracked,
        modified,
        staged,
    }))
}
