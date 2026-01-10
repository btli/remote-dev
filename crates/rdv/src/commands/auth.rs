//! CLI token authentication commands.
//!
//! Manages CLI tokens for authenticating with rdv-server.

use anyhow::Result;
use colored::Colorize;

use crate::cli::AuthAction;
use crate::config::Config;
use std::fs::{self, Permissions};
use std::io::Write;
use std::os::unix::fs::PermissionsExt;
use std::process::Command;

/// Handle auth commands
pub async fn handle(action: AuthAction, _config: &Config) -> Result<()> {
    match action {
        AuthAction::Login { name } => login(name).await,
        AuthAction::Logout => logout().await,
        AuthAction::Status => status().await,
    }
}

/// Login to rdv-server (register CLI token)
async fn login(name: Option<String>) -> Result<()> {
    let home = dirs::home_dir().expect("No home directory");
    let token_file = home.join(".remote-dev/cli-token");
    let server_socket = home.join(".remote-dev/run/api.sock");

    // Check if already logged in
    if token_file.exists() {
        let existing = fs::read_to_string(&token_file)?;
        println!(
            "{} Already logged in with token {}...",
            "✓".green(),
            &existing.trim()[..12]
        );
        println!("  Use {} to revoke the current token first.", "rdv auth logout".cyan());
        return Ok(());
    }

    // Check if server is available
    if !server_socket.exists() {
        println!(
            "{} rdv-server is not running. Start it first.",
            "✗".red()
        );
        println!("  Run: {}", "rdv-server".cyan());
        return Ok(());
    }

    // Create token via server API using curl (simpler than hyper for one-off)
    let token_name = name.unwrap_or_else(|| {
        format!(
            "rdv-cli-{}",
            hostname::get()
                .map(|h| h.to_string_lossy().to_string())
                .unwrap_or_else(|_| "unknown".to_string())
        )
    });

    println!("{} Creating CLI token '{}'...", "→".cyan(), token_name);

    // Use curl to call the API via Unix socket
    let body = serde_json::json!({ "name": token_name });
    let output = Command::new("curl")
        .args([
            "--silent",
            "--unix-socket",
            server_socket.to_str().unwrap(),
            "-X",
            "POST",
            "-H",
            "Content-Type: application/json",
            "-d",
            &body.to_string(),
            "http://localhost/api/tokens",
        ])
        .output()?;

    if !output.status.success() {
        println!(
            "{} Failed to create token: {}",
            "✗".red(),
            String::from_utf8_lossy(&output.stderr)
        );
        return Ok(());
    }

    // Parse response
    let response: serde_json::Value = serde_json::from_slice(&output.stdout)?;

    if let Some(raw_key) = response.get("rawKey").and_then(|k| k.as_str()) {
        // Save token to file with restricted permissions
        if let Some(parent) = token_file.parent() {
            fs::create_dir_all(parent)?;
        }

        let mut file = fs::File::create(&token_file)?;
        file.write_all(raw_key.as_bytes())?;
        file.set_permissions(Permissions::from_mode(0o600))?;

        println!("{} Login successful!", "✓".green());
        println!(
            "  Token saved to {}",
            token_file.display().to_string().cyan()
        );
        println!("  Token prefix: {}", &raw_key[..12].yellow());
    } else if let Some(error) = response.get("error").and_then(|e| e.as_str()) {
        println!("{} Failed: {}", "✗".red(), error);
    } else {
        println!(
            "{} Unexpected response: {}",
            "✗".red(),
            String::from_utf8_lossy(&output.stdout)
        );
    }

    Ok(())
}

/// Logout (revoke CLI token)
async fn logout() -> Result<()> {
    let home = dirs::home_dir().expect("No home directory");
    let token_file = home.join(".remote-dev/cli-token");
    let server_socket = home.join(".remote-dev/run/api.sock");

    // Check if logged in
    if !token_file.exists() {
        println!("{} Not logged in.", "✗".red());
        return Ok(());
    }

    let token = fs::read_to_string(&token_file)?.trim().to_string();

    // Try to revoke on server if available
    if server_socket.exists() {
        println!("{} Revoking token on server...", "→".cyan());

        // First get the token ID by listing tokens
        let output = Command::new("curl")
            .args([
                "--silent",
                "--unix-socket",
                server_socket.to_str().unwrap(),
                "-H",
                &format!("Authorization: Bearer {}", token),
                "http://localhost/api/tokens",
            ])
            .output()?;

        if output.status.success() {
            let tokens: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap_or_default();

            // Find token with matching prefix
            if let Some(tokens) = tokens.as_array() {
                let prefix = &token[..8];
                if let Some(token_obj) = tokens.iter().find(|t| {
                    t.get("keyPrefix")
                        .and_then(|p| p.as_str())
                        .map(|p| p == prefix)
                        .unwrap_or(false)
                }) {
                    if let Some(token_id) = token_obj.get("id").and_then(|i| i.as_str()) {
                        // Revoke the token
                        let _ = Command::new("curl")
                            .args([
                                "--silent",
                                "--unix-socket",
                                server_socket.to_str().unwrap(),
                                "-X",
                                "DELETE",
                                "-H",
                                &format!("Authorization: Bearer {}", token),
                                &format!("http://localhost/api/tokens/{}", token_id),
                            ])
                            .output();

                        println!("{} Token revoked on server", "✓".green());
                    }
                }
            }
        }
    }

    // Remove local token file
    fs::remove_file(&token_file)?;
    println!("{} Logged out successfully!", "✓".green());

    Ok(())
}

/// Show auth status
async fn status() -> Result<()> {
    let home = dirs::home_dir().expect("No home directory");
    let token_file = home.join(".remote-dev/cli-token");
    let server_socket = home.join(".remote-dev/run/api.sock");

    println!("{}", "CLI Authentication Status".bold());
    println!("{}", "─".repeat(40));

    // Check token file
    if token_file.exists() {
        let token = fs::read_to_string(&token_file)?.trim().to_string();
        let prefix = &token[..12.min(token.len())];
        println!("Token:     {} ({}...)", "Present".green(), prefix.yellow());

        // Check file permissions
        let metadata = fs::metadata(&token_file)?;
        let mode = metadata.permissions().mode() & 0o777;
        if mode == 0o600 {
            println!("Perms:     {} (0600)", "Secure".green());
        } else {
            println!(
                "Perms:     {} ({:o})",
                "Insecure".yellow(),
                mode
            );
        }
    } else {
        println!("Token:     {}", "Not logged in".red());
    }

    // Check server connection
    if server_socket.exists() {
        // Try to ping the server
        let output = Command::new("curl")
            .args([
                "--silent",
                "--max-time",
                "2",
                "--unix-socket",
                server_socket.to_str().unwrap(),
                "http://localhost/health",
            ])
            .output();

        match output {
            Ok(o) if o.status.success() => {
                let health: serde_json::Value = serde_json::from_slice(&o.stdout).unwrap_or_default();
                let version = health
                    .get("version")
                    .and_then(|v| v.as_str())
                    .unwrap_or("unknown");
                println!("Server:    {} (v{})", "Running".green(), version);
            }
            _ => {
                println!("Server:    {}", "Socket exists but not responding".yellow());
            }
        }
    } else {
        println!("Server:    {}", "Not running".red());
    }

    Ok(())
}
