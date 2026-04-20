use clap::{Args, Subcommand};
use serde::{Deserialize, Serialize};
use serde_json::json;
use tabled::{Table, Tabled};

use crate::client::Client;

#[derive(Args)]
pub struct GroupArgs {
    #[command(subcommand)]
    command: GroupCommand,
}

#[derive(Subcommand)]
enum GroupCommand {
    /// List groups
    List,
    /// Create a group
    Create {
        #[arg(long)]
        name: String,
        #[arg(long)]
        parent_group_id: Option<String>,
    },
    /// Rename / update a group
    Update {
        id: String,
        #[arg(long)]
        name: Option<String>,
        #[arg(long)]
        collapsed: Option<bool>,
    },
    /// Move group under a new parent
    Move {
        id: String,
        #[arg(long)]
        new_parent_group_id: Option<String>,
    },
    /// Delete a group
    Delete {
        id: String,
        #[arg(long)]
        force: bool,
    },
}

#[derive(Debug, Serialize, Deserialize)]
struct Group {
    id: String,
    name: String,
    #[serde(rename = "parentGroupId")]
    parent_group_id: Option<String>,
    #[serde(rename = "sortOrder")]
    sort_order: Option<i32>,
    #[serde(default)]
    collapsed: Option<bool>,
}

#[derive(Debug, Deserialize)]
struct GroupsResponse {
    groups: Vec<Group>,
}

#[derive(Tabled)]
struct GroupRow {
    #[tabled(rename = "ID")]
    id: String,
    #[tabled(rename = "Name")]
    name: String,
    #[tabled(rename = "Parent")]
    parent_group_id: String,
}

impl From<&Group> for GroupRow {
    fn from(g: &Group) -> Self {
        Self {
            id: g.id.clone(),
            name: g.name.clone(),
            parent_group_id: g.parent_group_id.clone().unwrap_or_else(|| "(root)".into()),
        }
    }
}

pub async fn run(
    args: GroupArgs,
    client: &Client,
    human: bool,
) -> Result<(), Box<dyn std::error::Error>> {
    match args.command {
        GroupCommand::List => {
            let resp: GroupsResponse = client.get("/api/groups").await?;
            if human {
                let rows: Vec<GroupRow> = resp.groups.iter().map(GroupRow::from).collect();
                println!("{}", Table::new(rows));
            } else {
                println!("{}", serde_json::to_string_pretty(&json!(resp.groups))?);
            }
        }
        GroupCommand::Create {
            name,
            parent_group_id,
        } => {
            let body = json!({
                "name": name,
                "parentGroupId": parent_group_id,
            });
            let res: serde_json::Value = client.post_json("/api/groups", &body).await?;
            if human {
                let id = res
                    .get("group")
                    .and_then(|g| g.get("id"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("?");
                println!("Created group {id}");
            } else {
                println!("{}", serde_json::to_string_pretty(&res)?);
            }
        }
        GroupCommand::Update {
            id,
            name,
            collapsed,
        } => {
            let body = json!({ "name": name, "collapsed": collapsed });
            let url = format!("/api/groups/{id}");
            let res: serde_json::Value = client.patch(&url, &body).await?;
            if human {
                println!("Updated group {id}");
            } else {
                println!("{}", serde_json::to_string_pretty(&res)?);
            }
        }
        GroupCommand::Move {
            id,
            new_parent_group_id,
        } => {
            let url = format!("/api/groups/{id}/move");
            let body = json!({ "newParentGroupId": new_parent_group_id });
            let res: serde_json::Value = client.post_json(&url, &body).await?;
            if human {
                println!("Moved group {id}");
            } else {
                println!("{}", serde_json::to_string_pretty(&res)?);
            }
        }
        GroupCommand::Delete { id, force } => {
            let url = if force {
                format!("/api/groups/{id}?force=true")
            } else {
                format!("/api/groups/{id}")
            };
            let res = client.delete(&url).await?;
            if human {
                println!("Deleted group {id}");
            } else {
                println!("{}", serde_json::to_string_pretty(&res)?);
            }
        }
    }
    Ok(())
}
