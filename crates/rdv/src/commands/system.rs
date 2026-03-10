use clap::{Args, Subcommand};
use colored::Colorize;
use serde::Deserialize;
use serde_json::json;
use tabled::{Table, Tabled};

use crate::client::Client;

#[derive(Args)]
pub struct SystemArgs {
    #[command(subcommand)]
    command: SystemCommand,
}

#[derive(Subcommand)]
enum SystemCommand {
    /// Check for updates, view status, or apply an available update
    Update(UpdateArgs),
}

#[derive(Args)]
struct UpdateArgs {
    #[command(subcommand)]
    command: Option<UpdateCommand>,
}

#[derive(Subcommand)]
enum UpdateCommand {
    /// Check GitHub for a new release
    Check,
    /// Download and apply the available update (restarts the service)
    Apply,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateStatusResponse {
    current_version: String,
    latest_version: Option<String>,
    state: String,
    update_available: bool,
    last_checked: Option<String>,
    release_notes: Option<String>,
    published_at: Option<String>,
    error_message: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ApplyResponse {
    status: String,
    version: Option<String>,
    message: Option<String>,
}

#[derive(Tabled)]
struct StatusRow {
    #[tabled(rename = "Field")]
    field: String,
    #[tabled(rename = "Value")]
    value: String,
}

pub async fn run(
    args: SystemArgs,
    client: &Client,
    human: bool,
) -> Result<(), Box<dyn std::error::Error>> {
    match args.command {
        SystemCommand::Update(update_args) => match update_args.command {
            None => show_status(client, human).await,
            Some(UpdateCommand::Check) => check(client, human).await,
            Some(UpdateCommand::Apply) => apply(client, human).await,
        },
    }
}

async fn show_status(client: &Client, human: bool) -> Result<(), Box<dyn std::error::Error>> {
    let resp: UpdateStatusResponse = client.get("/api/system/update").await?;

    if human {
        println!("{}", "System Update Status".bold().underline());
        println!();

        let rows = build_status_rows(&resp);
        println!("{}", Table::new(rows));

        if resp.update_available {
            println!();
            println!(
                "  {} Run {} to install the update.",
                "Update available!".green().bold(),
                "rdv system update apply".cyan(),
            );
        }
    } else {
        println!("{}", serde_json::to_string_pretty(&json!({
            "currentVersion": resp.current_version,
            "latestVersion": resp.latest_version,
            "state": resp.state,
            "updateAvailable": resp.update_available,
            "lastChecked": resp.last_checked,
            "releaseNotes": resp.release_notes,
            "publishedAt": resp.published_at,
            "errorMessage": resp.error_message,
        }))?);
    }

    Ok(())
}

async fn check(client: &Client, human: bool) -> Result<(), Box<dyn std::error::Error>> {
    if human {
        println!("Checking for updates...");
    }

    let body = json!({ "action": "check" });
    let raw = client.post_json("/api/system/update", &body).await?;
    let resp: UpdateStatusResponse = serde_json::from_value(raw)?;

    if human {
        if resp.update_available {
            println!(
                "{}",
                format!(
                    "Update available: {} -> {}",
                    resp.current_version,
                    resp.latest_version.as_deref().unwrap_or("unknown")
                )
                .green()
                .bold()
            );
            if let Some(notes) = &resp.release_notes {
                println!();
                println!("{}", "Release notes:".bold());
                println!("{notes}");
            }
            println!();
            println!(
                "Run {} to install.",
                "rdv system update apply".cyan()
            );
        } else {
            println!(
                "{}",
                format!("Up to date (v{}).", resp.current_version)
                    .green()
            );
        }
    } else {
        println!("{}", serde_json::to_string_pretty(&json!({
            "currentVersion": resp.current_version,
            "latestVersion": resp.latest_version,
            "state": resp.state,
            "updateAvailable": resp.update_available,
            "lastChecked": resp.last_checked,
            "releaseNotes": resp.release_notes,
            "publishedAt": resp.published_at,
            "errorMessage": resp.error_message,
        }))?);
    }

    Ok(())
}

async fn apply(client: &Client, human: bool) -> Result<(), Box<dyn std::error::Error>> {
    if human {
        println!("Applying update...");
    }

    let body = json!({ "action": "apply" });
    let raw = client.post_json("/api/system/update", &body).await?;
    let resp: ApplyResponse = serde_json::from_value(raw)?;

    if human {
        let version = resp.version.as_deref().unwrap_or("unknown");
        let message = resp.message.as_deref().unwrap_or("Update applied.");
        println!("{}", format!("{message} (v{version})").green().bold());
        if resp.status == "restarting" {
            println!("The service will restart momentarily.");
        }
    } else {
        println!("{}", serde_json::to_string_pretty(&json!({
            "status": resp.status,
            "version": resp.version,
            "message": resp.message,
        }))?);
    }

    Ok(())
}

fn build_status_rows(resp: &UpdateStatusResponse) -> Vec<StatusRow> {
    let mut rows = vec![
        StatusRow {
            field: "Current Version".into(),
            value: format!("v{}", resp.current_version),
        },
        StatusRow {
            field: "State".into(),
            value: resp.state.clone(),
        },
    ];

    if let Some(ref latest) = resp.latest_version {
        rows.push(StatusRow {
            field: "Latest Version".into(),
            value: format!("v{latest}"),
        });
    }

    rows.push(StatusRow {
        field: "Update Available".into(),
        value: if resp.update_available {
            "yes".into()
        } else {
            "no".into()
        },
    });

    if let Some(ref checked) = resp.last_checked {
        rows.push(StatusRow {
            field: "Last Checked".into(),
            value: checked.clone(),
        });
    }

    if let Some(ref published) = resp.published_at {
        rows.push(StatusRow {
            field: "Published".into(),
            value: published.clone(),
        });
    }

    if let Some(ref err) = resp.error_message {
        rows.push(StatusRow {
            field: "Error".into(),
            value: err.clone(),
        });
    }

    rows
}
