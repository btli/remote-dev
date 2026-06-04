//! `rdv crown` — best-of-N run-and-compare (epic remote-dev-oyej.5/.6).
//!
//! Drives the main-app Crown API: fan out N agents on the same prompt into N
//! worktree branches, let an LLM judge pick a winner, and auto-PR it.
//!
//!   rdv crown start --project-id <id> --count N --provider <p> --prompt "..." [--judge-model M]
//!   rdv crown status <crownRunId>
//!   rdv crown pr <crownRunId> --candidate <candidateId>   (manual override)

use clap::{Args, Subcommand};
use serde_json::json;

use crate::client::Client;

#[derive(Args)]
pub struct CrownArgs {
    #[command(subcommand)]
    command: CrownCommand,
}

#[derive(Subcommand)]
enum CrownCommand {
    /// Start a Crown best-of-N run
    Start {
        /// Project ID to run candidates in
        #[arg(long)]
        project_id: String,
        /// Number of candidate agents to fan out
        #[arg(long, default_value = "2")]
        count: u32,
        /// Agent provider (claude, codex, gemini, opencode)
        #[arg(long, default_value = "claude")]
        provider: String,
        /// The shared task prompt
        #[arg(long)]
        prompt: String,
        /// Optional judge model id (routes through the model-key proxy)
        #[arg(long)]
        judge_model: Option<String>,
        /// Optional base branch for the candidate worktrees
        #[arg(long)]
        base_branch: Option<String>,
    },
    /// Show a Crown run's status + candidates
    Status {
        /// Crown run ID
        crown_run_id: String,
    },
    /// Manually open a PR for a chosen candidate (overrides the judge)
    Pr {
        /// Crown run ID
        crown_run_id: String,
        /// Candidate ID to open the PR for
        #[arg(long)]
        candidate: String,
    },
}

pub async fn run(
    args: CrownArgs,
    client: &Client,
    human: bool,
) -> Result<(), Box<dyn std::error::Error>> {
    match args.command {
        CrownCommand::Start {
            project_id,
            count,
            provider,
            prompt,
            judge_model,
            base_branch,
        } => {
            let mut body = json!({
                "projectId": project_id,
                "count": count,
                "agentProvider": provider,
                "prompt": prompt,
            });
            if let Some(m) = judge_model {
                body["judgeModel"] = json!(m);
            }
            if let Some(b) = base_branch {
                body["baseBranch"] = json!(b);
            }

            let result: serde_json::Value = client.post_json("/api/crown", &body).await?;
            if human {
                let id = result["crownRunId"].as_str().unwrap_or("?");
                println!("Started Crown run {id} ({count} candidates)");
            } else {
                println!("{}", serde_json::to_string_pretty(&result)?);
            }
        }
        CrownCommand::Status { crown_run_id } => {
            let result: serde_json::Value =
                client.get(&format!("/api/crown/{crown_run_id}")).await?;
            if human {
                let run = &result["run"];
                let status = run["status"].as_str().unwrap_or("unknown");
                let winner = run["winnerCandidateId"].as_str().unwrap_or("-");
                let pr = run["prUrl"].as_str().unwrap_or("-");
                println!("Crown {crown_run_id}: status={status} winner={winner} pr={pr}");
                if let Some(cands) = result["candidates"].as_array() {
                    for c in cands {
                        let cid = c["id"].as_str().unwrap_or("?");
                        let branch = c["branch"].as_str().unwrap_or("-");
                        println!("  candidate {cid}  branch={branch}");
                    }
                }
            } else {
                println!("{}", serde_json::to_string_pretty(&result)?);
            }
        }
        CrownCommand::Pr {
            crown_run_id,
            candidate,
        } => {
            let body = json!({ "action": "pr", "candidateId": candidate });
            let result: serde_json::Value = client
                .post_json(&format!("/api/crown/{crown_run_id}"), &body)
                .await?;
            if human {
                let pr = result["prUrl"].as_str().unwrap_or("?");
                println!("Opened PR for candidate {candidate}: {pr}");
            } else {
                println!("{}", serde_json::to_string_pretty(&result)?);
            }
        }
    }
    Ok(())
}
