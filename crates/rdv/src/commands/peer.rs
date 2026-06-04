use clap::{Args, Subcommand};
use serde::{Deserialize, Serialize};
use serde_json::json;
use tabled::{Table, Tabled};

use crate::client::Client;

#[derive(Args)]
pub struct PeerArgs {
    #[command(subcommand)]
    command: PeerCommand,
}

#[derive(Subcommand)]
enum PeerCommand {
    /// List peer agents in the same project folder
    List,
    /// Send a message to peers
    Send {
        /// Message body
        body: String,
        /// Target session ID (omit to broadcast)
        #[arg(long)]
        to: Option<String>,
    },
    /// Check for new messages from peers
    Messages {
        /// ISO timestamp to poll from (default: epoch)
        #[arg(long)]
        since: Option<String>,
    },
    /// Set your work summary visible to peers
    Summary {
        /// 1-2 sentence summary of current work
        text: String,
    },
    /// Broadcast a gotcha / heads-up / progress note to project peers (#agents)
    Note {
        /// Note body
        body: String,
        /// Kind of note (default: gotcha)
        #[arg(long, value_parser = ["gotcha", "heads-up", "progress"], default_value = "gotcha")]
        kind: String,
    },
}

#[derive(Debug, Serialize, Deserialize)]
struct Peer {
    #[serde(rename = "sessionId")]
    session_id: String,
    name: String,
    #[serde(rename = "agentProvider")]
    agent_provider: Option<String>,
    #[serde(rename = "agentActivityStatus")]
    agent_activity_status: Option<String>,
    #[serde(rename = "peerSummary")]
    peer_summary: Option<String>,
    #[serde(rename = "claudeSessionId")]
    claude_session_id: Option<String>,
    #[serde(rename = "isConnected")]
    is_connected: bool,
}

#[derive(Debug, Serialize, Deserialize)]
struct PeerListResponse {
    peers: Vec<Peer>,
}

#[derive(Debug, Serialize, Deserialize)]
struct PeerMessage {
    id: String,
    #[serde(rename = "fromSessionId")]
    from_session_id: Option<String>,
    #[serde(rename = "fromSessionName")]
    from_session_name: String,
    #[serde(rename = "toSessionId")]
    to_session_id: Option<String>,
    body: String,
    #[serde(rename = "createdAt")]
    created_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct MessageListResponse {
    messages: Vec<PeerMessage>,
}

#[derive(Tabled)]
struct PeerRow {
    #[tabled(rename = "Session ID")]
    session_id: String,
    #[tabled(rename = "Name")]
    name: String,
    #[tabled(rename = "Provider")]
    provider: String,
    #[tabled(rename = "Status")]
    status: String,
    #[tabled(rename = "Summary")]
    summary: String,
}

impl From<&Peer> for PeerRow {
    fn from(p: &Peer) -> Self {
        let connected = if p.is_connected { "" } else { " (disconnected)" };
        Self {
            session_id: p.session_id[..8].to_string(),
            name: p.name.clone(),
            provider: p.agent_provider.clone().unwrap_or_default(),
            status: format!(
                "{}{}",
                p.agent_activity_status.clone().unwrap_or_default(),
                connected
            ),
            summary: p
                .peer_summary
                .clone()
                .unwrap_or_else(|| "-".to_string()),
        }
    }
}

#[derive(Tabled)]
struct MessageRow {
    #[tabled(rename = "From")]
    from: String,
    #[tabled(rename = "Type")]
    msg_type: String,
    #[tabled(rename = "Message")]
    body: String,
    #[tabled(rename = "Time")]
    time: String,
}

impl From<&PeerMessage> for MessageRow {
    fn from(m: &PeerMessage) -> Self {
        Self {
            from: m.from_session_name.clone(),
            msg_type: if m.to_session_id.is_some() {
                "direct".into()
            } else {
                "broadcast".into()
            },
            body: if m.body.chars().count() > 80 {
                let truncated: String = m.body.chars().take(77).collect();
                format!("{truncated}...")
            } else {
                m.body.clone()
            },
            time: m.created_at.clone(),
        }
    }
}

pub async fn run(
    args: PeerArgs,
    client: &Client,
    human: bool,
) -> Result<(), Box<dyn std::error::Error>> {
    let sid = client
        .session_id()
        .ok_or("RDV_SESSION_ID not set — run inside an agent session")?;

    // Optional project scope from env (server falls back to session's project
    // if unset). During transition the server accepts either.
    let project_id = std::env::var("RDV_PROJECT_ID").ok();

    match args.command {
        PeerCommand::List => {
            let mut query: Vec<(&str, &str)> = vec![("sessionId", sid)];
            if let Some(pid) = project_id.as_deref() {
                query.push(("projectId", pid));
            }
            let resp: PeerListResponse = client
                .get_with_query("/internal/peers/list", &query)
                .await?;

            if human {
                if resp.peers.is_empty() {
                    println!("No peers in this project folder.");
                } else {
                    let rows: Vec<PeerRow> = resp.peers.iter().map(PeerRow::from).collect();
                    println!("{}", Table::new(rows));
                }
            } else {
                println!("{}", serde_json::to_string_pretty(&resp.peers)?);
            }
        }
        PeerCommand::Send { body, to } => {
            let payload = json!({
                "fromSessionId": sid,
                "toSessionId": to,
                "projectId": project_id,
                "body": body,
            });
            let result: serde_json::Value =
                client.post_json("/internal/peers/messages/send", &payload).await?;

            if human {
                let target = to
                    .as_deref()
                    .unwrap_or("all peers");
                println!("Message sent to {target}");
            } else {
                println!("{}", serde_json::to_string_pretty(&result)?);
            }
        }
        PeerCommand::Messages { since } => {
            // [x386.4] When no explicit `--since` is given, use the DURABLE
            // delivery cursor (cursor=durable) so repeated calls don't re-show
            // the same messages and non-MCP providers reach exactly-once parity
            // with the MCP push path. We ack the returned batch afterwards. An
            // explicit `--since` keeps the legacy timestamp scan for ad-hoc
            // human queries.
            let use_durable = since.is_none();
            let since_str = since.unwrap_or_else(|| "1970-01-01T00:00:00Z".to_string());
            let mut query: Vec<(&str, &str)> = vec![("sessionId", sid)];
            if use_durable {
                query.push(("cursor", "durable"));
            } else {
                query.push(("since", since_str.as_str()));
            }
            if let Some(pid) = project_id.as_deref() {
                query.push(("projectId", pid));
            }
            let resp: MessageListResponse = client
                .get_with_query("/internal/peers/messages/poll", &query)
                .await?;

            // Ack the durable batch so the next poll doesn't re-surface them.
            if use_durable && !resp.messages.is_empty() {
                let ids: Vec<&str> = resp.messages.iter().map(|m| m.id.as_str()).collect();
                let ack = json!({ "sessionId": sid, "messageIds": ids });
                let _ = client.post_json("/internal/peers/ack-batch", &ack).await;
            }

            if human {
                if resp.messages.is_empty() {
                    println!("No messages.");
                } else {
                    let rows: Vec<MessageRow> =
                        resp.messages.iter().map(MessageRow::from).collect();
                    println!("{}", Table::new(rows));
                }
            } else {
                println!("{}", serde_json::to_string_pretty(&resp.messages)?);
            }
        }
        PeerCommand::Summary { text } => {
            let payload = json!({
                "sessionId": sid,
                "projectId": project_id,
                "summary": text,
            });
            client
                .post_json("/internal/peers/summary", &payload)
                .await?;

            if human {
                println!("Summary updated.");
            } else {
                println!("{}", json!({ "ok": true }));
            }
        }
        PeerCommand::Note { body, kind } => {
            // [x386.13] Post a typed note to the project's #agents channel. The
            // `[kind]` prefix lets the start digest's gotcha filter surface it
            // distinctly from regular chatter. Reuses the durable channel-send
            // → delivery path (no new server table).
            let tagged = format!("[{kind}] {body}");
            let payload = json!({
                "fromSessionId": sid,
                "channelName": "agents",
                "body": tagged,
            });
            client
                .post_json("/internal/channels/send", &payload)
                .await?;

            if human {
                println!("Note posted to #agents ({kind}).");
            } else {
                println!("{}", json!({ "ok": true, "kind": kind }));
            }
        }
    }

    Ok(())
}
