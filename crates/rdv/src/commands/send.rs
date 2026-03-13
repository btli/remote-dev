use clap::{Args, Subcommand};
use serde_json::json;

use crate::client::Client;

#[derive(Args)]
pub struct SendArgs {
    #[command(subcommand)]
    command: SendCommand,
}

#[derive(Subcommand)]
enum SendCommand {
    /// Send text to a terminal session PTY
    Text {
        /// Session ID to send text to
        session_id: String,
        /// Text to send (joined with spaces if multiple args)
        #[arg(trailing_var_arg = true, required = true)]
        text: Vec<String>,
    },
    /// Send a keystroke to a terminal session
    Key {
        /// Session ID to send keystroke to
        session_id: String,
        /// Key name (Enter, C-c, Tab, Escape, Up, Down, etc.)
        key: String,
    },
}

pub async fn run(args: SendArgs, client: &Client) -> Result<(), Box<dyn std::error::Error>> {
    match args.command {
        SendCommand::Text { session_id, text } => {
            let body = json!({
                "sessionId": session_id,
                "text": text.join(" "),
            });
            client.post_json("/internal/pty-write", &body).await?;
        }
        SendCommand::Key { session_id, key } => {
            let body = json!({
                "sessionId": session_id,
                "key": key,
            });
            client.post_json("/internal/pty-key", &body).await?;
        }
    }
    Ok(())
}
