use std::env;

use colored::Colorize;
use serde::Deserialize;
use serde_json::json;

use crate::client::Client;

#[derive(Debug, Deserialize)]
struct SessionContext {
    id: String,
    name: Option<String>,
    #[serde(rename = "folderId")]
    folder_id: Option<String>,
    #[serde(rename = "workingDirectory")]
    working_directory: Option<String>,
    #[serde(rename = "tmuxSessionName")]
    tmux_session_name: Option<String>,
    status: Option<String>,
    #[serde(rename = "terminalType")]
    terminal_type: Option<String>,
}

pub async fn run(client: &Client, human: bool) -> Result<(), Box<dyn std::error::Error>> {
    let sid = env::var("RDV_SESSION_ID").map_err(|_| "RDV_SESSION_ID not set")?;
    let session: SessionContext = client.get(&format!("/api/sessions/{sid}")).await?;

    if human {
        println!("{}", "Session Context".bold().underline());
        println!("  {}: {}", "ID".bold(), session.id);
        println!("  {}: {}", "Name".bold(), session.name.as_deref().unwrap_or("-"));
        println!("  {}: {}", "Status".bold(), session.status.as_deref().unwrap_or("-"));
        println!("  {}: {}", "Type".bold(), session.terminal_type.as_deref().unwrap_or("shell"));
        println!(
            "  {}: {}",
            "Folder".bold(),
            session.folder_id.as_deref().unwrap_or("-")
        );
        println!(
            "  {}: {}",
            "Directory".bold(),
            session.working_directory.as_deref().unwrap_or("-")
        );
        println!(
            "  {}: {}",
            "Tmux".bold(),
            session.tmux_session_name.as_deref().unwrap_or("-")
        );
    } else {
        let ctx = json!({
            "id": session.id,
            "name": session.name,
            "status": session.status,
            "terminalType": session.terminal_type,
            "folderId": session.folder_id,
            "workingDirectory": session.working_directory,
            "tmuxSessionName": session.tmux_session_name,
        });
        println!("{}", serde_json::to_string_pretty(&ctx)?);
    }

    Ok(())
}
