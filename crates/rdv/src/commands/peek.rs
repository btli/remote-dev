//! Peek at session health.

use anyhow::Result;
use colored::Colorize;

use crate::config::Config;
use crate::tmux;

pub async fn execute(session_id: &str, config: &Config) -> Result<()> {
    println!("{}", format!("Session: {}", session_id).cyan().bold());
    println!("{}", "─".repeat(50));

    // Check if session exists
    if !tmux::session_exists(session_id)? {
        println!("  Status: {}", "NOT FOUND".red());
        return Ok(());
    }

    // Get session info
    if let Some(info) = tmux::get_session_info(session_id)? {
        println!("  Status: {}", "RUNNING".green());
        println!("  Attached: {}", if info.attached { "Yes" } else { "No" });
    }

    // Get scrollback hash for health check
    let hash = tmux::scrollback_hash(session_id, config.monitoring.scrollback_lines)?;
    println!("  Scrollback hash: {}", hash);

    // Show last few lines of scrollback
    println!();
    println!("{}", "Last output:".cyan());
    println!("{}", "─".repeat(50));
    let content = tmux::capture_pane(session_id, Some(10))?;
    for line in content.lines().take(10) {
        println!("  {}", line);
    }

    Ok(())
}
