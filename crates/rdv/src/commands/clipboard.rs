use std::io::{Read, Write};

use clap::{Args, Subcommand};
use serde_json::json;

use crate::client::Client;

const CLIPBOARD_MAX_BYTES: u64 = 1024 * 1024;

#[derive(Args)]
pub struct ClipboardArgs {
    #[command(subcommand)]
    command: ClipboardCommand,
}

#[derive(Subcommand)]
enum ClipboardCommand {
    /// Copy UTF-8 text from stdin into the current session clipboard
    Copy,
    /// Paste the current session clipboard to stdout exactly
    Paste,
}

fn read_copy_input(mut input: impl Read) -> Result<String, Box<dyn std::error::Error>> {
    let mut bytes = Vec::new();
    input
        .by_ref()
        .take(CLIPBOARD_MAX_BYTES + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() as u64 > CLIPBOARD_MAX_BYTES {
        return Err("clipboard input exceeds 1048576 UTF-8 bytes".into());
    }
    Ok(String::from_utf8(bytes).map_err(|_| "clipboard input must be valid UTF-8")?)
}

pub async fn run(args: ClipboardArgs, client: &Client) -> Result<(), Box<dyn std::error::Error>> {
    let session_id = client
        .session_id()
        .ok_or("RDV_SESSION_ID is required for clipboard commands")?;

    match args.command {
        ClipboardCommand::Copy => {
            let data = read_copy_input(std::io::stdin().lock())?;
            client
                .post_json(
                    "/internal/clipboard",
                    &json!({ "sessionId": session_id, "data": data }),
                )
                .await?;
        }
        ClipboardCommand::Paste => {
            let query = [("sessionId", session_id)];
            let data = client
                .get_text_with_query("/internal/clipboard", &query)
                .await?;
            let mut output = std::io::stdout().lock();
            output.write_all(data.as_bytes())?;
            output.flush()?;
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn copy_input_preserves_exact_utf8() {
        let input = "line one\nemoji 😀\0tail";
        assert_eq!(read_copy_input(input.as_bytes()).unwrap(), input);
    }

    #[test]
    fn copy_input_rejects_invalid_utf8() {
        assert!(read_copy_input(&[0xff_u8][..]).is_err());
    }

    #[test]
    fn copy_input_rejects_more_than_one_mib() {
        let bytes = vec![b'x'; CLIPBOARD_MAX_BYTES as usize + 1];
        assert!(read_copy_input(&bytes[..]).is_err());
    }
}
