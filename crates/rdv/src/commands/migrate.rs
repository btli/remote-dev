//! `rdv migrate` — server-to-server project migration (stage 3 CLI).
//!
//! Runs on the SOURCE instance through the regular local client (unix
//! socket / TCP), so no extra environment is needed:
//!
//!   rdv migrate peers
//!   rdv migrate preview --project-id <id> [--mode full_tar]
//!   rdv migrate run --project-id <id> --peer <name-or-id> [--mode M]
//!       [--remove-source] [--no-env] [--no-agent-creds] [--ssh-keys]
//!       [--no-agent-settings] [--channel-history] [--watch[=false]]
//!   rdv migrate status <job-id>
//!
//! `run` watches by default (poll every 2s, exit non-zero on failed/aborted);
//! pass `--watch=false` to fire-and-forget. Peer names resolve client-side
//! via GET /api/peers. The size-preview endpoint ships with stage 2 — a 404
//! degrades to "preview unavailable" instead of an error.

use clap::{Args, Subcommand};
use serde::Deserialize;
use serde_json::json;
use tabled::{Table, Tabled};

use crate::client::Client;

const POLL_INTERVAL_SECS: u64 = 2;

#[derive(Args)]
pub struct MigrateArgs {
    #[command(subcommand)]
    command: MigrateCommand,
}

#[derive(Subcommand)]
enum MigrateCommand {
    /// List registered peer instances (migration destinations)
    Peers,
    /// Preview the estimated transfer size for a project
    Preview {
        /// Project to size
        #[arg(long)]
        project_id: String,
        /// Working-tree transfer mode
        #[arg(long, default_value = "full_tar", value_parser = ["full_tar", "git_essentials", "none"])]
        mode: String,
    },
    /// Start a migration job (watches it to completion by default)
    Run {
        /// Project to migrate
        #[arg(long)]
        project_id: String,
        /// Destination peer — registry name or id (see `rdv migrate peers`)
        #[arg(long)]
        peer: String,
        /// Working-tree transfer mode (server default: full_tar)
        #[arg(long, value_parser = ["full_tar", "git_essentials", "none"])]
        mode: Option<String>,
        /// Delete the source project after the destination verifies clean
        #[arg(long)]
        remove_source: bool,
        /// Exclude .env files from the working-tree transfer
        #[arg(long)]
        no_env: bool,
        /// Exclude agent credentials (stored provider API keys)
        #[arg(long)]
        no_agent_creds: bool,
        /// Include SSH keys (excluded by default)
        #[arg(long)]
        ssh_keys: bool,
        /// Exclude agent settings (MCP servers, agent configs, profile JSON)
        #[arg(long)]
        no_agent_settings: bool,
        /// Include channel/peer message history (excluded by default)
        #[arg(long)]
        channel_history: bool,
        /// Poll the job until it reaches a terminal state (default: true)
        #[arg(
            long,
            default_value_t = true,
            action = clap::ArgAction::Set,
            num_args = 0..=1,
            default_missing_value = "true"
        )]
        watch: bool,
    },
    /// Show one migration job
    Status {
        /// Migration job id
        job_id: String,
    },
}

#[derive(Debug, Deserialize)]
struct PeersResponse {
    peers: Vec<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
struct JobResponse {
    job: serde_json::Value,
}

#[derive(Tabled)]
struct PeerRow {
    #[tabled(rename = "ID")]
    id: String,
    #[tabled(rename = "Name")]
    name: String,
    #[tabled(rename = "Base URL")]
    base_url: String,
    #[tabled(rename = "Verified")]
    verified: String,
    #[tabled(rename = "Capabilities")]
    capabilities: String,
}

fn peer_row(p: &serde_json::Value) -> PeerRow {
    let capabilities = p
        .get("capabilities")
        .filter(|c| !c.is_null())
        .map(|c| {
            let version = c["version"].as_i64().unwrap_or(0);
            let app = c["appVersion"].as_str().unwrap_or("?");
            format!("v{version} ({app})")
        })
        .unwrap_or_else(|| "-".to_string());
    PeerRow {
        id: p["id"].as_str().unwrap_or("?").to_string(),
        name: p["name"].as_str().unwrap_or("?").to_string(),
        base_url: p["baseUrl"].as_str().unwrap_or("?").to_string(),
        verified: p["lastSeenAt"].as_str().unwrap_or("never").to_string(),
        capabilities,
    }
}

fn format_bytes(bytes: i64) -> String {
    if bytes < 0 {
        return "-".to_string();
    }
    if bytes < 1024 {
        return format!("{bytes} B");
    }
    let mut value = bytes as f64;
    let mut unit = "B";
    for next in ["KB", "MB", "GB", "TB"] {
        if value < 1024.0 {
            break;
        }
        value /= 1024.0;
        unit = next;
    }
    if value >= 100.0 {
        format!("{value:.0} {unit}")
    } else {
        format!("{value:.1} {unit}")
    }
}

/// Resolve `--peer` (registry name or id) to the peer's id via GET /api/peers.
async fn resolve_peer_id(
    client: &Client,
    name_or_id: &str,
) -> Result<String, Box<dyn std::error::Error>> {
    let resp: PeersResponse = client.get("/api/peers").await?;
    if let Some(peer) = resp.peers.iter().find(|p| {
        p["id"].as_str() == Some(name_or_id) || p["name"].as_str() == Some(name_or_id)
    }) {
        return Ok(peer["id"].as_str().unwrap_or(name_or_id).to_string());
    }
    let available: Vec<&str> = resp
        .peers
        .iter()
        .filter_map(|p| p["name"].as_str())
        .collect();
    Err(format!(
        "No peer named '{name_or_id}'. Registered peers: {}",
        if available.is_empty() {
            "(none — add one in Settings → Instances)".to_string()
        } else {
            available.join(", ")
        }
    )
    .into())
}

fn print_job_human(job: &serde_json::Value) {
    let status = job["status"].as_str().unwrap_or("?");
    let transferred = job["bytesTransferred"].as_i64().unwrap_or(0);
    println!("Job:         {}", job["id"].as_str().unwrap_or("?"));
    println!("Project:     {}", job["projectId"].as_str().unwrap_or("?"));
    println!("Status:      {status}");
    println!(
        "Mode:        {}",
        job["workingTreeMode"].as_str().unwrap_or("?")
    );
    match job["sizeEstimateBytes"].as_i64() {
        Some(estimate) if estimate > 0 => println!(
            "Transferred: {} of ~{}",
            format_bytes(transferred),
            format_bytes(estimate)
        ),
        _ => println!("Transferred: {}", format_bytes(transferred)),
    }
    if let Some(dest) = job["destProjectId"].as_str() {
        println!("Dest:        {dest}");
    }
    if let Some(err) = job["errorMessage"].as_str() {
        println!("Error:       {err}");
    }
}

fn is_terminal(status: &str) -> bool {
    matches!(status, "completed" | "failed" | "aborted")
}

/// Poll a job every 2s until terminal. Human mode prints a status line on
/// every change; JSON mode prints only the final job document. Returns Err
/// (non-zero exit) on `failed` and `aborted`.
async fn watch_job(
    client: &Client,
    job_id: &str,
    human: bool,
) -> Result<(), Box<dyn std::error::Error>> {
    let mut last_line = String::new();
    loop {
        let resp: JobResponse = client.get(&format!("/api/migrations/{job_id}")).await?;
        let job = resp.job;
        let status = job["status"].as_str().unwrap_or("?").to_string();
        let transferred = job["bytesTransferred"].as_i64().unwrap_or(0);

        if human {
            let line = match job["sizeEstimateBytes"].as_i64() {
                Some(estimate) if estimate > 0 => format!(
                    "status={status} transferred={} of ~{}",
                    format_bytes(transferred),
                    format_bytes(estimate)
                ),
                _ => format!("status={status} transferred={}", format_bytes(transferred)),
            };
            if line != last_line {
                println!("{line}");
                last_line = line;
            }
        }

        if is_terminal(&status) {
            match status.as_str() {
                "completed" => {
                    if human {
                        let dest = job["destProjectId"].as_str().unwrap_or("?");
                        println!("Migration completed → destination project {dest}");
                        if job["removeSourceAfterVerify"].as_bool() == Some(true) {
                            println!("Source project was removed from this instance.");
                        }
                    } else {
                        println!("{}", serde_json::to_string_pretty(&job)?);
                    }
                    return Ok(());
                }
                "aborted" => {
                    if !human {
                        println!("{}", serde_json::to_string_pretty(&job)?);
                    }
                    return Err("migration aborted".into());
                }
                _ => {
                    if !human {
                        println!("{}", serde_json::to_string_pretty(&job)?);
                    }
                    let message = job["errorMessage"]
                        .as_str()
                        .unwrap_or("migration failed")
                        .to_string();
                    return Err(format!("migration failed: {message}").into());
                }
            }
        }

        tokio::time::sleep(std::time::Duration::from_secs(POLL_INTERVAL_SECS)).await;
    }
}

pub async fn run(
    args: MigrateArgs,
    client: &Client,
    human: bool,
) -> Result<(), Box<dyn std::error::Error>> {
    match args.command {
        MigrateCommand::Peers => {
            let resp: PeersResponse = client.get("/api/peers").await?;
            if human {
                if resp.peers.is_empty() {
                    println!("No peer instances registered (Settings → Instances).");
                } else {
                    let rows: Vec<PeerRow> = resp.peers.iter().map(peer_row).collect();
                    println!("{}", Table::new(rows));
                }
            } else {
                println!("{}", serde_json::to_string_pretty(&json!(resp.peers))?);
            }
        }
        MigrateCommand::Preview { project_id, mode } => {
            let body = json!({ "projectId": project_id, "workingTreeMode": mode });
            match client.post_json("/api/migrations/size-preview", &body).await {
                Ok(res) => {
                    if human {
                        println!(
                            "Estimated transfer size ({mode}): {}",
                            format_bytes(res["totalBytes"].as_i64().unwrap_or(-1))
                        );
                        println!(
                            "  working tree:   {}",
                            format_bytes(res["workingTreeBytes"].as_i64().unwrap_or(-1))
                        );
                        println!(
                            "  profiles:       {}",
                            format_bytes(res["profilesBytes"].as_i64().unwrap_or(-1))
                        );
                        println!(
                            "  agent settings: {}",
                            format_bytes(res["agentSettingsBytes"].as_i64().unwrap_or(-1))
                        );
                        if let Some(warning) = res["warning"].as_str() {
                            println!("  warning: {warning}");
                        }
                    } else {
                        println!("{}", serde_json::to_string_pretty(&res)?);
                    }
                }
                // The endpoint ships with stage 2 — degrade gracefully on 404.
                Err(e) if e.to_string().starts_with("HTTP 404") => {
                    if human {
                        println!(
                            "Size preview unavailable (endpoint not present on this instance)."
                        );
                    } else {
                        println!("{}", serde_json::to_string_pretty(&json!({ "available": false }))?);
                    }
                }
                Err(e) => return Err(e),
            }
        }
        MigrateCommand::Run {
            project_id,
            peer,
            mode,
            remove_source,
            no_env,
            no_agent_creds,
            ssh_keys,
            no_agent_settings,
            channel_history,
            watch,
        } => {
            let peer_id = resolve_peer_id(client, &peer).await?;
            let mut options = json!({
                "includeDotEnv": !no_env,
                "includeAgentCreds": !no_agent_creds,
                "includeSshKeys": ssh_keys,
                "includeAgentSettings": !no_agent_settings,
                "includeChannelHistory": channel_history,
                "removeSourceAfterVerify": remove_source,
            });
            if let Some(mode) = mode {
                options["workingTreeMode"] = json!(mode);
            }
            let body = json!({
                "projectId": project_id,
                "peerInstanceId": peer_id,
                "options": options,
            });
            let res = client.post_json("/api/migrations", &body).await?;
            let job_id = res["jobId"]
                .as_str()
                .ok_or("migration create response had no jobId")?
                .to_string();

            if human {
                println!("Started migration job {job_id}");
            }
            if watch {
                watch_job(client, &job_id, human).await?;
            } else if !human {
                println!("{}", serde_json::to_string_pretty(&res)?);
            }
        }
        MigrateCommand::Status { job_id } => {
            let resp: JobResponse = client.get(&format!("/api/migrations/{job_id}")).await?;
            if human {
                print_job_human(&resp.job);
            } else {
                println!("{}", serde_json::to_string_pretty(&resp.job)?);
            }
        }
    }
    Ok(())
}
