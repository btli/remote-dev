//! `rdv delegate` — cross-instance delegation via the supervisor (epic
//! remote-dev-oyej.11).
//!
//! Dispatches an agent run to ANOTHER instance through the supervisor's
//! `/api/delegate` endpoint, optionally provisioning the target if it doesn't
//! exist yet. The supervisor base URL + token come from the environment
//! (`RDV_SUPERVISOR_URL`, `RDV_SUPERVISOR_TOKEN`) since the regular rdv client
//! is bound to the local instance's API server, not the supervisor.
//!
//!   rdv delegate --to <slug> --project-id <id> --prompt "..." [--provider X] [--provision-if-missing]

use clap::Args;
use serde_json::json;
use std::env;

#[derive(Args)]
pub struct DelegateArgs {
    /// Target instance slug to delegate to
    #[arg(long)]
    to: String,
    /// Project ID on the target instance
    #[arg(long)]
    project_id: String,
    /// The task prompt for the delegated agent run
    #[arg(long)]
    prompt: String,
    /// Agent provider (claude, codex, gemini, opencode)
    #[arg(long, default_value = "claude")]
    provider: String,
    /// Provision the target instance if it does not exist yet
    #[arg(long)]
    provision_if_missing: bool,
}

pub async fn run(args: DelegateArgs, human: bool) -> Result<(), Box<dyn std::error::Error>> {
    let base = env::var("RDV_SUPERVISOR_URL").map_err(|_| {
        "RDV_SUPERVISOR_URL is not set (the supervisor base URL, e.g. https://rdv.example.com)"
    })?;
    let token = env::var("RDV_SUPERVISOR_TOKEN").map_err(|_| {
        "RDV_SUPERVISOR_TOKEN is not set (an operator token for the supervisor API)"
    })?;

    let body = json!({
        "toSlug": args.to,
        "projectId": args.project_id,
        "prompt": args.prompt,
        "agentProvider": args.provider,
        "provisionIfMissing": args.provision_if_missing,
    });

    let url = format!("{}/api/delegate", base.trim_end_matches('/'));
    let client = reqwest::Client::new();
    let resp = client
        .post(&url)
        .bearer_auth(&token)
        .json(&body)
        .send()
        .await?;

    let status = resp.status();
    let value: serde_json::Value = resp.json().await.unwrap_or_else(|_| json!({}));

    if !status.is_success() {
        let msg = value["error"].as_str().unwrap_or("delegation failed");
        return Err(format!("delegate: {} ({})", msg, status.as_u16()).into());
    }

    if human {
        let state = value["status"].as_str().unwrap_or("dispatched");
        println!("Delegated to '{}': {}", args.to, state);
    } else {
        println!("{}", serde_json::to_string_pretty(&value)?);
    }
    Ok(())
}
