//! Peek at session health.
//!
//! Provides quick health inspection of a tmux session including:
//! - Session status (running/attached/dead pane)
//! - Pane process status (alive/dead/PID)
//! - Scrollback hash for stall detection
//! - Recent output preview

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
        println!("  Session: {}", "EXISTS".green());
        println!("  Attached: {}", if info.attached { "Yes" } else { "No" });
        println!("  Created: {}", info.created);
    }

    // Get detailed pane status
    let pane_status = tmux::get_pane_status(session_id)?;
    if pane_status.is_dead {
        println!("  Pane: {} (process exited)", "DEAD".red());
        println!("    Use `rdv session close {}` to clean up", session_id);
    } else {
        println!("  Pane: {}", "ALIVE".green());
        if let Some(pid) = pane_status.pid {
            println!("  PID: {}", pid);
        }
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
