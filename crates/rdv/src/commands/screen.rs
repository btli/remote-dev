use clap::Args;

use crate::client::Client;

#[derive(Args)]
pub struct ScreenArgs {
    /// Session ID to capture screen from
    session_id: String,
}

pub async fn run(args: ScreenArgs, client: &Client, human: bool) -> Result<(), Box<dyn std::error::Error>> {
    let query = [("sessionId", args.session_id.as_str())];
    let result: serde_json::Value = client.get_with_query("/internal/screen", &query).await?;

    if human {
        let content = result
            .get("content")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        println!("{content}");
    } else {
        println!("{}", serde_json::to_string_pretty(&result)?);
    }

    Ok(())
}
