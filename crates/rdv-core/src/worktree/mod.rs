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
use tracing::{debug, info, warn};

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

/// Get the current branch name of a git repository
pub fn get_current_branch(path: &Path) -> Result<Option<String>> {
    let output = Command::new("git")
        .args(["-C", &path.to_string_lossy(), "rev-parse", "--abbrev-ref", "HEAD"])
        .output()?;

    if output.status.success() {
        let branch = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if branch.is_empty() || branch == "HEAD" {
            Ok(None) // Detached HEAD state
        } else {
            Ok(Some(branch))
        }
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

/// Find the main repository path from a worktree path.
///
/// Git worktrees have a `.git` FILE (not directory) that points to the main repo.
/// Returns the main repo path if this is a worktree, or None if it's the main repo.
pub fn find_main_repo_from_worktree(worktree_path: &Path) -> Result<Option<PathBuf>> {
    let git_path = worktree_path.join(".git");

    // If .git is a directory, this is the main repo
    if git_path.is_dir() {
        return Ok(None);
    }

    // If .git is a file, it's a worktree - read it to find main repo
    if git_path.is_file() {
        let content = fs::read_to_string(&git_path)?;
        // Format: "gitdir: /path/to/main-repo/.git/worktrees/branch-name"
        if let Some(gitdir) = content.strip_prefix("gitdir:") {
            let gitdir = gitdir.trim();
            // Navigate up from .git/worktrees/name to .git to main repo
            let gitdir_path = PathBuf::from(gitdir);
            if let Some(git_dir) = gitdir_path
                .parent() // worktrees
                .and_then(|p| p.parent()) // .git
                .and_then(|p| p.parent())
            // main repo
            {
                return Ok(Some(git_dir.to_path_buf()));
            }
        }
    }

    Ok(None)
}

/// List all worktrees for a repository
pub fn list_worktrees(repo_path: &Path) -> Result<Vec<WorktreeListEntry>> {
    let output = Command::new("git")
        .args([
            "-C",
            &repo_path.to_string_lossy(),
            "worktree",
            "list",
            "--porcelain",
        ])
        .output()?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(Error::Worktree(format!(
            "Failed to list worktrees: {}",
            stderr
        )));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut entries = Vec::new();
    let mut current_entry: Option<WorktreeListEntry> = None;

    for line in stdout.lines() {
        if line.starts_with("worktree ") {
            // Save previous entry if any
            if let Some(entry) = current_entry.take() {
                entries.push(entry);
            }
            // Start new entry
            current_entry = Some(WorktreeListEntry {
                path: PathBuf::from(line.strip_prefix("worktree ").unwrap_or("")),
                branch: None,
                is_bare: false,
                is_detached: false,
            });
        } else if let Some(ref mut entry) = current_entry {
            if line.starts_with("branch ") {
                let branch = line
                    .strip_prefix("branch refs/heads/")
                    .unwrap_or(line.strip_prefix("branch ").unwrap_or(""));
                entry.branch = Some(branch.to_string());
            } else if line == "bare" {
                entry.is_bare = true;
            } else if line == "detached" {
                entry.is_detached = true;
            }
        }
    }

    // Don't forget the last entry
    if let Some(entry) = current_entry {
        entries.push(entry);
    }

    Ok(entries)
}

/// Remove a git worktree.
///
/// This properly unregisters the worktree from git and optionally removes the directory.
/// Unlike just deleting the directory, this maintains git's worktree bookkeeping.
///
/// # Arguments
/// * `worktree_path` - Path to the worktree to remove
/// * `force` - If true, removes even with uncommitted changes
///
/// # Returns
/// * `Ok(WorktreeRemoveResult)` - Result with details about what was removed
/// * `Err` - If worktree removal fails
pub fn remove_worktree(worktree_path: &Path, force: bool) -> Result<WorktreeRemoveResult> {
    // Check if path exists
    if !worktree_path.exists() {
        return Ok(WorktreeRemoveResult {
            path: worktree_path.to_path_buf(),
            branch: None,
            was_removed: false,
            directory_deleted: false,
        });
    }

    // Find the main repo to run git commands from
    let main_repo = find_main_repo_from_worktree(worktree_path)?;
    let repo_path = main_repo.as_deref().unwrap_or(worktree_path);

    // Get branch name before removal (for logging)
    let branch = get_current_branch(worktree_path)?;

    // Build remove command
    let mut args = vec![
        "-C".to_string(),
        repo_path.to_string_lossy().to_string(),
        "worktree".to_string(),
        "remove".to_string(),
    ];

    if force {
        args.push("--force".to_string());
    }

    args.push(worktree_path.to_string_lossy().to_string());

    let output = Command::new("git").args(&args).output()?;

    if output.status.success() {
        info!(
            "Removed worktree at {:?} (branch: {:?})",
            worktree_path, branch
        );
        return Ok(WorktreeRemoveResult {
            path: worktree_path.to_path_buf(),
            branch,
            was_removed: true,
            directory_deleted: true,
        });
    }

    let stderr = String::from_utf8_lossy(&output.stderr);

    // Handle case where worktree is not registered but directory exists
    if stderr.contains("is not a working tree") {
        // Just delete the directory since it's not a proper worktree
        if worktree_path.exists() {
            warn!(
                "Path {:?} is not a registered worktree, removing directory only",
                worktree_path
            );
            fs::remove_dir_all(worktree_path)?;
            return Ok(WorktreeRemoveResult {
                path: worktree_path.to_path_buf(),
                branch,
                was_removed: false,
                directory_deleted: true,
            });
        }
    }

    // Handle uncommitted changes
    if stderr.contains("contains modified or untracked files") && !force {
        return Err(Error::Worktree(format!(
            "Worktree has uncommitted changes. Use force=true to remove anyway: {}",
            stderr
        )));
    }

    Err(Error::Worktree(stderr.to_string()))
}

/// Delete a branch from a repository.
///
/// # Arguments
/// * `repo_path` - Path to the git repository
/// * `branch` - Name of the branch to delete
/// * `force` - If true, deletes even if not fully merged
///
/// # Returns
/// * `Ok(true)` - Branch was deleted
/// * `Ok(false)` - Branch did not exist
/// * `Err` - If deletion fails for other reasons
pub fn delete_branch(repo_path: &Path, branch: &str, force: bool) -> Result<bool> {
    let flag = if force { "-D" } else { "-d" };

    let output = Command::new("git")
        .args(["-C", &repo_path.to_string_lossy(), "branch", flag, branch])
        .output()?;

    if output.status.success() {
        info!("Deleted branch {} from {:?}", branch, repo_path);
        return Ok(true);
    }

    let stderr = String::from_utf8_lossy(&output.stderr);

    // Branch doesn't exist
    if stderr.contains("not found") || stderr.contains("error: branch") {
        debug!("Branch {} not found in {:?}", branch, repo_path);
        return Ok(false);
    }

    // Not fully merged (and force=false)
    if stderr.contains("not fully merged") {
        return Err(Error::Worktree(format!(
            "Branch {} is not fully merged. Use force=true to delete anyway",
            branch
        )));
    }

    Err(Error::Worktree(stderr.to_string()))
}

/// Prune stale worktree entries from git.
///
/// Cleans up worktree metadata for worktrees that were deleted without using `git worktree remove`.
pub fn prune_worktrees(repo_path: &Path) -> Result<()> {
    let output = Command::new("git")
        .args(["-C", &repo_path.to_string_lossy(), "worktree", "prune"])
        .output()?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(Error::Worktree(format!(
            "Failed to prune worktrees: {}",
            stderr
        )));
    }

    debug!("Pruned stale worktree entries for {:?}", repo_path);
    Ok(())
}

/// Full worktree cleanup: remove worktree and optionally delete branch.
///
/// This is the recommended method for session cleanup.
///
/// # Arguments
/// * `worktree_path` - Path to the worktree
/// * `delete_branch_after` - If true, also deletes the branch after removing worktree
/// * `force` - If true, forces removal even with uncommitted changes
pub fn cleanup_worktree(
    worktree_path: &Path,
    delete_branch_after: bool,
    force: bool,
) -> Result<WorktreeCleanupResult> {
    // Find main repo first (needed for branch deletion)
    let main_repo = find_main_repo_from_worktree(worktree_path)?;

    // Get branch name before removal
    let branch = get_current_branch(worktree_path)?;

    // Remove the worktree
    let remove_result = remove_worktree(worktree_path, force)?;

    // Optionally delete the branch
    let branch_deleted = if delete_branch_after && remove_result.was_removed {
        if let (Some(repo), Some(branch_name)) = (main_repo.as_ref(), &branch) {
            match delete_branch(repo, branch_name, force) {
                Ok(deleted) => deleted,
                Err(e) => {
                    warn!("Failed to delete branch {}: {}", branch_name, e);
                    false
                }
            }
        } else {
            false
        }
    } else {
        false
    };

    // Prune any stale entries
    if let Some(ref repo) = main_repo {
        let _ = prune_worktrees(repo);
    }

    Ok(WorktreeCleanupResult {
        worktree_path: worktree_path.to_path_buf(),
        main_repo_path: main_repo,
        branch,
        worktree_removed: remove_result.was_removed,
        directory_deleted: remove_result.directory_deleted,
        branch_deleted,
    })
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

/// Entry from `git worktree list`
#[derive(Debug, Clone)]
pub struct WorktreeListEntry {
    pub path: PathBuf,
    pub branch: Option<String>,
    pub is_bare: bool,
    pub is_detached: bool,
}

/// Result of removing a worktree
#[derive(Debug, Clone)]
pub struct WorktreeRemoveResult {
    pub path: PathBuf,
    pub branch: Option<String>,
    /// Whether the worktree was properly removed from git
    pub was_removed: bool,
    /// Whether the directory was deleted
    pub directory_deleted: bool,
}

/// Result of full worktree cleanup
#[derive(Debug, Clone)]
pub struct WorktreeCleanupResult {
    pub worktree_path: PathBuf,
    pub main_repo_path: Option<PathBuf>,
    pub branch: Option<String>,
    pub worktree_removed: bool,
    pub directory_deleted: bool,
    pub branch_deleted: bool,
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
