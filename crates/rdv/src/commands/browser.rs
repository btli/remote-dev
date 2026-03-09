use std::path::PathBuf;

use clap::{Args, Subcommand};
use serde_json::json;

use crate::client::Client;

#[derive(Args)]
pub struct BrowserArgs {
    #[command(subcommand)]
    command: BrowserCommand,
}

#[derive(Subcommand)]
enum BrowserCommand {
    /// Navigate browser session to a URL
    Navigate {
        /// Session ID
        session_id: String,
        /// URL to navigate to
        url: String,
    },
    /// Take a screenshot of the browser session
    Screenshot {
        /// Session ID
        session_id: String,
        /// Output file path (defaults to screenshot.png)
        #[arg(long, default_value = "screenshot.png")]
        output: PathBuf,
    },
    /// Get accessibility snapshot of the browser session
    Snapshot {
        /// Session ID
        session_id: String,
    },
    /// Click at coordinates in the browser session
    Click {
        /// Session ID
        session_id: String,
        /// X coordinate
        x: f64,
        /// Y coordinate
        y: f64,
    },
    /// Type text in the browser session
    Type {
        /// Session ID
        session_id: String,
        /// Text to type
        text: String,
        /// CSS selector to target
        #[arg(long)]
        selector: Option<String>,
    },
    /// Evaluate JavaScript in the browser session
    Evaluate {
        /// Session ID
        session_id: String,
        /// JavaScript expression to evaluate
        expr: String,
    },
    /// Navigate back in the browser session
    Back {
        /// Session ID
        session_id: String,
    },
    /// Navigate forward in the browser session
    Forward {
        /// Session ID
        session_id: String,
    },
}

pub async fn run(args: BrowserArgs, client: &Client, human: bool) -> Result<(), Box<dyn std::error::Error>> {
    // TODO: implement human-readable output for browser commands
    let _ = human;
    match args.command {
        BrowserCommand::Navigate { session_id, url } => {
            let body = json!({ "url": url });
            let result: serde_json::Value = client
                .post_json(&format!("/api/sessions/{session_id}/browser/navigate"), &body)
                .await?;
            println!("{}", serde_json::to_string_pretty(&result)?);
        }
        BrowserCommand::Screenshot { session_id, output } => {
            let bytes = client
                .get_bytes(&format!("/api/sessions/{session_id}/browser/screenshot"))
                .await?;
            std::fs::write(&output, &bytes)?;
            println!("Screenshot saved to {}", output.display());
        }
        BrowserCommand::Snapshot { session_id } => {
            let result: serde_json::Value = client
                .get(&format!("/api/sessions/{session_id}/browser/snapshot"))
                .await?;
            println!("{}", serde_json::to_string_pretty(&result)?);
        }
        BrowserCommand::Click { session_id, x, y } => {
            let body = json!({ "x": x, "y": y });
            let result: serde_json::Value = client
                .post_json(&format!("/api/sessions/{session_id}/browser/click"), &body)
                .await?;
            println!("{}", serde_json::to_string_pretty(&result)?);
        }
        BrowserCommand::Type {
            session_id,
            text,
            selector,
        } => {
            let mut body = json!({ "text": text });
            if let Some(sel) = selector {
                body["selector"] = json!(sel);
            }
            let result: serde_json::Value = client
                .post_json(&format!("/api/sessions/{session_id}/browser/type"), &body)
                .await?;
            println!("{}", serde_json::to_string_pretty(&result)?);
        }
        BrowserCommand::Evaluate { session_id, expr } => {
            let body = json!({ "expression": expr });
            let result: serde_json::Value = client
                .post_json(&format!("/api/sessions/{session_id}/browser/evaluate"), &body)
                .await?;
            println!("{}", serde_json::to_string_pretty(&result)?);
        }
        BrowserCommand::Back { session_id } => {
            let result = client
                .post_empty(&format!("/api/sessions/{session_id}/browser/back"))
                .await?;
            println!("{}", serde_json::to_string_pretty(&result)?);
        }
        BrowserCommand::Forward { session_id } => {
            let result = client
                .post_empty(&format!("/api/sessions/{session_id}/browser/forward"))
                .await?;
            println!("{}", serde_json::to_string_pretty(&result)?);
        }
    }
    Ok(())
}
