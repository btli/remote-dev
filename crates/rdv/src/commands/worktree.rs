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
    /// Remove a worktree
    Remove {
        /// Repository path
        #[arg(long)]
        repo: String,
        /// Branch name of the worktree to remove
        #[arg(long)]
        branch: String,
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
        WorktreeCommand::Remove { repo, branch } => {
            let body = json!({
                "repoPath": repo,
                "branch": branch,
            });
            let result = client.delete_with_body("/api/github/worktrees", &body).await?;
            println!("{}", serde_json::to_string_pretty(&result)?);
        }
    }
    Ok(())
}
