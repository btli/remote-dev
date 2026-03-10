use clap::{Args, Subcommand};
use serde::{Deserialize, Serialize};
use serde_json::json;
use tabled::{Table, Tabled};

use crate::client::Client;

#[derive(Args)]
pub struct NotificationArgs {
    #[command(subcommand)]
    command: NotificationCommand,
}

#[derive(Subcommand)]
enum NotificationCommand {
    /// List notifications
    List {
        /// Show only unread notifications
        #[arg(long)]
        unread: bool,
        /// Maximum number to return
        #[arg(long)]
        limit: Option<u32>,
    },
    /// Mark notifications as read
    Read {
        /// Notification IDs to mark as read
        ids: Vec<String>,
        /// Mark all notifications as read
        #[arg(long)]
        all: bool,
    },
    /// Delete notifications
    Delete {
        /// Notification IDs to delete
        ids: Vec<String>,
        /// Delete all notifications
        #[arg(long)]
        all: bool,
    },
}

#[derive(Debug, Serialize, Deserialize)]
struct Notification {
    id: String,
    title: Option<String>,
    message: Option<String>,
    #[serde(rename = "type")]
    notification_type: Option<String>,
    read: Option<bool>,
    #[serde(rename = "createdAt")]
    created_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct NotificationListResponse {
    notifications: Vec<Notification>,
    #[serde(rename = "unreadCount")]
    unread_count: Option<u32>,
}

#[derive(Tabled)]
struct NotificationRow {
    #[tabled(rename = "ID")]
    id: String,
    #[tabled(rename = "Type")]
    notification_type: String,
    #[tabled(rename = "Title")]
    title: String,
    #[tabled(rename = "Read")]
    read: String,
    #[tabled(rename = "Created")]
    created_at: String,
}

impl From<&Notification> for NotificationRow {
    fn from(n: &Notification) -> Self {
        Self {
            id: n.id.clone(),
            notification_type: n.notification_type.clone().unwrap_or_default(),
            title: n.title.clone().unwrap_or_default(),
            read: if n.read.unwrap_or(false) { "yes".into() } else { "no".into() },
            created_at: n.created_at.clone().unwrap_or_default(),
        }
    }
}

/// Build a JSON body from explicit IDs or the `--all` flag, validating that
/// at least one is provided.
fn ids_or_all_body(ids: Vec<String>, all: bool) -> Result<serde_json::Value, Box<dyn std::error::Error>> {
    if all {
        Ok(json!({ "all": true }))
    } else if ids.is_empty() {
        Err("provide notification IDs or --all".into())
    } else {
        Ok(json!({ "ids": ids }))
    }
}

pub async fn run(args: NotificationArgs, client: &Client, human: bool) -> Result<(), Box<dyn std::error::Error>> {
    match args.command {
        NotificationCommand::List { unread, limit } => {
            let mut query: Vec<(&str, String)> = Vec::new();
            if unread {
                query.push(("unreadOnly", "true".into()));
            }
            if let Some(n) = limit {
                query.push(("limit", n.to_string()));
            }
            let resp: NotificationListResponse = client
                .get_with_query("/api/notifications", &query)
                .await?;
            if human {
                let rows: Vec<NotificationRow> = resp.notifications.iter().map(NotificationRow::from).collect();
                if let Some(count) = resp.unread_count {
                    println!("Unread: {count}");
                }
                println!("{}", Table::new(rows));
            } else {
                println!("{}", serde_json::to_string_pretty(&json!({
                    "notifications": resp.notifications,
                    "unreadCount": resp.unread_count,
                }))?);
            }
        }
        NotificationCommand::Read { ids, all } => {
            let body = ids_or_all_body(ids, all)?;
            let result: serde_json::Value = client.patch("/api/notifications", &body).await?;
            println!("{}", serde_json::to_string_pretty(&result)?);
        }
        NotificationCommand::Delete { ids, all } => {
            let body = ids_or_all_body(ids, all)?;
            let result = client.delete_with_body("/api/notifications", &body).await?;
            println!("{}", serde_json::to_string_pretty(&result)?);
        }
    }
    Ok(())
}
