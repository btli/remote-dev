use clap::{Args, Subcommand};
use serde::{Deserialize, Serialize};
use serde_json::json;
use tabled::{Table, Tabled};

use crate::client::Client;

#[derive(Args)]
pub struct FolderArgs {
    #[command(subcommand)]
    command: FolderCommand,
}

#[derive(Subcommand)]
enum FolderCommand {
    /// List all folders
    List,
}

#[derive(Debug, Serialize, Deserialize)]
struct Folder {
    id: String,
    name: String,
    #[serde(rename = "parentId")]
    parent_id: Option<String>,
    #[serde(rename = "sortOrder")]
    sort_order: Option<i32>,
}

#[derive(Tabled)]
struct FolderRow {
    #[tabled(rename = "ID")]
    id: String,
    #[tabled(rename = "Name")]
    name: String,
    #[tabled(rename = "Parent")]
    parent_id: String,
}

impl From<&Folder> for FolderRow {
    fn from(f: &Folder) -> Self {
        Self {
            id: f.id.clone(),
            name: f.name.clone(),
            parent_id: f.parent_id.clone().unwrap_or_else(|| "(root)".into()),
        }
    }
}

pub async fn run(args: FolderArgs, client: &Client, human: bool) -> Result<(), Box<dyn std::error::Error>> {
    match args.command {
        FolderCommand::List => {
            let folders: Vec<Folder> = client.get("/api/folders").await?;
            if human {
                let rows: Vec<FolderRow> = folders.iter().map(FolderRow::from).collect();
                println!("{}", Table::new(rows));
            } else {
                println!("{}", serde_json::to_string_pretty(&json!(folders))?);
            }
        }
    }
    Ok(())
}
