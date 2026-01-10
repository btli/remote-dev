//! Mail system commands for inter-agent communication.
//!
//! Messages are stored as beads issues with type=message.
//! This provides persistence, searchability, and integration with the beads workflow.
//!
//! Message format in beads:
//! - title: Message subject
//! - description: Message body
//! - type: message
//! - priority: 3 (low, since messages are informational)
//! - assignee: Target recipient (master, folder:<name>, session:<id>)
//! - labels: [from:<sender>, read/unread]
//!
//! Target addresses:
//! - "master" → Master Control
//! - "folder:<name>" or "<folder-name>" → Folder Orchestrator
//! - "session:<id>" → Specific session

use anyhow::{Context, Result};
use chrono::Utc;
use colored::Colorize;
use std::process::Command;

use crate::cli::{MailAction, MailCommand};
use crate::config::Config;
use crate::error::RdvError;

/// Check if beads (bd) is available.
fn beads_available() -> bool {
    which::which("bd").is_ok()
}

/// Run a beads command and return stdout.
fn run_beads(args: &[&str]) -> Result<String> {
    let output = Command::new("bd")
        .args(args)
        .output()
        .context("Failed to execute bd command")?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(RdvError::Beads(format!("bd command failed: {}", stderr)).into())
    }
}

/// Get current sender identity.
fn get_sender() -> String {
    // Try to get from environment or use session name
    std::env::var("RDV_IDENTITY")
        .or_else(|_| std::env::var("TMUX_PANE").map(|p| format!("pane:{}", p)))
        .unwrap_or_else(|_| "rdv-cli".to_string())
}

/// Parse target address into canonical form.
fn parse_target(target: &str) -> String {
    if target == "master" {
        "master".to_string()
    } else if target.starts_with("folder:") || target.starts_with("session:") {
        target.to_string()
    } else if target.starts_with("rdv-folder-") {
        format!("folder:{}", target.strip_prefix("rdv-folder-").unwrap_or(target))
    } else if target.starts_with("rdv-") {
        format!("session:{}", target)
    } else {
        // Assume it's a folder name
        format!("folder:{}", target)
    }
}

pub async fn execute(cmd: MailCommand, _config: &Config) -> Result<()> {
    match cmd.action {
        MailAction::Inbox { unread } => inbox(unread).await,
        MailAction::Read { message_id } => read(&message_id).await,
        MailAction::Send {
            target,
            subject,
            message,
        } => send(&target, &subject, &message).await,
        MailAction::Mark { message_id } => mark(&message_id).await,
    }
}

async fn inbox(unread: bool) -> Result<()> {
    println!("{}", "Mail Inbox".cyan().bold());
    println!("{}", "─".repeat(60));

    if !beads_available() {
        println!("{}", "⚠ beads (bd) not available".yellow());
        println!("  Install beads from: https://github.com/steveyegge/beads");
        return Ok(());
    }

    let my_identity = get_sender();
    println!("  {} {}", "Receiving as:".cyan(), my_identity);
    println!();

    // List messages (beads issues with type containing "message")
    // We'll use bd list and filter for messages
    let output = run_beads(&["list", "--type=message"])?;

    if output.trim().is_empty() {
        println!("  {}", "No messages".yellow());
        return Ok(());
    }

    let mut message_count = 0;
    let mut unread_count = 0;

    for line in output.lines() {
        // Parse beads list output format: ID [priority] [type] status - title
        if line.contains("[message]") {
            let is_unread = line.contains("open") || !line.contains("closed");

            if unread && !is_unread {
                continue;
            }

            message_count += 1;
            if is_unread {
                unread_count += 1;
            }

            let status_indicator = if is_unread {
                "●".cyan()
            } else {
                "○".normal()
            };

            // Extract message ID and title
            let parts: Vec<&str> = line.split_whitespace().collect();
            if let Some(id) = parts.first() {
                let title_start = line.find(" - ").map(|i| i + 3).unwrap_or(0);
                let title = if title_start > 0 {
                    &line[title_start..]
                } else {
                    "No subject"
                };

                println!("  {} {} {}", status_indicator, id.cyan(), title);
            }
        }
    }

    println!();
    println!(
        "  {} message(s), {} unread",
        message_count,
        unread_count.to_string().cyan()
    );

    if message_count > 0 {
        println!();
        println!("  Use `rdv mail read <message-id>` to read a message");
    }

    Ok(())
}

async fn read(message_id: &str) -> Result<()> {
    if !beads_available() {
        println!("{}", "⚠ beads (bd) not available".yellow());
        return Ok(());
    }

    // Get message details
    let output = run_beads(&["show", message_id])?;

    println!("{}", format!("Message: {}", message_id).cyan().bold());
    println!("{}", "─".repeat(60));

    // Parse and display message
    let mut subject = String::new();
    let mut body = String::new();
    let mut from = String::new();
    let mut to = String::new();
    let mut in_description = false;

    for line in output.lines() {
        if let Some(title) = line.strip_prefix("Title: ") {
            subject = title.trim().to_string();
        } else if let Some(desc) = line.strip_prefix("Description: ") {
            body = desc.trim().to_string();
            in_description = true;
        } else if in_description && !line.starts_with(char::is_uppercase) {
            body.push('\n');
            body.push_str(line.trim());
        } else {
            in_description = false;
            if let Some(assignee) = line.strip_prefix("Assignee: ") {
                to = assignee.trim().to_string();
            }
            // Look for from label
            if line.contains("from:") {
                if let Some(start) = line.find("from:") {
                    let rest = &line[start + 5..];
                    from = rest
                        .split(|c: char| c.is_whitespace() || c == ',')
                        .next()
                        .unwrap_or("")
                        .to_string();
                }
            }
        }
    }

    println!("  {}: {}", "From".cyan(), from.yellow());
    println!("  {}: {}", "To".cyan(), to);
    println!("  {}: {}", "Subject".cyan(), subject.bold());
    println!();
    println!("{}", "─".repeat(60));
    println!("{}", body);
    println!("{}", "─".repeat(60));

    // Mark as read automatically
    let _ = run_beads(&["update", message_id, "--status=closed"]);
    println!();
    println!("  {} Marked as read", "✓".green());

    Ok(())
}

async fn send(target: &str, subject: &str, message: &str) -> Result<()> {
    println!("{}", "Sending message...".cyan());

    if !beads_available() {
        println!("{}", "⚠ beads (bd) not available".yellow());
        return Ok(());
    }

    let sender = get_sender();
    let recipient = parse_target(target);

    println!("  From: {}", sender.yellow());
    println!("  To: {}", recipient);
    println!("  Subject: {}", subject);

    // Create beads message
    // Format: title is subject, description is body with metadata
    let full_message = format!(
        "{}\n\n---\nFrom: {}\nTo: {}\nSent: {}",
        message,
        sender,
        recipient,
        Utc::now().format("%Y-%m-%d %H:%M:%S UTC")
    );

    match run_beads(&[
        "create",
        "--title",
        subject,
        "--type",
        "message",
        "--priority",
        "3",
        "--assignee",
        &recipient,
        "--description",
        &full_message,
    ]) {
        Ok(output) => {
            // Extract created message ID
            let id = output
                .lines()
                .find(|l| l.contains("Created") || l.starts_with("beads-"))
                .and_then(|l| {
                    l.split_whitespace()
                        .find(|w| w.starts_with("beads-"))
                        .map(|s| s.to_string())
                });

            if let Some(msg_id) = id {
                println!();
                println!("{}", "✓ Message sent".green());
                println!("  Message ID: {}", msg_id);
            } else {
                println!();
                println!("{}", "✓ Message sent".green());
            }
        }
        Err(e) => {
            println!("{}", format!("✗ Failed to send: {}", e).red());
        }
    }

    // Also try to nudge the target if it's a running session
    if recipient.starts_with("session:") {
        let session_id = recipient.strip_prefix("session:").unwrap_or(&recipient);
        if crate::tmux::session_exists(session_id).unwrap_or(false) {
            let nudge = format!("\n# NEW MESSAGE from {}: {}\n", sender, subject);
            let _ = crate::tmux::send_keys(session_id, &nudge, false);
            println!("  {} Real-time notification sent", "→".cyan());
        }
    }

    Ok(())
}

async fn mark(message_id: &str) -> Result<()> {
    println!(
        "{}",
        format!("Marking {} as read...", message_id).cyan()
    );

    if !beads_available() {
        println!("{}", "⚠ beads (bd) not available".yellow());
        return Ok(());
    }

    // Close the message (mark as read)
    match run_beads(&["close", message_id, "--reason", "Read"]) {
        Ok(_) => {
            println!("{}", "✓ Marked as read".green());
        }
        Err(e) => {
            println!("{}", format!("✗ Failed: {}", e).red());
        }
    }

    Ok(())
}
