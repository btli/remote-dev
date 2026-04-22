use clap::{Args, Subcommand};
use serde::{Deserialize, Serialize};
use serde_json::json;
use tabled::{Table, Tabled};

use crate::client::Client;

#[derive(Args)]
pub struct ProjectArgs {
    #[command(subcommand)]
    command: ProjectCommand,
}

#[derive(Subcommand)]
enum ProjectCommand {
    /// List projects
    List {
        #[arg(long)]
        group_id: Option<String>,
    },
    /// Create a project inside a group
    Create {
        #[arg(long)]
        group_id: String,
        #[arg(long)]
        name: String,
    },
    /// Rename / update a project
    Update {
        id: String,
        #[arg(long)]
        name: Option<String>,
        #[arg(long)]
        collapsed: Option<bool>,
    },
    /// Move a project to a different group
    Move {
        id: String,
        #[arg(long)]
        new_group_id: String,
    },
    /// Delete a project
    Delete { id: String },
}

#[derive(Debug, Serialize, Deserialize)]
struct Project {
    id: String,
    name: String,
    #[serde(rename = "groupId")]
    group_id: String,
    #[serde(rename = "isAutoCreated", default)]
    is_auto_created: bool,
}

#[derive(Debug, Deserialize)]
struct ProjectsResponse {
    projects: Vec<Project>,
}

#[derive(Tabled)]
struct ProjectRow {
    #[tabled(rename = "ID")]
    id: String,
    #[tabled(rename = "Name")]
    name: String,
    #[tabled(rename = "Group")]
    group_id: String,
    #[tabled(rename = "Auto")]
    is_auto_created: String,
}

impl From<&Project> for ProjectRow {
    fn from(p: &Project) -> Self {
        Self {
            id: p.id.clone(),
            name: p.name.clone(),
            group_id: p.group_id.clone(),
            is_auto_created: p.is_auto_created.to_string(),
        }
    }
}

pub async fn run(
    args: ProjectArgs,
    client: &Client,
    human: bool,
) -> Result<(), Box<dyn std::error::Error>> {
    match args.command {
        ProjectCommand::List { group_id } => {
            let url = match &group_id {
                Some(g) => format!("/api/projects?groupId={g}"),
                None => "/api/projects".to_string(),
            };
            let resp: ProjectsResponse = client.get(&url).await?;
            if human {
                let rows: Vec<ProjectRow> = resp.projects.iter().map(ProjectRow::from).collect();
                println!("{}", Table::new(rows));
            } else {
                println!("{}", serde_json::to_string_pretty(&json!(resp.projects))?);
            }
        }
        ProjectCommand::Create { group_id, name } => {
            let body = json!({ "groupId": group_id, "name": name });
            let res: serde_json::Value = client.post_json("/api/projects", &body).await?;
            if human {
                let id = res
                    .get("project")
                    .and_then(|p| p.get("id"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("?");
                println!("Created project {id}");
            } else {
                println!("{}", serde_json::to_string_pretty(&res)?);
            }
        }
        ProjectCommand::Update {
            id,
            name,
            collapsed,
        } => {
            let body = json!({ "name": name, "collapsed": collapsed });
            let url = format!("/api/projects/{id}");
            let res: serde_json::Value = client.patch(&url, &body).await?;
            if human {
                println!("Updated project {id}");
            } else {
                println!("{}", serde_json::to_string_pretty(&res)?);
            }
        }
        ProjectCommand::Move { id, new_group_id } => {
            let url = format!("/api/projects/{id}/move");
            let body = json!({ "newGroupId": new_group_id });
            let res: serde_json::Value = client.post_json(&url, &body).await?;
            if human {
                println!("Moved project {id} to group {new_group_id}");
            } else {
                println!("{}", serde_json::to_string_pretty(&res)?);
            }
        }
        ProjectCommand::Delete { id } => {
            let res = client.delete(&format!("/api/projects/{id}")).await?;
            if human {
                println!("Deleted project {id}");
            } else {
                println!("{}", serde_json::to_string_pretty(&res)?);
            }
        }
    }
    Ok(())
}
