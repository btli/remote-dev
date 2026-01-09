//! Mail system commands for inter-agent communication.

use anyhow::Result;
use colored::Colorize;

use crate::cli::{MailCommand, MailAction};
use crate::config::Config;

pub async fn execute(cmd: MailCommand, _config: &Config) -> Result<()> {
    match cmd.action {
        MailAction::Inbox { unread } => inbox(unread).await,
        MailAction::Read { message_id } => read(&message_id).await,
        MailAction::Send { target, subject, message } => {
            send(&target, &subject, &message).await
        }
        MailAction::Mark { message_id } => mark(&message_id).await,
    }
}

async fn inbox(unread: bool) -> Result<()> {
    println!("{}", "Mail Inbox".cyan().bold());
    println!("{}", "─".repeat(50));
    if unread {
        println!("  Showing unread only");
    }

    // TODO: Implement via beads messages
    println!("{}", "⚠ Mail inbox not yet implemented".yellow());
    println!("  Messages are stored as beads with type=message");

    Ok(())
}

async fn read(message_id: &str) -> Result<()> {
    println!("{}", format!("Message: {}", message_id).cyan().bold());
    println!("{}", "─".repeat(50));

    // TODO: Implement via beads
    println!("{}", "⚠ Mail read not yet implemented".yellow());

    Ok(())
}

async fn send(target: &str, subject: &str, message: &str) -> Result<()> {
    println!("{}", "Sending message...".cyan());
    println!("  To: {}", target);
    println!("  Subject: {}", subject);
    println!("  Body: {}", message);

    // TODO: Create beads message
    println!("{}", "⚠ Mail send not yet implemented".yellow());

    Ok(())
}

async fn mark(message_id: &str) -> Result<()> {
    println!("{}", format!("Marking {} as read...", message_id).cyan());

    // TODO: Update beads message
    println!("{}", "⚠ Mail mark not yet implemented".yellow());

    Ok(())
}
