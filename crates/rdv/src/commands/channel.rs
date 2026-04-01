use clap::{Args, Subcommand};
use serde::{Deserialize, Serialize};
use serde_json::json;
use tabled::{Table, Tabled};

use crate::client::Client;

#[derive(Args)]
pub struct ChannelArgs {
    #[command(subcommand)]
    command: ChannelCommand,
}

#[derive(Subcommand)]
enum ChannelCommand {
    /// List channels in the current project folder
    List,
    /// Create a new channel
    Create {
        /// Channel name (lowercase, hyphens allowed)
        name: String,
        /// Optional topic/description
        #[arg(long)]
        topic: Option<String>,
    },
    /// Send a message to a specific channel
    Send {
        /// Channel name
        channel: String,
        /// Message body
        body: String,
        /// Reply to a specific message ID (for threading)
        #[arg(long)]
        reply_to: Option<String>,
    },
    /// Read messages from a channel
    Messages {
        /// Channel name
        channel: String,
        /// Number of messages (default: 20)
        #[arg(long, default_value = "20")]
        limit: u32,
    },
}

// Response types

#[derive(Debug, Serialize, Deserialize)]
struct ChannelInfo {
    id: String,
    name: String,
    #[serde(rename = "displayName")]
    display_name: String,
    #[serde(rename = "type")]
    channel_type: String,
    #[serde(rename = "messageCount")]
    message_count: u64,
    topic: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct ChannelGroup {
    id: String,
    name: String,
    channels: Vec<ChannelInfo>,
}

#[derive(Debug, Serialize, Deserialize)]
struct ChannelListResponse {
    groups: Vec<ChannelGroup>,
}

#[derive(Tabled)]
struct ChannelRow {
    #[tabled(rename = "Group")]
    group: String,
    #[tabled(rename = "Channel")]
    name: String,
    #[tabled(rename = "Type")]
    channel_type: String,
    #[tabled(rename = "Messages")]
    messages: String,
    #[tabled(rename = "Topic")]
    topic: String,
}

pub async fn run(
    args: ChannelArgs,
    client: &Client,
    human: bool,
) -> Result<(), Box<dyn std::error::Error>> {
    let sid = client
        .session_id()
        .ok_or("RDV_SESSION_ID not set — run inside an agent session")?;

    match args.command {
        ChannelCommand::List => {
            let query = [("sessionId", sid)];
            let resp: ChannelListResponse = client
                .get_with_query("/internal/channels/list", &query)
                .await?;

            if human {
                let mut rows: Vec<ChannelRow> = Vec::new();
                for group in &resp.groups {
                    for ch in &group.channels {
                        rows.push(ChannelRow {
                            group: group.name.clone(),
                            name: ch.display_name.clone(),
                            channel_type: ch.channel_type.clone(),
                            messages: ch.message_count.to_string(),
                            topic: ch.topic.clone().unwrap_or_else(|| "-".to_string()),
                        });
                    }
                }
                if rows.is_empty() {
                    println!("No channels found.");
                } else {
                    println!("{}", Table::new(rows));
                }
            } else {
                println!("{}", serde_json::to_string_pretty(&resp.groups)?);
            }
        }
        ChannelCommand::Create { name, topic } => {
            let mut payload = json!({
                "fromSessionId": sid,
                "name": name,
            });
            if let Some(t) = &topic {
                payload["topic"] = json!(t);
            }

            let result: serde_json::Value =
                client.post_json("/internal/channels/create", &payload).await?;

            if human {
                println!("Channel #{name} created.");
            } else {
                let channel_val = result.get("channel").unwrap_or(&result);
                println!("{}", serde_json::to_string_pretty(channel_val)?);
            }
        }
        ChannelCommand::Send {
            channel,
            body,
            reply_to,
        } => {
            let mut payload = json!({
                "fromSessionId": sid,
                "channelName": channel,
                "body": body,
            });
            if let Some(parent) = &reply_to {
                payload["parentMessageId"] = json!(parent);
            }

            let result: serde_json::Value =
                client.post_json("/internal/channels/send", &payload).await?;

            if human {
                println!("Message sent to #{channel}");
            } else {
                println!("{}", serde_json::to_string_pretty(&result)?);
            }
        }
        ChannelCommand::Messages { channel, limit } => {
            // First, list channels to resolve name to ID
            let query = [("sessionId", sid)];
            let list_resp: ChannelListResponse = client
                .get_with_query("/internal/channels/list", &query)
                .await?;

            let channel_id = list_resp
                .groups
                .iter()
                .flat_map(|g| &g.channels)
                .find(|c| c.name == channel)
                .map(|c| c.id.clone())
                .ok_or_else(|| format!("Channel '{}' not found", channel))?;

            // Use the API endpoint for messages
            // Since internal endpoints don't have a messages-by-channel endpoint,
            // we need to use the Next.js API. For now, return the channel info.
            // The MCP tools handle message reading; CLI users can use the MCP tools.
            let _ = limit;
            if human {
                println!("Channel #{channel} (id: {})", &channel_id[..8]);
                println!("Use 'rdv peer messages' or the MCP read_channel tool to read messages.");
            } else {
                println!("{}", json!({"channelId": channel_id, "channelName": channel}));
            }
        }
    }

    Ok(())
}
