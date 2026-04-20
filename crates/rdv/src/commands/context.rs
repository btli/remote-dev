use colored::Colorize;
use serde::Deserialize;
use serde_json::json;

use crate::client::Client;

#[derive(Debug, Deserialize)]
struct SessionContext {
    id: String,
    name: Option<String>,
    #[serde(rename = "projectId")]
    project_id: Option<String>,
    #[serde(rename = "projectName")]
    project_name: Option<String>,
    #[serde(rename = "groupId")]
    group_id: Option<String>,
    #[serde(rename = "groupName")]
    group_name: Option<String>,
    #[serde(rename = "folderId")]
    folder_id: Option<String>,
    #[serde(rename = "folderName")]
    folder_name: Option<String>,
    #[serde(rename = "workingDirectory")]
    working_directory: Option<String>,
    #[serde(rename = "tmuxSessionName")]
    tmux_session_name: Option<String>,
    status: Option<String>,
    #[serde(rename = "terminalType")]
    terminal_type: Option<String>,
}

pub async fn run(client: &Client, human: bool) -> Result<(), Box<dyn std::error::Error>> {
    let sid = client.session_id().ok_or("RDV_SESSION_ID not set")?;
    let session: SessionContext = client.get(&format!("/api/sessions/{sid}")).await?;

    // Fall back to folder_* fields if project_*/group_* aren't populated yet
    // (server may still be on the legacy schema during transition).
    let project_id = session.project_id.clone().or_else(|| session.folder_id.clone());
    let project_name = session.project_name.clone().or_else(|| session.folder_name.clone());

    if human {
        println!("{}", "Session Context".bold().underline());
        println!("  {}: {}", "ID".bold(), session.id);
        println!("  {}: {}", "Name".bold(), session.name.as_deref().unwrap_or("-"));
        println!("  {}: {}", "Status".bold(), session.status.as_deref().unwrap_or("-"));
        println!("  {}: {}", "Type".bold(), session.terminal_type.as_deref().unwrap_or("shell"));
        println!(
            "  {}: {}",
            "Project".bold(),
            project_id.as_deref().unwrap_or("-")
        );
        if let Some(pn) = project_name.as_deref() {
            println!("  {}: {}", "Project Name".bold(), pn);
        }
        println!(
            "  {}: {}",
            "Group".bold(),
            session.group_id.as_deref().unwrap_or("-")
        );
        if let Some(gn) = session.group_name.as_deref() {
            println!("  {}: {}", "Group Name".bold(), gn);
        }
        println!(
            "  {}: {} (deprecated)",
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
            "projectId": project_id,
            "projectName": project_name,
            "groupId": session.group_id,
            "groupName": session.group_name,
            // Legacy fields retained during transition
            "folderId": session.folder_id,
            "folderName": session.folder_name,
            "workingDirectory": session.working_directory,
            "tmuxSessionName": session.tmux_session_name,
        });
        println!("{}", serde_json::to_string_pretty(&ctx)?);
    }

    Ok(())
}
