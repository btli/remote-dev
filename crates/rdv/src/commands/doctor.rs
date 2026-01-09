//! Diagnostics command.

use anyhow::Result;
use colored::Colorize;

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

    // Check API connectivity
    print!("  API ({}):", config.api.url);
    match check_api(&config.api.url).await {
        Ok(_) => println!(" {}", "✓ reachable".green()),
        Err(e) => {
            println!(" {}", format!("✗ {}", e).red());
            issues.push("Cannot reach Remote Dev API");
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

async fn check_api(url: &str) -> Result<()> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()?;

    client.get(format!("{}/api/health", url))
        .send()
        .await?;

    Ok(())
}
