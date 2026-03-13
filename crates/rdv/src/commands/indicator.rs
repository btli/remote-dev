use clap::Args;
use serde_json::json;

use crate::client::Client;

#[derive(Args)]
pub struct SetStatusArgs {
    /// Session ID
    session_id: String,
    /// Status key name
    key: String,
    /// Status value text
    #[arg(trailing_var_arg = true, required = true)]
    value: Vec<String>,
    /// Icon name (e.g. bolt.fill, bell.fill)
    #[arg(long)]
    icon: Option<String>,
    /// Color (e.g. #4C8DFF, green, red)
    #[arg(long)]
    color: Option<String>,
}

#[derive(Args)]
pub struct ClearStatusArgs {
    /// Session ID
    session_id: String,
    /// Status key to clear
    key: String,
}

#[derive(Args)]
pub struct SetProgressArgs {
    /// Session ID
    session_id: String,
    /// Progress value (0.0 to 1.0)
    value: f64,
    /// Optional label text
    #[arg(long)]
    label: Option<String>,
}

#[derive(Args)]
pub struct ClearProgressArgs {
    /// Session ID
    session_id: String,
}

#[derive(Args)]
pub struct LogArgs {
    /// Session ID
    session_id: String,
    /// Log message
    #[arg(trailing_var_arg = true, required = true)]
    message: Vec<String>,
    /// Log level (debug, info, warn, error)
    #[arg(long, default_value = "info")]
    level: String,
    /// Log source identifier
    #[arg(long)]
    source: Option<String>,
}

pub async fn run_set_status(args: SetStatusArgs, client: &Client) -> Result<(), Box<dyn std::error::Error>> {
    let mut body = json!({
        "sessionId": args.session_id,
        "key": args.key,
        "value": args.value.join(" "),
    });
    if let Some(icon) = args.icon {
        body["icon"] = json!(icon);
    }
    if let Some(color) = args.color {
        body["color"] = json!(color);
    }
    client.post_json("/internal/session-status", &body).await?;
    Ok(())
}

pub async fn run_clear_status(args: ClearStatusArgs, client: &Client) -> Result<(), Box<dyn std::error::Error>> {
    let body = json!({
        "sessionId": args.session_id,
        "key": args.key,
    });
    client.delete_with_body("/internal/session-status", &body).await?;
    Ok(())
}

pub async fn run_set_progress(args: SetProgressArgs, client: &Client) -> Result<(), Box<dyn std::error::Error>> {
    if !(0.0..=1.0).contains(&args.value) {
        return Err(format!("progress value must be between 0.0 and 1.0, got {}", args.value).into());
    }
    let mut body = json!({
        "sessionId": args.session_id,
        "value": args.value,
    });
    if let Some(label) = args.label {
        body["label"] = json!(label);
    }
    client.post_json("/internal/session-progress", &body).await?;
    Ok(())
}

pub async fn run_clear_progress(args: ClearProgressArgs, client: &Client) -> Result<(), Box<dyn std::error::Error>> {
    let body = json!({
        "sessionId": args.session_id,
    });
    client.delete_with_body("/internal/session-progress", &body).await?;
    Ok(())
}

pub async fn run_log(args: LogArgs, client: &Client) -> Result<(), Box<dyn std::error::Error>> {
    let mut body = json!({
        "sessionId": args.session_id,
        "message": args.message.join(" "),
        "level": args.level,
    });
    if let Some(source) = args.source {
        body["source"] = json!(source);
    }
    client.post_json("/internal/session-log", &body).await?;
    Ok(())
}
