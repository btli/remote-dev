use clap::{Args, Subcommand};
use serde_json::json;
use tabled::{Table, Tabled};

use crate::client::Client;

#[derive(Args)]
pub struct WorktreeArgs {
    #[command(subcommand)]
    command: WorktreeCommand,
}

#[derive(Subcommand)]
enum WorktreeCommand {
    /// Create a new worktree
    Create {
        /// Repository path
        #[arg(long)]
        repo: String,
        /// Branch name for the worktree
        #[arg(long)]
        branch: String,
    },
    /// List worktrees for a repository
    List {
        /// Repository path
        #[arg(long)]
        repo: String,
    },
    /// Remove a worktree (directory only, no branch cleanup)
    Remove {
        /// Path to the worktree directory to remove
        #[arg(long)]
        worktree_path: String,
        /// Path to the main repository (or any path within it)
        #[arg(long)]
        project_path: String,
        /// Force removal even with uncommitted changes
        #[arg(long, default_value_t = false)]
        force: bool,
    },
    /// Full cleanup: verify merge, remove worktree, delete branches, close session.
    /// Uses RDV_SESSION_ID from environment to identify the session.
    Cleanup {
        /// Force cleanup even if branch is not merged
        #[arg(long, default_value_t = false)]
        force: bool,
    },
}

#[derive(Tabled)]
struct WorktreeRow {
    #[tabled(rename = "Branch")]
    branch: String,
    #[tabled(rename = "Path")]
    path: String,
}

pub async fn run(args: WorktreeArgs, client: &Client, human: bool) -> Result<(), Box<dyn std::error::Error>> {
    match args.command {
        WorktreeCommand::Create { repo, branch } => {
            let body = json!({
                "repoPath": repo,
                "branch": branch,
            });
            let result: serde_json::Value = client.post_json("/api/github/worktrees", &body).await?;
            println!("{}", serde_json::to_string_pretty(&result)?);
        }
        WorktreeCommand::List { repo } => {
            let body = json!({ "repoPath": repo });
            let result: serde_json::Value = client.post_json("/api/github/worktrees/check", &body).await?;
            if human {
                if let Some(worktrees) = result.as_array() {
                    let rows: Vec<WorktreeRow> = worktrees
                        .iter()
                        .map(|w| WorktreeRow {
                            branch: w["branch"].as_str().unwrap_or("").into(),
                            path: w["path"].as_str().unwrap_or("").into(),
                        })
                        .collect();
                    println!("{}", Table::new(rows));
                } else {
                    println!("{}", serde_json::to_string_pretty(&result)?);
                }
            } else {
                println!("{}", serde_json::to_string_pretty(&result)?);
            }
        }
        WorktreeCommand::Remove { worktree_path, project_path, force } => {
            let body = json!({
                "projectPath": project_path,
                "worktreePath": worktree_path,
                "force": force,
            });
            let result = client.delete_with_body("/api/github/worktrees", &body).await?;
            println!("{}", serde_json::to_string_pretty(&result)?);
        }
        WorktreeCommand::Cleanup { force } => {
            let session_id = client.session_id()
                .ok_or("RDV_SESSION_ID is not set. This command must be run from within an agent session.")?;
            // Validate session ID format (UUID) to prevent path injection
            if session_id.len() != 36
                || !session_id.chars().all(|c| c.is_ascii_hexdigit() || c == '-')
            {
                return Err("RDV_SESSION_ID is not a valid session ID".into());
            }
            let path = format!(
                "/api/sessions/{}?cleanup=true&force={}",
                session_id, force
            );
            let result: serde_json::Value = client.delete(&path).await?;
            println!("{}", serde_json::to_string_pretty(&result)?);
        }
    }
    Ok(())
}
