mod client;
mod commands;
mod config;

use clap::Parser;
use commands::{agent, browser, context, folder, notification, session, status, task, worktree};

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
    /// Show dashboard status or report agent status
    Status(status::StatusArgs),
    /// Show current session context
    Context,
    /// Manage notifications
    Notification(notification::NotificationArgs),
    /// Browser automation commands
    Browser(browser::BrowserArgs),
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
        Command::Status(args) => status::run(args, &client, cli.human).await,
        Command::Context => context::run(&client, cli.human).await,
        Command::Notification(args) => notification::run(args, &client, cli.human).await,
        Command::Browser(args) => browser::run(args, &client, cli.human).await,
    };

    if let Err(e) = result {
        eprintln!("Error: {e}");
        std::process::exit(1);
    }
}
