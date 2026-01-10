//! Escalation command.
//!
//! Escalations are high-priority messages to Master Control for:
//! - Critical issues requiring human intervention
//! - Blocked work needing supervisor decision
//! - Security concerns or anomalies
//! - Resource conflicts between agents
//!
//! Escalations are stored as beads issues with type=escalation.
//! They automatically:
//! - Notify Master Control session (real-time nudge if running)
//! - Link to related issues
//! - Set priority based on severity
//!
//! Severity levels (map to beads priorities):
//! - CRITICAL → P0 (immediate attention)
//! - HIGH → P1 (urgent)
//! - MEDIUM → P2 (normal)
//! - LOW → P3 (informational)

use anyhow::{Context, Result};
use chrono::Utc;
use colored::Colorize;
use std::process::Command;

use crate::cli::EscalateCommand;
use crate::config::Config;
use crate::error::RdvError;
use crate::tmux;

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
    std::env::var("RDV_IDENTITY")
        .or_else(|_| std::env::var("TMUX_PANE").map(|p| format!("pane:{}", p)))
        .unwrap_or_else(|_| "rdv-cli".to_string())
}

/// Map severity to beads priority.
fn severity_to_priority(severity: &str) -> &'static str {
    match severity.to_uppercase().as_str() {
        "CRITICAL" => "0",
        "HIGH" => "1",
        "MEDIUM" => "2",
        "LOW" => "3",
        _ => "2", // Default to medium
    }
}

pub async fn execute(cmd: EscalateCommand, config: &Config) -> Result<()> {
    let severity_upper = cmd.severity.to_uppercase();
    let severity_color = match severity_upper.as_str() {
        "CRITICAL" => severity_upper.red().bold(),
        "HIGH" => severity_upper.red(),
        "MEDIUM" => severity_upper.yellow(),
        _ => severity_upper.normal(),
    };

    println!("{}", "╔══════════════════════════════════════════════════════════╗".red());
    println!("{}", "║              ESCALATION TO MASTER CONTROL                ║".red().bold());
    println!("{}", "╚══════════════════════════════════════════════════════════╝".red());
    println!();
    println!("  {} {}", "Severity:".cyan(), severity_color);
    println!("  {} {}", "Topic:".cyan(), cmd.topic);

    if let Some(ref msg) = cmd.message {
        println!("  {} {}", "Message:".cyan(), msg);
    }

    if let Some(ref issue) = cmd.issue {
        println!("  {} {}", "Related Issue:".cyan(), issue);
    }

    let sender = get_sender();
    println!("  {} {}", "From:".cyan(), sender.yellow());

    if !beads_available() {
        println!();
        println!("{}", "⚠ beads (bd) not available".yellow());
        println!("  Escalation recorded locally only");

        // Still try to nudge Master Control if running
        notify_master_control(&cmd, &sender, config);
        return Ok(());
    }

    // Build escalation description
    let mut description = format!(
        "**Escalation Report**\n\n\
        Severity: {}\n\
        From: {}\n\
        Time: {}\n",
        severity_upper,
        sender,
        Utc::now().format("%Y-%m-%d %H:%M:%S UTC")
    );

    if let Some(ref msg) = cmd.message {
        description.push_str(&format!("\n**Details:**\n{}\n", msg));
    }

    if let Some(ref issue) = cmd.issue {
        description.push_str(&format!("\n**Related Issue:** {}\n", issue));
    }

    // Add context about the escalation
    description.push_str("\n**Action Required:**\n");
    description.push_str("- Review the escalation details\n");
    description.push_str("- Assess impact and priority\n");
    description.push_str("- Provide guidance or take action\n");

    // Create beads escalation
    let priority = severity_to_priority(&cmd.severity);

    println!();
    println!("{}", "Creating escalation in beads...".cyan());

    let bd_args = vec![
        "create",
        "--title",
        &cmd.topic,
        "--type",
        "escalation",
        "--priority",
        priority,
        "--assignee",
        "master",
        "--description",
        &description,
    ];

    match run_beads(&bd_args) {
        Ok(output) => {
            // Extract created escalation ID
            let escalation_id = output
                .lines()
                .find(|l| l.contains("Created") || l.starts_with("beads-"))
                .and_then(|l| {
                    l.split_whitespace()
                        .find(|w| w.starts_with("beads-"))
                        .map(|s| s.to_string())
                });

            if let Some(ref esc_id) = escalation_id {
                println!("  {} Created: {}", "✓".green(), esc_id);

                // Link to related issue if provided
                if let Some(ref issue) = cmd.issue {
                    if issue.starts_with("beads-") {
                        println!("  {} Linking to {}...", "→".cyan(), issue);
                        // Escalation depends on the related issue
                        if let Err(e) = run_beads(&["dep", "add", esc_id, issue]) {
                            println!("    {} Failed to link: {}", "⚠".yellow(), e);
                        } else {
                            println!("    {} Linked", "✓".green());
                        }
                    }
                }
            }

            println!();
            println!("{}", "✓ Escalation created".green().bold());

            // Notify Master Control
            notify_master_control(&cmd, &sender, config);
        }
        Err(e) => {
            println!("{}", format!("✗ Failed to create escalation: {}", e).red());

            // Still try to notify directly
            notify_master_control(&cmd, &sender, config);
        }
    }

    Ok(())
}

/// Attempt to notify Master Control session directly.
fn notify_master_control(cmd: &EscalateCommand, sender: &str, _config: &Config) {
    // Try to find Master Control session
    let master_session = "rdv-master-control";

    if tmux::session_exists(master_session).unwrap_or(false) {
        println!();
        println!("{}", "Notifying Master Control...".cyan());

        let severity_banner = match cmd.severity.to_uppercase().as_str() {
            "CRITICAL" => "🚨 CRITICAL ESCALATION 🚨",
            "HIGH" => "⚠️  HIGH PRIORITY ESCALATION",
            "MEDIUM" => "📋 ESCALATION",
            _ => "📝 Escalation",
        };

        let notification = format!(
            "\n\
            ╔══════════════════════════════════════════════════════════╗\n\
            ║ {}  ║\n\
            ╠══════════════════════════════════════════════════════════╣\n\
            ║ From: {:52} ║\n\
            ║ Topic: {:51} ║\n\
            ╚══════════════════════════════════════════════════════════╝\n\
            Run `bd list --type=escalation` to review\n",
            severity_banner,
            truncate(sender, 52),
            truncate(&cmd.topic, 51)
        );

        match tmux::send_keys(master_session, &notification, false) {
            Ok(_) => {
                println!("  {} Master Control notified", "✓".green());
            }
            Err(_) => {
                println!("  {} Could not notify Master Control directly", "⚠".yellow());
            }
        }
    } else {
        println!();
        println!("{}", "⚠ Master Control session not running".yellow());
        println!("  Escalation saved to beads for later review");
        println!("  Start Master Control with: rdv master start");
    }
}

/// Truncate string to max length, adding "..." if truncated.
fn truncate(s: &str, max_len: usize) -> String {
    if s.len() <= max_len {
        format!("{:<width$}", s, width = max_len)
    } else {
        format!("{}...", &s[..max_len - 3])
    }
}
