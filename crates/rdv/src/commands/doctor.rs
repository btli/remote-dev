//! Diagnostics command.
//!
//! Uses rdv-server API for database connectivity checks.

use anyhow::Result;
use colored::Colorize;

use rdv_core::client::ApiClient;

use crate::config::Config;
use crate::tmux;

pub async fn execute(config: &Config) -> Result<()> {
    println!("{}", "rdv Doctor".cyan().bold());
    println!("{}", "─".repeat(50));
    println!();

    let mut issues = Vec::new();

    // Check tmux
    print!("  tmux: ");
    match tmux::check_tmux() {
        Ok(_) => println!("{}", "✓ installed".green()),
        Err(_) => {
            println!("{}", "✗ not found".red());
            issues.push("tmux is not installed");
        }
    }

    // Check config file
    print!("  Config file: ");
    let config_path = Config::config_path();
    if config_path.exists() {
        println!("{}", "✓ exists".green());
    } else {
        println!("{}", "○ not found (using defaults)".yellow());
    }

    // Check data directory
    print!("  Data directory: ");
    if config.paths.data_dir.exists() {
        println!("{}", "✓ exists".green());
    } else {
        println!("{}", "○ will be created".yellow());
    }

    // Check rdv-server connectivity
    print!("  rdv-server: ");
    match ApiClient::new() {
        Ok(client) => {
            match client.health().await {
                Ok(health) => {
                    println!("{} (v{})", "✓ connected".green(), health.version);

                    // Check user info
                    print!("  User: ");
                    match client.get_current_user().await {
                        Ok(user) => {
                            let name = user.name.as_deref().unwrap_or("(no name)");
                            let email = user.email.as_deref().unwrap_or("(no email)");
                            println!("{} <{}>", name.green(), email);
                        }
                        Err(e) => {
                            println!("{}", format!("✗ {}", e).red());
                            issues.push("Failed to query user from rdv-server");
                        }
                    }
                }
                Err(e) => {
                    println!("{}", format!("✗ not responding: {}", e).red());
                    issues.push("rdv-server not responding");
                }
            }
        }
        Err(e) => {
            println!("{}", format!("✗ {}", e).red());
            issues.push("Cannot connect to rdv-server");
        }
    }

    // Check agents
    println!();
    println!("  {}", "Agents:".cyan());
    for (name, cmd) in &config.agents.commands {
        print!("    {}: ", name);
        match which::which(cmd) {
            Ok(_) => println!("{}", "✓ installed".green()),
            Err(_) => println!("{}", "○ not found".yellow()),
        }
    }

    // Check beads
    print!("  beads (bd): ");
    match which::which("bd") {
        Ok(_) => println!("{}", "✓ installed".green()),
        Err(_) => {
            println!("{}", "✗ not found".red());
            issues.push("beads (bd) is not installed");
        }
    }

    // Summary
    println!();
    if issues.is_empty() {
        println!("{}", "✓ All checks passed".green().bold());
    } else {
        println!("{}", format!("✗ {} issue(s) found:", issues.len()).red().bold());
        for issue in &issues {
            println!("  • {}", issue);
        }
    }

    Ok(())
}
