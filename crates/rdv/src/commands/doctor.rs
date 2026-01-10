//! Diagnostics command.

use anyhow::Result;
use colored::Colorize;

#[cfg(feature = "http-api")]
use crate::config::ApiEndpoint;
use crate::config::Config;
use crate::db::Database;
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

    // Check API connectivity (only when http-api feature is enabled)
    #[cfg(feature = "http-api")]
    {
        let endpoint = config.api_endpoint();
        match &endpoint {
            ApiEndpoint::UnixSocket(path) => {
                print!("  API (unix:{}):", path.display());
                if path.exists() {
                    println!(" {}", "✓ socket exists".green());
                } else {
                    println!(" {}", "✗ socket not found".red());
                    issues.push("Unix socket not found - is the server running?");
                }
            }
            ApiEndpoint::Http(url) => {
                print!("  API ({}):", url);
                match check_api_http(url).await {
                    Ok(_) => println!(" {}", "✓ reachable".green()),
                    Err(e) => {
                        println!(" {}", format!("✗ {}", e).red());
                        issues.push("Cannot reach Remote Dev API");
                    }
                }
            }
        }
    }
    #[cfg(not(feature = "http-api"))]
    {
        print!("  Database: ");
        match Database::open() {
            Ok(db) => {
                println!("{}", "✓ connected (direct SQLite mode)".green());
                // Check user info
                print!("  User: ");
                match db.get_default_user() {
                    Ok(Some(user)) => {
                        let name = user.name.as_deref().unwrap_or("(no name)");
                        let email = user.email.as_deref().unwrap_or("(no email)");
                        println!("{} <{}>", name.green(), email);
                        // Also verify get_user_by_email works if we have an email
                        if let Some(ref e) = user.email {
                            if db.get_user_by_email(e).is_ok() {
                                println!("    {} user lookup working", "✓".green());
                            }
                        }
                    }
                    Ok(None) => {
                        println!("{}", "✗ no user found".red());
                        issues.push("No user found in database - run db:seed first");
                    }
                    Err(e) => {
                        println!("{}", format!("✗ error: {}", e).red());
                        issues.push("Failed to query user from database");
                    }
                }
            }
            Err(e) => {
                println!("{}", format!("✗ {}", e).red());
                issues.push("Database not accessible");
            }
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

#[cfg(feature = "http-api")]
async fn check_api_http(url: &str) -> Result<()> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()?;

    client
        .get(format!("{}/api/health", url))
        .send()
        .await?;

    Ok(())
}
