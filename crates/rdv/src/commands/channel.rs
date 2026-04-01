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
            #[derive(Deserialize)]
            struct MessagesResponse {
                messages: Vec<ChannelMessageInfo>,
            }

            #[derive(Deserialize, Serialize)]
            struct ChannelMessageInfo {
                #[serde(rename = "fromSessionName")]
                from_session_name: String,
                body: String,
                #[serde(rename = "createdAt")]
                created_at: String,
                #[serde(rename = "replyCount")]
                reply_count: u32,
            }

            let limit_str = limit.to_string();
            let resp: MessagesResponse = client
                .get_with_query(
                    "/internal/channels/messages",
                    &[
                        ("sessionId", sid),
                        ("channelName", channel.as_str()),
                        ("limit", limit_str.as_str()),
                    ],
                )
                .await?;

            if human {
                if resp.messages.is_empty() {
                    println!("No messages in #{channel}.");
                } else {
                    for msg in &resp.messages {
                        let thread = if msg.reply_count > 0 {
                            format!(" ({} replies)", msg.reply_count)
                        } else {
                            String::new()
                        };
                        println!(
                            "[{}] {}{}: {}",
                            msg.created_at, msg.from_session_name, thread, msg.body
                        );
                    }
                }
            } else {
                println!("{}", serde_json::to_string_pretty(&resp.messages)?);
            }
        }
    }

    Ok(())
}
