//! Real-time nudge command.

use anyhow::Result;
use colored::Colorize;

use crate::config::Config;
use crate::tmux;

pub async fn execute(session_id: &str, message: &str, _config: &Config) -> Result<()> {
    println!("{}", format!("Nudging {}...", session_id).cyan());

    // Send message directly to session via tmux
    // The message will appear in the terminal
    let formatted = format!("\n# NUDGE: {}\n", message);
    tmux::send_keys(session_id, &formatted, false)?;

    println!("{}", "✓ Nudge sent".green());

    Ok(())
}
