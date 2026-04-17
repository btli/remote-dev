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

fn human_url_output(action: &str, url: &str) -> String {
    format!("{action}: {url}")
}

fn human_click_output(x: f64, y: f64) -> String {
    format!("Clicked at ({}, {})", format_coord(x), format_coord(y))
}

fn human_type_output(selector: Option<&str>) -> String {
    match selector {
        Some(selector) => format!("Filled selector {selector}"),
        None => "Typed text".to_string(),
    }
}

fn human_evaluate_output(value: &serde_json::Value) -> Result<String, serde_json::Error> {
    match value {
        serde_json::Value::String(text) => Ok(text.clone()),
        serde_json::Value::Null | serde_json::Value::Bool(_) | serde_json::Value::Number(_) => {
            Ok(value.to_string())
        }
        _ => serde_json::to_string_pretty(value),
    }
}

fn human_snapshot_output(snapshot: &str) -> String {
    snapshot.to_string()
}

fn format_coord(value: f64) -> String {
    if value.fract() == 0.0 {
        format!("{}", value as i64)
    } else {
        value.to_string()
    }
}

fn url_from_result(result: &serde_json::Value) -> Option<&str> {
    result.get("url").and_then(|value| value.as_str())
}

pub async fn run(
    args: BrowserArgs,
    client: &Client,
    human: bool,
) -> Result<(), Box<dyn std::error::Error>> {
    match args.command {
        BrowserCommand::Navigate { session_id, url } => {
            let body = json!({ "url": url });
            let result: serde_json::Value = client
                .post_json(
                    &format!("/api/sessions/{session_id}/browser/navigate"),
                    &body,
                )
                .await?;
            if human {
                if let Some(url) = url_from_result(&result) {
                    println!("{}", human_url_output("Navigated", url));
                } else {
                    println!("{}", serde_json::to_string_pretty(&result)?);
                }
            } else {
                println!("{}", serde_json::to_string_pretty(&result)?);
            }
        }
        BrowserCommand::Screenshot { session_id, output } => {
            let bytes = client
                .get_bytes(&format!("/api/sessions/{session_id}/browser/screenshot"))
                .await?;
            std::fs::write(&output, &bytes)?;
            println!("Screenshot saved to {}", output.display());
        }
        BrowserCommand::Snapshot { session_id } => {
            let result = client
                .get_text(&format!("/api/sessions/{session_id}/browser/snapshot"))
                .await?;
            if human {
                println!("{}", human_snapshot_output(&result));
            } else {
                println!(
                    "{}",
                    serde_json::to_string_pretty(&json!({ "snapshot": result }))?
                );
            }
        }
        BrowserCommand::Click { session_id, x, y } => {
            let body = json!({ "x": x, "y": y });
            let result: serde_json::Value = client
                .post_json(&format!("/api/sessions/{session_id}/browser/click"), &body)
                .await?;
            if human {
                println!("{}", human_click_output(x, y));
            } else {
                println!("{}", serde_json::to_string_pretty(&result)?);
            }
        }
        BrowserCommand::Type {
            session_id,
            text,
            selector,
        } => {
            let mut body = json!({ "text": text });
            if let Some(ref sel) = selector {
                body["selector"] = json!(sel);
            }
            let result: serde_json::Value = client
                .post_json(&format!("/api/sessions/{session_id}/browser/type"), &body)
                .await?;
            if human {
                println!("{}", human_type_output(selector.as_deref()));
            } else {
                println!("{}", serde_json::to_string_pretty(&result)?);
            }
        }
        BrowserCommand::Evaluate { session_id, expr } => {
            let body = json!({ "expression": expr });
            let result: serde_json::Value = client
                .post_json(
                    &format!("/api/sessions/{session_id}/browser/evaluate"),
                    &body,
                )
                .await?;
            if human {
                if let Some(eval_result) = result.get("result") {
                    println!("{}", human_evaluate_output(eval_result)?);
                } else {
                    println!("{}", serde_json::to_string_pretty(&result)?);
                }
            } else {
                println!("{}", serde_json::to_string_pretty(&result)?);
            }
        }
        BrowserCommand::Back { session_id } => {
            let result = client
                .post_empty(&format!("/api/sessions/{session_id}/browser/back"))
                .await?;
            if human {
                if let Some(url) = url_from_result(&result) {
                    println!("{}", human_url_output("Current URL", url));
                } else {
                    println!("{}", serde_json::to_string_pretty(&result)?);
                }
            } else {
                println!("{}", serde_json::to_string_pretty(&result)?);
            }
        }
        BrowserCommand::Forward { session_id } => {
            let result = client
                .post_empty(&format!("/api/sessions/{session_id}/browser/forward"))
                .await?;
            if human {
                if let Some(url) = url_from_result(&result) {
                    println!("{}", human_url_output("Current URL", url));
                } else {
                    println!("{}", serde_json::to_string_pretty(&result)?);
                }
            } else {
                println!("{}", serde_json::to_string_pretty(&result)?);
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{
        human_click_output, human_evaluate_output, human_snapshot_output, human_type_output,
        human_url_output,
    };

    #[test]
    fn formats_url_actions_for_human_output() {
        assert_eq!(
            human_url_output("Navigated", "https://example.com"),
            "Navigated: https://example.com"
        );
    }

    #[test]
    fn formats_click_actions_for_human_output() {
        assert_eq!(human_click_output(12.5, 42.0), "Clicked at (12.5, 42)");
    }

    #[test]
    fn formats_type_actions_for_human_output() {
        assert_eq!(human_type_output(None), "Typed text");
        assert_eq!(
            human_type_output(Some("#search")),
            "Filled selector #search"
        );
    }

    #[test]
    fn formats_evaluate_results_for_human_output() {
        assert_eq!(human_evaluate_output(&json!("done")).unwrap(), "done");
        assert_eq!(human_evaluate_output(&json!(42)).unwrap(), "42");
        assert!(human_evaluate_output(&json!({ "ok": true }))
            .unwrap()
            .contains("\"ok\": true"));
    }

    #[test]
    fn formats_snapshot_for_human_output() {
        assert_eq!(
            human_snapshot_output("- document\n  - heading \"Remote Dev\""),
            "- document\n  - heading \"Remote Dev\""
        );
    }
}
