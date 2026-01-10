//! tmux integration for session management.
//!
//! Provides low-level tmux operations for:
//! - Session creation and management
//! - Pane content capture (scrollback)
//! - Sending keys to sessions
//! - Health checking

use crate::error::{RdvResult, TmuxError};
use std::process::Command;
use tracing::{debug, warn};

/// Check if tmux is installed and available.
pub fn check_tmux() -> RdvResult<()> {
    match which::which("tmux") {
        Ok(path) => {
            debug!("Found tmux at: {:?}", path);
            Ok(())
        }
        Err(_) => Err(TmuxError::NotFound.into()),
    }
}

/// Check if a tmux session exists.
pub fn session_exists(session_name: &str) -> RdvResult<bool> {
    let output = Command::new("tmux")
        .args(["has-session", "-t", session_name])
        .output()?;

    Ok(output.status.success())
}

/// List all tmux sessions.
pub fn list_sessions() -> RdvResult<Vec<TmuxSession>> {
    let output = Command::new("tmux")
        .args([
            "list-sessions",
            "-F",
            "#{session_name}:#{session_created}:#{session_attached}",
        ])
        .output()?;

    if !output.status.success() {
        // No sessions is not an error
        let stderr = String::from_utf8_lossy(&output.stderr);
        if stderr.contains("no server running") || stderr.contains("no sessions") {
            return Ok(Vec::new());
        }
        return Err(TmuxError::CommandFailed(stderr.to_string()).into());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let sessions: Vec<TmuxSession> = stdout
        .lines()
        .filter_map(|line| {
            let parts: Vec<&str> = line.split(':').collect();
            if parts.len() >= 3 {
                Some(TmuxSession {
                    name: parts[0].to_string(),
                    created: parts[1].parse().unwrap_or(0),
                    attached: parts[2] == "1",
                })
            } else {
                None
            }
        })
        .collect();

    Ok(sessions)
}

/// Create a new tmux session.
pub fn create_session(config: &CreateSessionConfig) -> RdvResult<()> {
    if session_exists(&config.session_name)? {
        return Err(TmuxError::SessionExists(config.session_name.clone()).into());
    }

    let mut args = vec![
        "new-session",
        "-d",
        "-s",
        &config.session_name,
    ];

    // Set working directory
    if let Some(ref cwd) = config.working_directory {
        args.push("-c");
        args.push(cwd);
    }

    // Set initial command
    if let Some(ref cmd) = config.command {
        args.push(cmd);
    }

    let output = Command::new("tmux").args(&args).output()?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(TmuxError::CommandFailed(stderr.to_string()).into());
    }

    // Auto-respawn: Set up pane-died hook to automatically restart the process
    // This respawns immediately when process exits - no dead panes, no polling
    if config.auto_respawn {
        // The hook runs respawn-pane with the original command when the pane dies
        let _ = Command::new("tmux")
            .args([
                "set-hook",
                "-t",
                &config.session_name,
                "pane-died",
                "respawn-pane -k",
            ])
            .output();
    }

    debug!("Created tmux session: {}", config.session_name);
    Ok(())
}

/// Kill a tmux session.
pub fn kill_session(session_name: &str) -> RdvResult<()> {
    if !session_exists(session_name)? {
        return Err(TmuxError::SessionNotFound(session_name.to_string()).into());
    }

    let output = Command::new("tmux")
        .args(["kill-session", "-t", session_name])
        .output()?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(TmuxError::CommandFailed(stderr.to_string()).into());
    }

    debug!("Killed tmux session: {}", session_name);
    Ok(())
}

/// Capture pane content (scrollback buffer).
pub fn capture_pane(session_name: &str, lines: Option<u32>) -> RdvResult<String> {
    if !session_exists(session_name)? {
        return Err(TmuxError::SessionNotFound(session_name.to_string()).into());
    }

    let mut args = vec![
        "capture-pane".to_string(),
        "-t".to_string(),
        session_name.to_string(),
        "-p".to_string(),
    ];

    // Add scrollback history
    if let Some(n) = lines {
        args.push("-S".to_string());
        args.push(format!("-{}", n));
    }

    let output = Command::new("tmux")
        .args(&args)
        .output()?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(TmuxError::CaptureFailied(stderr.to_string()).into());
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

/// Send keys to a tmux session.
pub fn send_keys(session_name: &str, keys: &str, enter: bool) -> RdvResult<()> {
    if !session_exists(session_name)? {
        return Err(TmuxError::SessionNotFound(session_name.to_string()).into());
    }

    let mut args = vec!["send-keys", "-t", session_name, keys];
    if enter {
        args.push("Enter");
    }

    let output = Command::new("tmux").args(&args).output()?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(TmuxError::SendKeysFailed(stderr.to_string()).into());
    }

    debug!("Sent keys to session {}: {}", session_name, keys);
    Ok(())
}

/// Attach to a tmux session (interactive).
pub fn attach_session(session_name: &str) -> RdvResult<()> {
    if !session_exists(session_name)? {
        return Err(TmuxError::SessionNotFound(session_name.to_string()).into());
    }

    // This will replace the current process
    let status = Command::new("tmux")
        .args(["attach-session", "-t", session_name])
        .status()?;

    if !status.success() {
        warn!("tmux attach exited with non-zero status");
    }

    Ok(())
}

/// Get session info.
pub fn get_session_info(session_name: &str) -> RdvResult<Option<TmuxSession>> {
    let sessions = list_sessions()?;
    Ok(sessions.into_iter().find(|s| s.name == session_name))
}

/// Compute MD5 hash of scrollback content for stall detection.
pub fn scrollback_hash(session_name: &str, lines: u32) -> RdvResult<String> {
    let content = capture_pane(session_name, Some(lines))?;
    let digest = md5::compute(content.as_bytes());
    Ok(format!("{:x}", digest))
}

/// Check if the pane in a session is dead (process exited but pane remains).
/// Returns true if the pane exists but its process has exited.
pub fn is_pane_dead(session_name: &str) -> RdvResult<bool> {
    if !session_exists(session_name)? {
        return Err(TmuxError::SessionNotFound(session_name.to_string()).into());
    }

    let output = Command::new("tmux")
        .args([
            "list-panes",
            "-t",
            session_name,
            "-F",
            "#{pane_dead}",
        ])
        .output()?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(TmuxError::CommandFailed(stderr.to_string()).into());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    // pane_dead is "1" if dead, "0" if alive
    Ok(stdout.trim() == "1")
}

/// Respawn a dead pane with a new command.
/// If no command is provided, uses the original command.
pub fn respawn_pane(session_name: &str, command: Option<&str>) -> RdvResult<()> {
    if !session_exists(session_name)? {
        return Err(TmuxError::SessionNotFound(session_name.to_string()).into());
    }

    let mut args = vec!["respawn-pane", "-t", session_name, "-k"];

    if let Some(cmd) = command {
        args.push(cmd);
    }

    let output = Command::new("tmux").args(&args).output()?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(TmuxError::CommandFailed(stderr.to_string()).into());
    }

    debug!("Respawned pane in session: {}", session_name);
    Ok(())
}

/// Get pane status for a session.
#[derive(Debug, Clone)]
pub struct PaneStatus {
    pub session_name: String,
    pub is_dead: bool,
    pub pid: Option<u32>,
}

/// Get detailed pane status.
pub fn get_pane_status(session_name: &str) -> RdvResult<PaneStatus> {
    if !session_exists(session_name)? {
        return Err(TmuxError::SessionNotFound(session_name.to_string()).into());
    }

    let output = Command::new("tmux")
        .args([
            "list-panes",
            "-t",
            session_name,
            "-F",
            "#{pane_dead}:#{pane_pid}",
        ])
        .output()?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(TmuxError::CommandFailed(stderr.to_string()).into());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let parts: Vec<&str> = stdout.trim().split(':').collect();

    let is_dead = parts.first().map(|s| *s == "1").unwrap_or(false);
    let pid = parts.get(1).and_then(|s| s.parse().ok());

    Ok(PaneStatus {
        session_name: session_name.to_string(),
        is_dead,
        pid,
    })
}

/// Session information.
#[derive(Debug, Clone)]
pub struct TmuxSession {
    pub name: String,
    pub created: i64,
    pub attached: bool,
}

/// Configuration for creating a new session.
#[derive(Debug, Clone, Default)]
pub struct CreateSessionConfig {
    pub session_name: String,
    pub working_directory: Option<String>,
    pub command: Option<String>,
    /// Auto-respawn process when it exits (for orchestrators)
    /// Uses tmux pane-died hook - no dead panes, immediate restart
    pub auto_respawn: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_check_tmux() {
        // This test requires tmux to be installed
        let result = check_tmux();
        // Don't assert - tmux may not be installed in CI
        println!("tmux check result: {:?}", result);
    }
}
