//! Git worktree management.
//!
//! Provides operations for creating and managing git worktrees:
//! - Create worktree for branch
//! - Create new branch with worktree
//! - Remove worktree safely
//! - Copy env files to worktree

use crate::error::{Error, Result};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use tracing::debug;

/// Files to copy from main repo to worktree (development env files only)
const ENV_FILES_TO_COPY: &[&str] = &[".env", ".env.local", ".env.development", ".env.development.local"];

/// Check if a directory is a git repository
pub fn is_git_repo(path: &Path) -> Result<bool> {
    let output = Command::new("git")
        .args(["-C", &path.to_string_lossy(), "rev-parse", "--git-dir"])
        .output()?;

    Ok(output.status.success())
}

/// Get the root directory of a git repository
pub fn get_repo_root(path: &Path) -> Result<Option<PathBuf>> {
    let output = Command::new("git")
        .args(["-C", &path.to_string_lossy(), "rev-parse", "--show-toplevel"])
        .output()?;

    if output.status.success() {
        let root = String::from_utf8_lossy(&output.stdout).trim().to_string();
        Ok(Some(PathBuf::from(root)))
    } else {
        Ok(None)
    }
}

/// Fetch remote refs to ensure we have the latest
pub fn fetch_remote_refs(repo_path: &Path) -> Result<bool> {
    let output = Command::new("git")
        .args(["-C", &repo_path.to_string_lossy(), "fetch", "origin"])
        .output()?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        debug!("Warning: Could not fetch from origin: {}", stderr);
        return Ok(false);
    }

    Ok(true)
}

/// Sanitize a branch name for use in filesystem paths
pub fn sanitize_branch_name(name: &str) -> String {
    name.to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '-' { c } else { '-' })
        .collect::<String>()
        .replace("--", "-")
        .trim_matches('-')
        .to_string()
}

/// Generate a unique branch name for a session
pub fn generate_branch_name(session_id: &str, prefix: &str) -> String {
    let short_id = &session_id[..8.min(session_id.len())];
    let timestamp = chrono::Utc::now().timestamp();
    format!("{}/{}-{:x}", prefix, short_id, timestamp)
}

/// Create a worktree for an existing branch
pub fn create_worktree(
    repo_path: &Path,
    branch: &str,
    worktree_path: Option<&Path>,
) -> Result<PathBuf> {
    // Validate repo
    if !is_git_repo(repo_path)? {
        return Err(Error::NotGitRepo(repo_path.to_string_lossy().to_string()));
    }

    // Fetch to ensure we have latest refs
    let _ = fetch_remote_refs(repo_path);

    // Generate worktree path if not provided
    let target_path = worktree_path
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            let parent = repo_path.parent().unwrap_or(repo_path);
            let repo_name = repo_path.file_name().unwrap_or_default().to_string_lossy();
            parent.join(format!("{}-{}", repo_name, sanitize_branch_name(branch)))
        });

    // Check if path already exists
    if target_path.exists() {
        return Err(Error::WorktreePathExists(target_path.to_string_lossy().to_string()));
    }

    // Create parent directory if needed
    if let Some(parent) = target_path.parent() {
        fs::create_dir_all(parent)?;
    }

    // Create worktree
    let output = Command::new("git")
        .args([
            "-C",
            &repo_path.to_string_lossy(),
            "worktree",
            "add",
            &target_path.to_string_lossy(),
            branch,
        ])
        .output()?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(Error::Worktree(stderr.to_string()));
    }

    debug!("Created worktree at {:?} for branch {}", target_path, branch);
    Ok(target_path)
}

/// Create a new branch with a worktree
pub fn create_branch_with_worktree(
    repo_path: &Path,
    branch_name: &str,
    base_branch: Option<&str>,
    worktree_path: Option<&Path>,
) -> Result<WorktreeInfo> {
    // Validate repo
    if !is_git_repo(repo_path)? {
        return Err(Error::NotGitRepo(repo_path.to_string_lossy().to_string()));
    }

    // Fetch to ensure we have latest refs
    let _ = fetch_remote_refs(repo_path);

    // Generate worktree path if not provided
    let target_path = worktree_path
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            let parent = repo_path.parent().unwrap_or(repo_path);
            let repo_name = repo_path.file_name().unwrap_or_default().to_string_lossy();
            parent.join(format!("{}-{}", repo_name, sanitize_branch_name(branch_name)))
        });

    // Create parent directory if needed
    if let Some(parent) = target_path.parent() {
        fs::create_dir_all(parent)?;
    }

    // Build command args
    let mut args = vec![
        "-C".to_string(),
        repo_path.to_string_lossy().to_string(),
        "worktree".to_string(),
        "add".to_string(),
        "-b".to_string(),
        branch_name.to_string(),
        target_path.to_string_lossy().to_string(),
    ];

    // Add base branch if provided
    if let Some(base) = base_branch {
        // Try origin/base first, fall back to base
        let remote_ref = format!("origin/{}", base);
        let check = Command::new("git")
            .args([
                "-C",
                &repo_path.to_string_lossy(),
                "rev-parse",
                "--verify",
                &remote_ref,
            ])
            .output()?;

        if check.status.success() {
            args.push(remote_ref);
        } else {
            args.push(base.to_string());
        }
    }

    let output = Command::new("git").args(&args).output()?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if stderr.contains("already exists") {
            return Err(Error::WorktreePathExists(target_path.to_string_lossy().to_string()));
        }
        if stderr.contains("already checked out") {
            return Err(Error::BranchInUse(branch_name.to_string()));
        }
        return Err(Error::Worktree(stderr.to_string()));
    }

    debug!(
        "Created branch {} with worktree at {:?}",
        branch_name, target_path
    );

    Ok(WorktreeInfo {
        path: target_path,
        branch: branch_name.to_string(),
    })
}

/// Copy env files from source repo to worktree
pub fn copy_env_files(source_repo: &Path, worktree_path: &Path) -> CopyEnvResult {
    let mut result = CopyEnvResult {
        copied: Vec::new(),
        skipped: Vec::new(),
    };

    for env_file in ENV_FILES_TO_COPY {
        let source = source_repo.join(env_file);
        let target = worktree_path.join(env_file);

        // Skip if source doesn't exist
        if !source.exists() {
            result.skipped.push(env_file.to_string());
            continue;
        }

        // Skip if target already exists
        if target.exists() {
            debug!("Skipping {}: already exists in worktree", env_file);
            result.skipped.push(env_file.to_string());
            continue;
        }

        // Copy the file
        match fs::copy(&source, &target) {
            Ok(_) => {
                debug!("Copied {} to worktree", env_file);
                result.copied.push(env_file.to_string());
            }
            Err(e) => {
                debug!("Failed to copy {}: {}", env_file, e);
                result.skipped.push(env_file.to_string());
            }
        }
    }

    result
}

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/// Information about a created worktree
#[derive(Debug, Clone)]
pub struct WorktreeInfo {
    pub path: PathBuf,
    pub branch: String,
}

/// Result of copying env files
#[derive(Debug, Clone)]
pub struct CopyEnvResult {
    pub copied: Vec<String>,
    pub skipped: Vec<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sanitize_branch_name() {
        assert_eq!(sanitize_branch_name("feature/foo-bar"), "feature-foo-bar");
        assert_eq!(sanitize_branch_name("Fix Bug #123"), "fix-bug-123");
        assert_eq!(sanitize_branch_name("--test--"), "test");
    }

    #[test]
    fn test_generate_branch_name() {
        let name = generate_branch_name("abc12345-6789", "session");
        assert!(name.starts_with("session/abc12345-"));
    }
}
