mod client;
mod commands;
mod config;

use clap::Parser;
use commands::{agent, browser, context, folder, hook, indicator, notification, screen, send, session, status, system, task, teams, tmux_compat, worktree};

#[derive(Parser)]
#[command(name = "rdv", version, about = "CLI for Remote Dev terminal server")]
struct Cli {
    /// Output human-readable tables instead of JSON
    #[arg(long, global = true)]
    human: bool,

    #[command(subcommand)]
    command: Command,
}

#[derive(clap::Subcommand)]
enum Command {
    /// Manage terminal sessions
    Session(session::SessionArgs),
    /// Manage git worktrees
    Worktree(worktree::WorktreeArgs),
    /// Manage AI agent sessions
    Agent(agent::AgentArgs),
    /// Manage project tasks
    Task(task::TaskArgs),
    /// Manage folders
    Folder(folder::FolderArgs),
    /// Handle Claude Code lifecycle hooks (stop, notify, session-end)
    Hook(hook::HookArgs),
    /// Show dashboard status or report agent status
    Status(status::StatusArgs),
    /// System management (updates, service control)
    System(system::SystemArgs),
    /// Show current session context
    Context,
    /// Manage notifications
    Notification(notification::NotificationArgs),
    /// Browser automation commands
    Browser(browser::BrowserArgs),
    /// Send text or keystrokes to a terminal session
    Send(send::SendArgs),
    /// Capture terminal screen content
    Screen(screen::ScreenArgs),
    /// Set a per-session status indicator
    SetStatus(indicator::SetStatusArgs),
    /// Clear a per-session status indicator
    ClearStatus(indicator::ClearStatusArgs),
    /// Set session progress bar
    SetProgress(indicator::SetProgressArgs),
    /// Clear session progress bar
    ClearProgress(indicator::ClearProgressArgs),
    /// Write a per-session structured log entry
    Log(indicator::LogArgs),
    /// Multi-agent team orchestration
    Teams(teams::TeamsArgs),
    /// tmux compatibility layer
    Tmux(tmux_compat::TmuxCompatArgs),
}

#[tokio::main]
async fn main() {
    let cli = Cli::parse();
    let cfg = config::ServerConfig::from_env();
    let client = client::Client::new(&cfg);

    let result = match cli.command {
        Command::Session(args) => session::run(args, &client, cli.human).await,
        Command::Worktree(args) => worktree::run(args, &client, cli.human).await,
        Command::Agent(args) => agent::run(args, &client, cli.human).await,
        Command::Task(args) => task::run(args, &client, cli.human).await,
        Command::Folder(args) => folder::run(args, &client, cli.human).await,
        Command::Hook(args) => hook::run(args, &client, cli.human).await,
        Command::Status(args) => status::run(args, &client, cli.human).await,
        Command::System(args) => system::run(args, &client, cli.human).await,
        Command::Context => context::run(&client, cli.human).await,
        Command::Notification(args) => notification::run(args, &client, cli.human).await,
        Command::Browser(args) => browser::run(args, &client, cli.human).await,
        Command::Send(args) => send::run(args, &client).await,
        Command::Screen(args) => screen::run(args, &client, cli.human).await,
        Command::SetStatus(args) => indicator::run_set_status(args, &client).await,
        Command::ClearStatus(args) => indicator::run_clear_status(args, &client).await,
        Command::SetProgress(args) => indicator::run_set_progress(args, &client).await,
        Command::ClearProgress(args) => indicator::run_clear_progress(args, &client).await,
        Command::Log(args) => indicator::run_log(args, &client).await,
        Command::Teams(args) => teams::run(args, &client, cli.human).await,
        Command::Tmux(args) => tmux_compat::run(args, &client, cli.human).await,
    };

    if let Err(e) = result {
        eprintln!("Error: {e}");
        std::process::exit(1);
    }
}
