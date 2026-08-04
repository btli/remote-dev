use std::io::{Read, Write};

use clap::{Args, Subcommand};
use serde_json::json;

use crate::client::Client;

#[derive(Args)]
pub struct HookArgs {
    #[command(subcommand)]
    command: HookCommand,
}

#[derive(Subcommand)]
enum HookCommand {
    /// Handle PreToolUse hook: report "running" status
    PreToolUse,
    /// Handle PostToolUse hook: post-push peer broadcast
    PostToolUse,
    /// Handle PreCompact hook: report "compacting" status
    PreCompact,
    /// Handle Notification hook: report "waiting" status
    Notification,
    /// Handle Stop hook: report idle status, check beads, create notification
    Stop {
        /// Agent provider name (e.g. "claude", "codex")
        #[arg(long)]
        agent: Option<String>,
        /// Reason the agent stopped
        #[arg(long)]
        reason: Option<String>,
    },
    /// Send a notification for a lifecycle event
    Notify {
        /// Event name (e.g. "error", "stalled", "deployed")
        event: String,
        /// Optional message body
        #[arg(long)]
        body: Option<String>,
        /// [y5ch.8] Signal class: actionable | passive | error (default passive).
        #[arg(long)]
        severity: Option<String>,
    },
    /// Handle SessionEnd hook: report session ended
    SessionEnd,
    /// Handle SubagentStop hook: report parent still running, no notification
    SubagentStop,
    /// Validate that all hooks can reach the server and are functional
    Validate,
    /// Unified handler for Claude Code lifecycle hooks (cmux-compatible)
    Claude {
        /// Hook event: session-start, stop, notification, compacting, prompt-submit, post-tool-use, session-end
        event: String,
        /// Agent provider name
        #[arg(long)]
        agent: Option<String>,
        /// Reason for stop
        #[arg(long)]
        reason: Option<String>,
    },
    /// Unified handler for OpenAI Codex lifecycle hooks
    Codex {
        /// Hook event: session-start, prompt-submit, pre-tool-use, permission-request,
        /// post-tool-use, pre-compact, post-compact, subagent-start,
        /// subagent-stop, stop, or session-end
        event: String,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CodexHookAction {
    Status(&'static str, Option<&'static str>),
    PreToolUse,
    PostToolUse,
    Stop,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum StopWireFormat {
    Claude,
    Codex,
}

fn codex_action(event: &str, payload: &serde_json::Value) -> Result<CodexHookAction, String> {
    let action = match event {
        "session-start" | "prompt-submit" | "post-compact" => {
            CodexHookAction::Status("running", None)
        }
        "pre-tool-use" => {
            let tool_name = payload
                .get("tool_name")
                .and_then(|value| value.as_str())
                .unwrap_or_default();
            if matches!(
                tool_name,
                "request_user_input" | "functions.request_user_input" | "AskUserQuestion"
            ) {
                CodexHookAction::Status("waiting", None)
            } else {
                CodexHookAction::PreToolUse
            }
        }
        "permission-request" => CodexHookAction::Status("waiting", None),
        "post-tool-use" => CodexHookAction::PostToolUse,
        "pre-compact" => CodexHookAction::Status("compacting", None),
        "subagent-start" => CodexHookAction::Status("subagent", None),
        "subagent-stop" => CodexHookAction::Status("running", Some("subagent-stop")),
        "stop" => CodexHookAction::Stop,
        "session-end" => CodexHookAction::Status("ended", None),
        unknown => return Err(format!("unknown codex hook event: {unknown}")),
    };
    Ok(action)
}

fn format_stop_block(format: StopWireFormat, reason: &str) -> String {
    match format {
        StopWireFormat::Claude => format!("{reason}\n"),
        StopWireFormat::Codex => format!(
            "{}\n",
            serde_json::to_string(&json!({ "decision": "block", "reason": reason }))
                .expect("static stop response must serialize")
        ),
    }
}

fn format_codex_pre_tool_response(
    additional_context: Option<&str>,
    denial_reason: Option<&str>,
) -> Option<String> {
    if additional_context.is_none() && denial_reason.is_none() {
        return None;
    }
    let mut output = serde_json::Map::new();
    output.insert("hookEventName".to_string(), json!("PreToolUse"));
    if let Some(context) = additional_context {
        output.insert("additionalContext".to_string(), json!(context));
    }
    if let Some(reason) = denial_reason {
        output.insert("permissionDecision".to_string(), json!("deny"));
        output.insert("permissionDecisionReason".to_string(), json!(reason));
    }
    Some(
        serde_json::to_string(&json!({ "hookSpecificOutput": output }))
            .expect("Codex pre-tool response must serialize"),
    )
}

// ── Bash inspection ─────────────────────────────────────────────────

/// Result of inspecting a Bash tool-use payload for git push to main/master.
struct BashInspection {
    command: String,
    targets_main: bool,
}

/// Extract shell source across Claude and Codex tool naming/input shapes.
fn shell_value(value: &serde_json::Value) -> Option<String> {
    if let Some(command) = value.as_str() {
        return Some(command.to_string());
    }
    value.as_array().and_then(|parts| {
        parts
            .iter()
            .map(|part| part.as_str())
            .collect::<Option<Vec<_>>>()
            .map(|parts| parts.join(" "))
    })
}

fn shell_command(payload: &serde_json::Value) -> Option<String> {
    let tool_name = payload.get("tool_name")?.as_str()?;
    if !matches!(
        tool_name,
        "Bash"
            | "unified_exec"
            | "local_shell"
            | "exec_command"
            | "functions.exec"
            | "functions.exec_command"
    ) {
        return None;
    }

    for input_key in ["tool_input", "input", "arguments"] {
        let Some(input) = payload.get(input_key) else {
            continue;
        };
        if let Some(command) = shell_value(input) {
            return Some(command);
        }
        for command_key in ["command", "cmd"] {
            if let Some(command) = input.get(command_key).and_then(shell_value) {
                return Some(command);
            }
        }
    }
    payload
        .get("command")
        .or_else(|| payload.get("cmd"))
        .and_then(shell_value)
}

/// Extract literal `cmd` properties from Codex's free-form JavaScript
/// orchestration tool. The hook must inspect the command passed to
/// `tools.exec_command`, not reinterpret the JavaScript program as shell.
/// Dynamic/non-literal command construction is rejected because policy cannot
/// prove which identity-affecting command will execute.
fn javascript_exec_commands(source: &str) -> Result<Vec<String>, String> {
    let bytes = source.as_bytes();
    let mut commands = Vec::new();
    let mut index = 0;

    while index < bytes.len() {
        if bytes[index] == b'/' && bytes.get(index + 1) == Some(&b'/') {
            index += 2;
            while index < bytes.len() && bytes[index] != b'\n' {
                index += 1;
            }
            continue;
        }
        if bytes[index] == b'/' && bytes.get(index + 1) == Some(&b'*') {
            let Some(end) = source[index + 2..].find("*/") else {
                return Err("functions.exec contains an unterminated comment".to_string());
            };
            index += end + 4;
            continue;
        }
        if matches!(bytes[index], b'\'' | b'"' | b'`') {
            index = skip_javascript_string(bytes, index)?.0;
            continue;
        }
        if !(bytes[index].is_ascii_alphabetic() || matches!(bytes[index], b'_' | b'$')) {
            index += 1;
            continue;
        }

        let start = index;
        index += 1;
        while index < bytes.len()
            && (bytes[index].is_ascii_alphanumeric() || matches!(bytes[index], b'_' | b'$'))
        {
            index += 1;
        }
        let identifier = &source[start..index];
        if identifier == "tools" {
            let property = skip_javascript_trivia(source, index)?;
            if bytes.get(property) != Some(&b'.') {
                return Err(
                    "functions.exec aliases or dynamically indexes the tools object".to_string(),
                );
            }
            continue;
        }
        match identifier {
            "exec_command" => {
                let value = javascript_call_string_property(source, index, "cmd", true)?
                    .expect("required JavaScript cmd property was checked");
                commands.push(value);
            }
            "write_stdin" => {
                if let Some(value) = javascript_call_string_property(source, index, "chars", false)?
                {
                    if !value.is_empty() {
                        commands.push(value);
                    }
                }
            }
            _ => {}
        }
    }

    if looks_like_protected_git(source)
        && !commands
            .iter()
            .any(|command| looks_like_protected_git(command))
    {
        return Err(
            "functions.exec contains protected Git text outside a direct inspectable shell dispatch"
                .to_string(),
        );
    }
    Ok(commands)
}

fn skip_javascript_trivia(source: &str, mut index: usize) -> Result<usize, String> {
    let bytes = source.as_bytes();
    loop {
        while index < bytes.len() && bytes[index].is_ascii_whitespace() {
            index += 1;
        }
        if bytes.get(index) == Some(&b'/') && bytes.get(index + 1) == Some(&b'/') {
            index += 2;
            while index < bytes.len() && bytes[index] != b'\n' {
                index += 1;
            }
            continue;
        }
        if bytes.get(index) == Some(&b'/') && bytes.get(index + 1) == Some(&b'*') {
            let Some(end) = source[index + 2..].find("*/") else {
                return Err("functions.exec contains an unterminated comment".to_string());
            };
            index += end + 4;
            continue;
        }
        return Ok(index);
    }
}

/// Validate one direct nested tool call and extract the only property that can
/// carry shell input. The argument must be an inline object so a decoy `cmd`
/// elsewhere, a spread override, or a shorthand/dynamic value cannot satisfy
/// inspection for a different call.
fn javascript_call_string_property(
    source: &str,
    identifier_end: usize,
    property: &str,
    required: bool,
) -> Result<Option<String>, String> {
    let bytes = source.as_bytes();
    let mut index = skip_javascript_trivia(source, identifier_end)?;
    if bytes.get(index) != Some(&b'(') {
        return Err(format!(
            "functions.exec references {property}'s shell dispatcher indirectly"
        ));
    }
    index = skip_javascript_trivia(source, index + 1)?;
    if bytes.get(index) != Some(&b'{') {
        return Err(format!(
            "functions.exec {property} dispatch must use an inline object literal"
        ));
    }

    index += 1;
    let mut brace_depth = 1_usize;
    let mut bracket_depth = 0_usize;
    let mut paren_depth = 0_usize;
    let mut expecting_key = true;
    let mut found = None;

    loop {
        index = skip_javascript_trivia(source, index)?;
        let Some(byte) = bytes.get(index).copied() else {
            return Err("functions.exec contains an unterminated tool argument object".to_string());
        };

        if brace_depth == 1 && bracket_depth == 0 && paren_depth == 0 && expecting_key {
            if byte == b'}' {
                index += 1;
                break;
            }
            if bytes.get(index..index + 3) == Some(&b"..."[..]) {
                return Err(
                    "functions.exec shell dispatch objects may not contain spreads".to_string(),
                );
            }
            if byte == b'[' {
                return Err(
                    "functions.exec shell dispatch objects may not use computed keys".to_string(),
                );
            }

            let (after_key, key) = if matches!(byte, b'\'' | b'"' | b'`') {
                skip_javascript_string(bytes, index)?
            } else if byte.is_ascii_alphabetic() || matches!(byte, b'_' | b'$') {
                let start = index;
                index += 1;
                while index < bytes.len()
                    && (bytes[index].is_ascii_alphanumeric() || matches!(bytes[index], b'_' | b'$'))
                {
                    index += 1;
                }
                (index, source[start..index].to_string())
            } else {
                return Err(
                    "functions.exec shell dispatch object has an unsupported property key"
                        .to_string(),
                );
            };

            let after_key = skip_javascript_trivia(source, after_key)?;
            if bytes.get(after_key) == Some(&b':') {
                index = skip_javascript_trivia(source, after_key + 1)?;
                if key == property {
                    if found.is_some() {
                        return Err(format!(
                            "functions.exec shell dispatch contains duplicate {property} properties"
                        ));
                    }
                    if !matches!(bytes.get(index), Some(b'\'' | b'"' | b'`')) {
                        return Err(format!(
                            "functions.exec uses a dynamic {property} value that cannot be inspected"
                        ));
                    }
                    let (next, value) = skip_javascript_string(bytes, index)?;
                    let expression_end = skip_javascript_trivia(source, next)?;
                    if !matches!(bytes.get(expression_end), Some(b',' | b'}')) {
                        return Err(format!(
                            "functions.exec {property} must be one complete, non-concatenated string literal"
                        ));
                    }
                    found = Some(value);
                    index = next;
                }
                expecting_key = false;
                continue;
            }

            if key == property {
                return Err(format!(
                    "functions.exec uses a shorthand or dynamic {property} value"
                ));
            }
            if !matches!(bytes.get(after_key), Some(b',' | b'}')) {
                return Err(
                    "functions.exec shell dispatch object uses an unsupported method property"
                        .to_string(),
                );
            }
            index = after_key;
            expecting_key = false;
            continue;
        }

        if matches!(byte, b'\'' | b'"' | b'`') {
            index = skip_javascript_string(bytes, index)?.0;
            continue;
        }
        match byte {
            b'{' => brace_depth += 1,
            b'}' => {
                if brace_depth == 1 && bracket_depth == 0 && paren_depth == 0 {
                    index += 1;
                    break;
                }
                brace_depth = brace_depth.saturating_sub(1);
            }
            b'[' => bracket_depth += 1,
            b']' => bracket_depth = bracket_depth.saturating_sub(1),
            b'(' => paren_depth += 1,
            b')' => paren_depth = paren_depth.saturating_sub(1),
            b',' if brace_depth == 1 && bracket_depth == 0 && paren_depth == 0 => {
                expecting_key = true;
            }
            _ => {}
        }
        index += 1;
    }

    index = skip_javascript_trivia(source, index)?;
    if bytes.get(index) == Some(&b',') {
        index = skip_javascript_trivia(source, index + 1)?;
    }
    if bytes.get(index) != Some(&b')') {
        return Err(
            "functions.exec shell dispatch must have exactly one object argument".to_string(),
        );
    }
    if required && found.is_none() {
        return Err(format!(
            "functions.exec shell dispatch is missing a literal {property} property"
        ));
    }
    Ok(found)
}

fn skip_javascript_string(bytes: &[u8], start: usize) -> Result<(usize, String), String> {
    let quote = bytes[start];
    let mut value = String::new();
    let mut index = start + 1;
    while index < bytes.len() {
        let byte = bytes[index];
        if byte == quote {
            return Ok((index + 1, value));
        }
        if quote == b'`' && byte == b'$' && bytes.get(index + 1) == Some(&b'{') {
            return Err("functions.exec uses interpolation in a cmd template literal".to_string());
        }
        if byte != b'\\' {
            value.push(byte as char);
            index += 1;
            continue;
        }

        index += 1;
        let Some(escaped) = bytes.get(index).copied() else {
            return Err("functions.exec contains an unterminated string escape".to_string());
        };
        match escaped {
            b'n' => value.push('\n'),
            b'r' => value.push('\r'),
            b't' => value.push('\t'),
            b'b' => value.push('\u{0008}'),
            b'f' => value.push('\u{000c}'),
            b'v' => value.push('\u{000b}'),
            b'0' => value.push('\0'),
            b'x' => {
                let end = index + 3;
                let digits = bytes
                    .get(index + 1..end)
                    .ok_or_else(|| "functions.exec contains an invalid hex escape".to_string())?;
                let digits = std::str::from_utf8(digits)
                    .map_err(|_| "functions.exec contains an invalid hex escape".to_string())?;
                let decoded = u8::from_str_radix(digits, 16)
                    .map_err(|_| "functions.exec contains an invalid hex escape".to_string())?;
                value.push(decoded as char);
                index = end - 1;
            }
            b'u' => {
                let end = index + 5;
                let digits = bytes.get(index + 1..end).ok_or_else(|| {
                    "functions.exec contains an invalid unicode escape".to_string()
                })?;
                let digits = std::str::from_utf8(digits)
                    .map_err(|_| "functions.exec contains an invalid unicode escape".to_string())?;
                let decoded = u32::from_str_radix(digits, 16)
                    .ok()
                    .and_then(char::from_u32)
                    .ok_or_else(|| {
                        "functions.exec contains an invalid unicode escape".to_string()
                    })?;
                value.push(decoded);
                index = end - 1;
            }
            b'\n' => {}
            other => value.push(other as char),
        }
        index += 1;
    }
    Err("functions.exec contains an unterminated string literal".to_string())
}

fn shell_commands(payload: &serde_json::Value) -> Result<Vec<String>, String> {
    if payload.get("tool_name").and_then(|value| value.as_str()) == Some("functions.exec") {
        let source = shell_command(payload).ok_or_else(|| {
            "functions.exec payload does not contain inspectable JavaScript source".to_string()
        })?;
        return javascript_exec_commands(&source);
    }
    Ok(shell_command(payload).into_iter().collect())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum GitGuardOperation {
    Commit,
    Push,
}

impl GitGuardOperation {
    fn as_str(self) -> &'static str {
        match self {
            Self::Commit => "commit",
            Self::Push => "push",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct GitGuardRequest {
    operation: GitGuardOperation,
    proposed_author_name: Option<String>,
    proposed_author_email: Option<String>,
    proposed_committer_name: Option<String>,
    proposed_committer_email: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
struct GitIdentityOverrides {
    author_name: Option<String>,
    author_email: Option<String>,
    committer_name: Option<String>,
    committer_email: Option<String>,
    author_name_from_env: bool,
    author_email_from_env: bool,
    committer_name_from_env: bool,
    committer_email_from_env: bool,
}

impl GitIdentityOverrides {
    fn request(&self, operation: GitGuardOperation) -> GitGuardRequest {
        GitGuardRequest {
            operation,
            proposed_author_name: self.author_name.clone(),
            proposed_author_email: self.author_email.clone(),
            proposed_committer_name: self.committer_name.clone(),
            proposed_committer_email: self.committer_email.clone(),
        }
    }
}

fn assignment(token: &str) -> Option<(&str, &str)> {
    let (name, value) = token.split_once('=')?;
    let valid_name = !name.is_empty()
        && name.chars().enumerate().all(|(index, ch)| {
            ch == '_' || ch.is_ascii_alphanumeric() && (index > 0 || !ch.is_ascii_digit())
        });
    valid_name.then_some((name, value))
}

fn shell_segment_start(tokens: &[String], before: usize) -> usize {
    tokens[..before]
        .iter()
        .rposition(|token| {
            matches!(token.as_str(), ";" | "&&" | "||" | "|" | "&" | "(" | ")")
                || token.ends_with(';')
                || token.ends_with("&&")
                || token.ends_with("||")
        })
        .map_or(0, |index| index + 1)
}

fn command_token(token: &str) -> &str {
    token
        .trim_matches(|ch: char| matches!(ch, ';' | '&' | '|' | '(' | ')' | '$'))
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(token)
}

fn allowed_git_prefix(tokens: &[String]) -> bool {
    apply_prefix_identity(tokens, &mut GitIdentityOverrides::default()).is_ok()
}

fn clear_identity_variable(name: &str, identity: &mut GitIdentityOverrides) {
    match name {
        "GIT_AUTHOR_NAME" => {
            identity.author_name = Some(String::new());
            identity.author_name_from_env = false;
        }
        "GIT_AUTHOR_EMAIL" => {
            identity.author_email = Some(String::new());
            identity.author_email_from_env = false;
        }
        "GIT_COMMITTER_NAME" => {
            identity.committer_name = Some(String::new());
            identity.committer_name_from_env = false;
        }
        "GIT_COMMITTER_EMAIL" => {
            identity.committer_email = Some(String::new());
            identity.committer_email_from_env = false;
        }
        _ => {}
    }
}

fn apply_prefix_identity(
    prefix: &[String],
    identity: &mut GitIdentityOverrides,
) -> Result<(), String> {
    #[derive(Clone, Copy)]
    enum Wrapper {
        Command,
        Env,
        Exec,
        Nice,
        Nohup,
        Time,
    }

    fn clear_all(identity: &mut GitIdentityOverrides) {
        for name in [
            "GIT_AUTHOR_NAME",
            "GIT_AUTHOR_EMAIL",
            "GIT_COMMITTER_NAME",
            "GIT_COMMITTER_EMAIL",
        ] {
            clear_identity_variable(name, identity);
        }
    }

    let mut wrapper = None;
    let mut index = 0;
    while index < prefix.len() {
        let token = prefix[index].as_str();
        let executable = command_token(token);
        if matches!(executable, "sudo" | "doas") {
            return Err(format!(
                "cannot verify Git identity through privilege wrapper {executable}"
            ));
        }

        if let Some((name, value)) = assignment(token) {
            if !matches!(wrapper, None | Some(Wrapper::Env)) {
                return Err(format!(
                    "cannot safely model assignment {name} after an execution wrapper"
                ));
            }
            apply_identity_assignment(name, value, identity);
            index += 1;
            continue;
        }

        wrapper = match executable {
            "command" => Some(Wrapper::Command),
            "env" => Some(Wrapper::Env),
            "exec" => Some(Wrapper::Exec),
            "nice" => Some(Wrapper::Nice),
            "nohup" => Some(Wrapper::Nohup),
            "time" => Some(Wrapper::Time),
            "if" | "then" | "while" | "until" | "do" | "!" | "{" => None,
            _ => wrapper,
        };
        if matches!(
            executable,
            "command"
                | "env"
                | "exec"
                | "nice"
                | "nohup"
                | "time"
                | "if"
                | "then"
                | "while"
                | "until"
                | "do"
                | "!"
                | "{"
        ) {
            index += 1;
            continue;
        }

        match wrapper {
            Some(Wrapper::Env) => match token {
                "-i" | "--ignore-environment" => {
                    clear_all(identity);
                }
                "-u" | "--unset" => {
                    index += 1;
                    let name = prefix.get(index).ok_or_else(|| {
                        format!("environment option {token} is missing its variable")
                    })?;
                    clear_identity_variable(name, identity);
                }
                value if value.starts_with("-u") && value.len() > 2 => {
                    clear_identity_variable(&value[2..], identity);
                }
                value if value.starts_with("--unset=") => {
                    clear_identity_variable(value.trim_start_matches("--unset="), identity);
                }
                "-C" | "--chdir" => {
                    index += 1;
                    if index >= prefix.len() {
                        return Err(format!("environment option {token} is missing its value"));
                    }
                }
                value if value.starts_with("--chdir=") => {}
                "--" => {}
                value if value.starts_with('-') => {
                    return Err(format!(
                        "cannot safely model environment wrapper option {value}"
                    ));
                }
                value => {
                    return Err(format!(
                        "cannot safely model executable {value} between env and Git"
                    ));
                }
            },
            Some(Wrapper::Exec) => match token {
                "-c" => clear_all(identity),
                "-a" => {
                    index += 1;
                    if index >= prefix.len() {
                        return Err("exec option -a is missing its name".to_string());
                    }
                }
                "-l" | "--" => {}
                value => {
                    return Err(format!("cannot safely model exec wrapper token {value}"));
                }
            },
            Some(Wrapper::Nice) => match token {
                "-n" | "--adjustment" => {
                    index += 1;
                    if index >= prefix.len() {
                        return Err(format!("nice option {token} is missing its value"));
                    }
                }
                "--" => {}
                value
                    if value.starts_with("--adjustment=")
                        || value
                            .strip_prefix('-')
                            .is_some_and(|number| number.parse::<i8>().is_ok()) => {}
                value => {
                    return Err(format!("cannot safely model nice wrapper token {value}"));
                }
            },
            Some(Wrapper::Time) => match token {
                "-f" | "--format" | "-o" | "--output" => {
                    index += 1;
                    if index >= prefix.len() {
                        return Err(format!("time option {token} is missing its value"));
                    }
                }
                "-a" | "--append" | "-p" | "--portability" | "-v" | "--verbose" | "--" => {}
                value if value.starts_with("--format=") || value.starts_with("--output=") => {}
                value => {
                    return Err(format!("cannot safely model time wrapper token {value}"));
                }
            },
            Some(Wrapper::Command) => match token {
                "-p" | "-v" | "-V" | "--" => {}
                value => {
                    return Err(format!("cannot safely model command wrapper token {value}"));
                }
            },
            Some(Wrapper::Nohup) => match token {
                "--" | "--help" | "--version" => {}
                value => {
                    return Err(format!("cannot safely model nohup wrapper token {value}"));
                }
            },
            None => {
                return Err(format!(
                    "cannot safely model execution prefix token {token}"
                ));
            }
        }
        index += 1;
    }
    Ok(())
}

fn separate_shell_operators(command: &str) -> String {
    let mut output = String::with_capacity(command.len() + 16);
    let mut single_quoted = false;
    let mut double_quoted = false;
    let mut escaped = false;
    for ch in command.chars() {
        if escaped {
            output.push(ch);
            escaped = false;
            continue;
        }
        if ch == '\\' && !single_quoted {
            output.push(ch);
            escaped = true;
            continue;
        }
        if ch == '\'' && !double_quoted {
            single_quoted = !single_quoted;
            output.push(ch);
            continue;
        }
        if ch == '"' && !single_quoted {
            double_quoted = !double_quoted;
            output.push(ch);
            continue;
        }
        if !single_quoted && !double_quoted && matches!(ch, ';' | '|' | '&' | '(' | ')') {
            output.push(' ');
            output.push(ch);
            output.push(' ');
        } else {
            output.push(ch);
        }
    }
    output
}

fn command_substitution_sources(command: &str) -> Result<Vec<String>, String> {
    let chars: Vec<char> = command.chars().collect();
    let mut sources = Vec::new();
    let mut index = 0;
    let mut single_quoted = false;
    let mut double_quoted = false;

    while index < chars.len() {
        match chars[index] {
            '\\' if !single_quoted => {
                index += 2;
                continue;
            }
            '\'' if !double_quoted => {
                single_quoted = !single_quoted;
                index += 1;
                continue;
            }
            '"' if !single_quoted => {
                double_quoted = !double_quoted;
                index += 1;
                continue;
            }
            '`' if !single_quoted => {
                let start = index + 1;
                index = start;
                let mut escaped = false;
                let mut closed = false;
                while index < chars.len() {
                    if escaped {
                        escaped = false;
                    } else if chars[index] == '\\' {
                        escaped = true;
                    } else if chars[index] == '`' {
                        sources.push(chars[start..index].iter().collect());
                        index += 1;
                        closed = true;
                        break;
                    }
                    index += 1;
                }
                if !closed {
                    return Err("unterminated backtick command substitution".to_string());
                }
                continue;
            }
            '$' if !single_quoted && chars.get(index + 1) == Some(&'(') => {
                let start = index + 2;
                index = start;
                let mut depth = 1;
                let mut nested_single = false;
                let mut nested_double = false;
                let mut escaped = false;
                while index < chars.len() {
                    let ch = chars[index];
                    if escaped {
                        escaped = false;
                    } else if ch == '\\' && !nested_single {
                        escaped = true;
                    } else if ch == '\'' && !nested_double {
                        nested_single = !nested_single;
                    } else if ch == '"' && !nested_single {
                        nested_double = !nested_double;
                    } else if !nested_single && !nested_double {
                        if ch == '(' {
                            depth += 1;
                        } else if ch == ')' {
                            depth -= 1;
                            if depth == 0 {
                                sources.push(chars[start..index].iter().collect());
                                index += 1;
                                break;
                            }
                        }
                    }
                    index += 1;
                }
                if depth != 0 {
                    return Err("unterminated command substitution".to_string());
                }
                continue;
            }
            _ => {}
        }
        index += 1;
    }
    Ok(sources)
}

fn apply_identity_assignment(name: &str, value: &str, identity: &mut GitIdentityOverrides) {
    match name {
        "GIT_AUTHOR_NAME" => {
            identity.author_name = Some(value.to_string());
            identity.author_name_from_env = true;
        }
        "GIT_AUTHOR_EMAIL" => {
            identity.author_email = Some(value.to_string());
            identity.author_email_from_env = true;
        }
        "GIT_COMMITTER_NAME" => {
            identity.committer_name = Some(value.to_string());
            identity.committer_name_from_env = true;
        }
        "GIT_COMMITTER_EMAIL" => {
            identity.committer_email = Some(value.to_string());
            identity.committer_email_from_env = true;
        }
        _ => {}
    }
}

fn apply_git_config(config: &str, identity: &mut GitIdentityOverrides) {
    let (name, value) = config.split_once('=').unwrap_or((config, ""));
    match name.to_ascii_lowercase().as_str() {
        "user.name" => {
            if !identity.author_name_from_env {
                identity.author_name = Some(value.to_string());
            }
            if !identity.committer_name_from_env {
                identity.committer_name = Some(value.to_string());
            }
        }
        "user.email" => {
            if !identity.author_email_from_env {
                identity.author_email = Some(value.to_string());
            }
            if !identity.committer_email_from_env {
                identity.committer_email = Some(value.to_string());
            }
        }
        _ => {}
    }
}

fn git_alias(config: &str) -> Option<(String, String)> {
    let (name, value) = config.split_once('=')?;
    name.to_ascii_lowercase()
        .strip_prefix("alias.")
        .map(|alias| (alias.to_string(), value.to_string()))
}

#[derive(Clone, Copy)]
enum GitIdentitySource {
    CurrentEnvironment,
    PreservedAuthor,
    UninspectablePayload,
}

fn guarded_git_subcommand(subcommand: &str) -> Option<(GitGuardOperation, GitIdentitySource)> {
    match subcommand {
        "push" => Some((
            GitGuardOperation::Push,
            GitIdentitySource::CurrentEnvironment,
        )),
        "commit" | "commit-tree" | "merge" | "notes" | "revert" | "stash" | "tag" => Some((
            GitGuardOperation::Commit,
            GitIdentitySource::CurrentEnvironment,
        )),
        "am" | "cherry-pick" | "pull" | "rebase" => Some((
            GitGuardOperation::Commit,
            GitIdentitySource::PreservedAuthor,
        )),
        "fast-import" | "filter-branch" | "mktag" => Some((
            GitGuardOperation::Commit,
            GitIdentitySource::UninspectablePayload,
        )),
        _ => None,
    }
}

fn mark_author_uninspectable(identity: &mut GitIdentityOverrides) {
    identity.author_name = Some(String::new());
    identity.author_email = Some(String::new());
    identity.author_name_from_env = true;
    identity.author_email_from_env = true;
}

fn mark_identity_uninspectable(identity: &mut GitIdentityOverrides) {
    mark_author_uninspectable(identity);
    identity.committer_name = Some(String::new());
    identity.committer_email = Some(String::new());
    identity.committer_name_from_env = true;
    identity.committer_email_from_env = true;
}

fn apply_explicit_commit_author(value: &str, identity: &mut GitIdentityOverrides) {
    let value = value.trim();
    let parsed = value
        .strip_suffix('>')
        .and_then(|without_end| without_end.rsplit_once('<'))
        .map(|(name, email)| (name.trim(), email.trim()))
        .filter(|(name, email)| !name.is_empty() && !email.is_empty());
    if let Some((name, email)) = parsed {
        identity.author_name = Some(name.to_string());
        identity.author_email = Some(email.to_string());
        identity.author_name_from_env = true;
        identity.author_email_from_env = true;
    } else {
        // Git also accepts an author search pattern and resolves it from an
        // existing commit. That result cannot be known without executing Git.
        mark_author_uninspectable(identity);
    }
}

fn apply_commit_identity_options(
    args: &[String],
    identity: &mut GitIdentityOverrides,
) -> Result<(), String> {
    let baseline_author = (
        identity.author_name.clone(),
        identity.author_email.clone(),
        identity.author_name_from_env,
        identity.author_email_from_env,
    );
    let mut index = 0;
    while index < args.len() {
        let option = args[index].as_str();
        if matches!(option, ";" | "&&" | "||" | "|" | "&" | "(" | ")") {
            break;
        }
        match option {
            "--author" => {
                index += 1;
                let value = args
                    .get(index)
                    .ok_or_else(|| "git commit --author is missing its value".to_string())?;
                apply_explicit_commit_author(value, identity);
            }
            value if value.starts_with("--author=") => {
                apply_explicit_commit_author(value.trim_start_matches("--author="), identity);
            }
            "-C" | "-c" | "--reuse-message" | "--reedit-message" => {
                index += 1;
                if index >= args.len() {
                    return Err(format!("git commit option {option} is missing its commit"));
                }
                mark_author_uninspectable(identity);
            }
            value if (value.starts_with("-C") || value.starts_with("-c")) && value.len() > 2 => {
                mark_author_uninspectable(identity);
            }
            value
                if value.starts_with("--reuse-message=")
                    || value.starts_with("--reedit-message=") =>
            {
                mark_author_uninspectable(identity);
            }
            "--amend" => mark_author_uninspectable(identity),
            "--reset-author" => {
                identity.author_name = baseline_author.0.clone();
                identity.author_email = baseline_author.1.clone();
                identity.author_name_from_env = baseline_author.2;
                identity.author_email_from_env = baseline_author.3;
            }
            _ => {}
        }
        index += 1;
    }
    Ok(())
}

fn safe_git_subcommand(subcommand: &str) -> bool {
    matches!(
        subcommand,
        "add"
            | "annotate"
            | "apply"
            | "archive"
            | "bisect"
            | "blame"
            | "branch"
            | "bugreport"
            | "bundle"
            | "checkout"
            | "clean"
            | "clone"
            | "column"
            | "config"
            | "count-objects"
            | "credential"
            | "credential-cache"
            | "credential-store"
            | "describe"
            | "diff"
            | "diff-files"
            | "diff-index"
            | "diff-tree"
            | "difftool"
            | "fetch"
            | "for-each-ref"
            | "fsck"
            | "gc"
            | "grep"
            | "hash-object"
            | "help"
            | "init"
            | "log"
            | "ls-files"
            | "ls-remote"
            | "ls-tree"
            | "maintenance"
            | "merge-base"
            | "mergetool"
            | "mktree"
            | "mv"
            | "name-rev"
            | "pack-objects"
            | "prune"
            | "range-diff"
            | "read-tree"
            | "reflog"
            | "remote"
            | "repack"
            | "replace"
            | "reset"
            | "restore"
            | "rev-list"
            | "rev-parse"
            | "rm"
            | "show"
            | "show-branch"
            | "sparse-checkout"
            | "status"
            | "submodule"
            | "switch"
            | "symbolic-ref"
            | "update-index"
            | "update-ref"
            | "var"
            | "verify-commit"
            | "verify-pack"
            | "verify-tag"
            | "version"
            | "whatchanged"
            | "worktree"
    )
}

fn looks_like_protected_git(command: &str) -> bool {
    let words: Vec<String> = command
        .to_ascii_lowercase()
        .split(|ch: char| !ch.is_ascii_alphanumeric() && !matches!(ch, '-' | '_'))
        .filter(|word| !word.is_empty())
        .map(String::from)
        .collect();
    words.iter().any(|word| {
        word.strip_prefix("git-")
            .is_some_and(|subcommand| guarded_git_subcommand(subcommand).is_some())
    }) || words.iter().any(|word| word == "git")
        && words
            .iter()
            .any(|word| guarded_git_subcommand(word).is_some())
}

/// Parse protected Git invocations from a shell command without executing it.
/// Common global options and command-local identity overrides are retained so
/// the server evaluates the identity the command would actually use.
fn parse_git_guard_requests(command: &str) -> Result<Vec<GitGuardRequest>, String> {
    parse_git_guard_requests_inner(command, 0, GitIdentityOverrides::default())
}

fn parse_git_guard_requests_inner(
    command: &str,
    recursion_depth: usize,
    inherited_identity: GitIdentityOverrides,
) -> Result<Vec<GitGuardRequest>, String> {
    let normalized_command = separate_shell_operators(command);
    let Some(tokens) = shlex::split(&normalized_command) else {
        return if looks_like_protected_git(command) {
            Err("unable to safely parse protected Git command".to_string())
        } else {
            Ok(Vec::new())
        };
    };
    let substitutions = command_substitution_sources(command)?;
    let mut requests = Vec::new();

    for (git_index, token) in tokens.iter().enumerate() {
        let executable = command_token(token);
        let direct_subcommand = match executable {
            "git" => None,
            value
                if value
                    .strip_prefix("git-")
                    .is_some_and(|subcommand| guarded_git_subcommand(subcommand).is_some()) =>
            {
                value.strip_prefix("git-")
            }
            _ => continue,
        };
        let segment_start = shell_segment_start(&tokens, git_index);
        let prefix = &tokens[segment_start..git_index];
        if !allowed_git_prefix(prefix) {
            if looks_like_protected_git(command) {
                return Err(
                    "protected Git invocation uses an execution wrapper the hook cannot model safely"
                        .to_string(),
                );
            }
            continue;
        }

        let mut identity = inherited_identity.clone();
        apply_prefix_identity(prefix, &mut identity)?;

        if let Some(subcommand) = direct_subcommand {
            let (operation, source) = guarded_git_subcommand(subcommand)
                .expect("direct guarded Git subcommand was checked above");
            match source {
                GitIdentitySource::CurrentEnvironment => {}
                GitIdentitySource::PreservedAuthor => mark_author_uninspectable(&mut identity),
                GitIdentitySource::UninspectablePayload => {
                    mark_identity_uninspectable(&mut identity)
                }
            }
            if subcommand == "commit" {
                apply_commit_identity_options(&tokens[git_index + 1..], &mut identity)?;
            }
            requests.push(identity.request(operation));
            continue;
        }

        let mut index = git_index + 1;
        let mut operation = None;
        let mut aliases: Vec<(String, String)> = Vec::new();
        let mut expanded_alias_requests = Vec::new();
        while index < tokens.len() {
            let token = tokens[index].as_str();
            if matches!(token, ";" | "&&" | "||" | "|" | "&" | "(" | ")") {
                break;
            }
            match token {
                "-C" | "--git-dir" | "--work-tree" | "--namespace" | "--super-prefix"
                | "--exec-path" => {
                    index += 1;
                    if index >= tokens.len() {
                        return Err(format!("Git option {token} is missing its value"));
                    }
                }
                "-c" => {
                    index += 1;
                    let Some(config) = tokens.get(index) else {
                        return Err("Git option -c is missing its value".to_string());
                    };
                    apply_git_config(config, &mut identity);
                    if let Some(alias) = git_alias(config) {
                        aliases.push(alias);
                    }
                }
                value if value.starts_with("--config-env=") => {
                    let config = value.trim_start_matches("--config-env=");
                    let Some((name, env_name)) = config.split_once('=') else {
                        return Err("Git --config-env is malformed".to_string());
                    };
                    let env_value = prefix
                        .iter()
                        .filter_map(|token| assignment(token))
                        .find_map(|(candidate, value)| (candidate == env_name).then_some(value))
                        .map(String::from)
                        .or_else(|| std::env::var(env_name).ok())
                        .ok_or_else(|| format!("Git --config-env references missing {env_name}"))?;
                    apply_git_config(&format!("{name}={env_value}"), &mut identity);
                }
                value
                    if value.starts_with("--git-dir=")
                        || value.starts_with("--work-tree=")
                        || value.starts_with("--namespace=")
                        || value.starts_with("--super-prefix=")
                        || value.starts_with("--exec-path=") => {}
                value if value.starts_with('-') => {}
                value => {
                    let subcommand =
                        value.trim_matches(|ch: char| matches!(ch, ';' | '&' | '|' | '(' | ')'));
                    operation = match guarded_git_subcommand(subcommand) {
                        Some((operation, source)) => {
                            match source {
                                GitIdentitySource::CurrentEnvironment => {}
                                GitIdentitySource::PreservedAuthor => {
                                    mark_author_uninspectable(&mut identity)
                                }
                                GitIdentitySource::UninspectablePayload => {
                                    mark_identity_uninspectable(&mut identity)
                                }
                            }
                            if subcommand == "commit" {
                                apply_commit_identity_options(&tokens[index + 1..], &mut identity)?;
                            }
                            Some(operation)
                        }
                        None if safe_git_subcommand(subcommand) => None,
                        None => {
                            let alias = subcommand;
                            let Some((_, expansion)) =
                                aliases.iter().rev().find(|(name, _)| name == alias)
                            else {
                                return Err(format!(
                                    "cannot verify whether unknown Git subcommand {alias} is a protected alias"
                                ));
                            };
                            if recursion_depth >= 3 {
                                return Err(
                                    "Git alias expansion exceeds inspection depth".to_string()
                                );
                            }
                            let alias_source = expansion
                                .strip_prefix('!')
                                .map(String::from)
                                .unwrap_or_else(|| format!("git {expansion}"));
                            expanded_alias_requests = parse_git_guard_requests_inner(
                                &alias_source,
                                recursion_depth + 1,
                                identity.clone(),
                            )?;
                            None
                        }
                    };
                    break;
                }
            }
            index += 1;
        }
        if let Some(operation) = operation {
            requests.push(identity.request(operation));
        }
        requests.extend(expanded_alias_requests);
    }

    // Shell wrappers receive their command as one quoted token. Parse that
    // source recursively so `sh -c`/`bash -lc` cannot hide a protected Git
    // invocation from the outer hook payload.
    if recursion_depth < 3 {
        for substitution in substitutions {
            requests.extend(parse_git_guard_requests_inner(
                &substitution,
                recursion_depth + 1,
                inherited_identity.clone(),
            )?);
        }
        for (shell_index, token) in tokens.iter().enumerate() {
            if !matches!(command_token(token), "sh" | "bash" | "dash" | "zsh") {
                continue;
            }
            let segment_start = shell_segment_start(&tokens, shell_index);
            let prefix = &tokens[segment_start..shell_index];
            if !allowed_git_prefix(prefix) {
                if looks_like_protected_git(command) {
                    return Err("protected Git shell wrapper cannot be modeled safely".to_string());
                }
                continue;
            }
            let mut shell_identity = inherited_identity.clone();
            apply_prefix_identity(prefix, &mut shell_identity)?;
            let mut index = shell_index + 1;
            while index < tokens.len() {
                let option = tokens[index].as_str();
                if matches!(option, ";" | "|" | "&" | "(" | ")") {
                    break;
                }
                if option.starts_with('-') {
                    if option.trim_start_matches('-').contains('c') {
                        let script = tokens.get(index + 1).ok_or_else(|| {
                            format!("shell option {option} is missing its command")
                        })?;
                        requests.extend(parse_git_guard_requests_inner(
                            script,
                            recursion_depth + 1,
                            shell_identity.clone(),
                        )?);
                        break;
                    }
                    index += 1;
                    continue;
                }
                break;
            }
        }
        for (eval_index, token) in tokens.iter().enumerate() {
            if command_token(token) != "eval" {
                continue;
            }
            let segment_start = shell_segment_start(&tokens, eval_index);
            if !allowed_git_prefix(&tokens[segment_start..eval_index]) {
                if looks_like_protected_git(command) {
                    return Err("protected Git eval wrapper cannot be modeled safely".to_string());
                }
                continue;
            }
            let mut eval_identity = inherited_identity.clone();
            apply_prefix_identity(&tokens[segment_start..eval_index], &mut eval_identity)?;
            let script = tokens[eval_index + 1..]
                .iter()
                .take_while(|token| {
                    !matches!(token.as_str(), ";" | "&&" | "||" | "|" | "&" | "(" | ")")
                })
                .filter(|token| token.as_str() != "--")
                .cloned()
                .collect::<Vec<_>>()
                .join(" ");
            if script.is_empty() {
                return Err("eval is missing its command".to_string());
            }
            requests.extend(parse_git_guard_requests_inner(
                &script,
                recursion_depth + 1,
                eval_identity,
            )?);
        }
    } else if substitutions
        .iter()
        .any(|source| looks_like_protected_git(source))
    {
        return Err("command substitution exceeds inspection depth".to_string());
    }

    if requests.is_empty() && looks_like_protected_git(command) {
        return Err(
            "protected Git text appears in an execution form the hook cannot model safely"
                .to_string(),
        );
    }
    Ok(requests)
}

/// Inspect a parsed shell tool payload for git pushes of interest.
fn inspect_bash_payload(payload: &serde_json::Value) -> Option<BashInspection> {
    let commands = shell_commands(payload).ok()?;
    if commands.is_empty() {
        return None;
    }
    let command = commands.join("; ");
    let is_git_push = commands.iter().any(|source| {
        parse_git_guard_requests(source).is_ok_and(|requests| {
            requests
                .iter()
                .any(|request| request.operation == GitGuardOperation::Push)
        })
    });
    // If no explicit branch (bare `git push` or `git push origin`), assume it may target main
    let targets_main = is_git_push
        && extract_branch_from_push(&command).is_none_or(|b| b == "main" || b == "master");
    Some(BashInspection {
        command,
        targets_main,
    })
}

// ── Mention token stripping ─────────────────────────────────────────

/// Replace `@<sid:UUID>` mention tokens with `@<short-id>` for human-readable output.
fn strip_mention_tokens(body: &str) -> String {
    const PREFIX: &str = "@<sid:";
    const SUFFIX: char = '>';
    const UUID_LEN: usize = 36; // e.g. 550e8400-e29b-41d4-a716-446655440000

    let mut result = String::with_capacity(body.len());
    let mut rest = body;

    while let Some(start) = rest.find(PREFIX) {
        result.push_str(&rest[..start]);
        let after_prefix = &rest[start + PREFIX.len()..];
        if after_prefix.len() > UUID_LEN && after_prefix.as_bytes()[UUID_LEN] == SUFFIX as u8 {
            // Replace with @<first-8-chars-of-uuid>
            result.push('@');
            result.push_str(&after_prefix[..8]);
            rest = &after_prefix[UUID_LEN + 1..];
        } else {
            // Not a valid token, keep the prefix literal
            result.push_str(PREFIX);
            rest = after_prefix;
        }
    }
    result.push_str(rest);
    result
}

/// [x386 hardening] Strip control/escape characters from a peer-derived string
/// before rendering it to a peer's TUI digest. The digest is machine-read by
/// peer agents AND printed to a terminal, so a crafted note/branch/name
/// containing raw ANSI/OSC escapes (e.g. `\x1b]0;...\x07`) or embedded newlines
/// could spoof "⚠ COLLISION" / section-header lines or hijack the terminal.
/// We drop every C0 control byte (0x00–0x1f, which includes ESC 0x1b, CR, LF)
/// and DEL (0x7f); the surviving text is inert. The replacement leaves the ESC
/// gone so an OSC/CSI sequence degrades to harmless literal characters.
fn sanitize_for_digest(s: &str) -> String {
    s.chars().filter(|c| !c.is_control()).collect()
}

// ── Status reporting ────────────────────────────────────────────────

/// Report an agent activity status to the terminal server.
/// Silently returns if no session ID is available.
async fn report_status(client: &Client, status: &str) {
    if let Err(error) = deliver_status_with_source(client, status, None).await {
        eprintln!("warning: failed to report {status} status: {error}");
    }
}

/// Report an agent activity status with an optional `source` tag.
///
/// [remote-dev-1aa5c] The SubagentStop hook posts "running" with
/// `source=subagent-stop` so the server only lets it replace an active
/// running/subagent state, never waiting, compacting, idle, error, or ended. A
/// legitimately new turn re-asserts running through an untagged hook. Kept
/// consistent with the curl fallback (`curlForStatus(status, "subagent-stop")`).
async fn report_status_with_source(client: &Client, status: &str, source: Option<&str>) {
    if let Err(error) = deliver_status_with_source(client, status, source).await {
        eprintln!("warning: failed to report {status} status: {error}");
    }
}

/// Deliver a status and preserve transport/server failures for Codex's shell
/// wrapper, which then executes its authenticated curl fallback.
async fn deliver_status_with_source(
    client: &Client,
    status: &str,
    source: Option<&str>,
) -> Result<(), Box<dyn std::error::Error>> {
    let sid = client.session_id().ok_or("RDV_SESSION_ID not set")?;
    let generation = std::env::var("RDV_AGENT_GENERATION").unwrap_or_else(|_| "0".to_string());
    let mut query: Vec<(&str, &str)> = vec![
        ("sessionId", sid),
        ("generation", generation.as_str()),
        ("status", status),
    ];
    if let Some(src) = source {
        query.push(("source", src));
    }
    let delivery_id = std::env::var("RDV_HOOK_DELIVERY_ID").ok();
    if let Some(id) = delivery_id.as_deref() {
        query.push(("deliveryId", id));
    }
    client
        .post_empty_with_query_timeout(
            "/internal/agent-status",
            &query,
            std::time::Duration::from_secs(2),
        )
        .await?;
    Ok(())
}

async fn deliver_status_for_wire(
    client: &Client,
    status: &str,
    source: Option<&str>,
    wire_format: StopWireFormat,
) -> Result<(), Box<dyn std::error::Error>> {
    if wire_format == StopWireFormat::Codex {
        deliver_status_with_source(client, status, source).await
    } else {
        report_status_with_source(client, status, source).await;
        Ok(())
    }
}

// ── Peer digest ─────────────────────────────────────────────────────

// [x386.12] Start-digest section headers (em-dash rules).
const TEAM_HEADER: &str = "\u{2500}\u{2500} Team (who's working on what) \u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}";
const GOTCHA_HEADER: &str = "\u{2500}\u{2500} Recent gotchas \u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}";
const MESSAGES_HEADER: &str = "\u{2500}\u{2500} New messages \u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}";
const SECTION_RULE: &str = "\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}";

/// [x386.12/.14] Read-peers START DIGEST printed to stderr at the first
/// PreToolUse so the agent reads it before acting. Three sections:
///   - Team: who's-working-on-what (work-context + claimed bd issues)
///   - Recent gotchas: tagged notes from #agents (`rdv peer note`)
///   - Collisions: another active session on the same branch/worktree/issue
///   - New messages: durable-cursor backlog (auto-acked)
///
/// The heavy joins live server-side (`/internal/peers/digest`); this renders
/// the payload. The "New messages" section uses the durable cursor so repeated
/// calls don't re-show the same items.
#[derive(Default)]
struct PeerDigestOutput {
    context: String,
    message_ids: Vec<String>,
}

async fn collect_peer_digest(client: &Client) -> PeerDigestOutput {
    let Some(sid) = client.session_id() else {
        return PeerDigestOutput::default();
    };
    let mut lines = Vec::new();

    let digest_query = [("sessionId", sid)];
    let digest: Result<serde_json::Value, _> = client
        .get_with_query("/internal/peers/digest", &digest_query)
        .await;
    if let Ok(d) = &digest {
        if let Some(peers) = d.get("peers").and_then(|v| v.as_array()) {
            if !peers.is_empty() {
                lines.push(TEAM_HEADER.to_string());
                for peer in peers {
                    let name = sanitize_for_digest(
                        peer.get("name")
                            .and_then(|v| v.as_str())
                            .unwrap_or("unknown"),
                    );
                    let status = sanitize_for_digest(
                        peer.get("status")
                            .and_then(|v| v.as_str())
                            .unwrap_or("unknown"),
                    );
                    let branch = sanitize_for_digest(
                        peer.get("branch").and_then(|v| v.as_str()).unwrap_or(""),
                    );
                    let issue_id = peer
                        .get("claimedIssueId")
                        .and_then(|v| v.as_str())
                        .map(sanitize_for_digest);
                    let issue_title = peer
                        .get("claimedIssueTitle")
                        .and_then(|v| v.as_str())
                        .map(sanitize_for_digest);
                    let work = match (issue_id.as_deref(), issue_title.as_deref()) {
                        (Some(id), Some(title)) => format!(" \u{b7} {id} {title}"),
                        (Some(id), None) => format!(" \u{b7} {id}"),
                        _ => " \u{b7} (no claimed issue)".to_string(),
                    };
                    let branch_part = if branch.is_empty() {
                        String::new()
                    } else {
                        format!(" {branch}")
                    };
                    lines.push(format!("  {name} [{status}]{branch_part}{work}"));
                }
                lines.push(SECTION_RULE.to_string());
            }
        }

        if let Some(gotchas) = d.get("gotchas").and_then(|v| v.as_array()) {
            if !gotchas.is_empty() {
                lines.push(GOTCHA_HEADER.to_string());
                for gotcha in gotchas {
                    let from = sanitize_for_digest(
                        gotcha
                            .get("from")
                            .and_then(|v| v.as_str())
                            .unwrap_or("peer"),
                    );
                    let raw_body = gotcha.get("body").and_then(|v| v.as_str()).unwrap_or("");
                    let body = sanitize_for_digest(&strip_mention_tokens(raw_body));
                    lines.push(format!("  \u{26a0} {from}: {body}"));
                }
                lines.push(SECTION_RULE.to_string());
            }
        }

        if let Some(collisions) = d.get("collisions").and_then(|v| v.as_array()) {
            for collision in collisions {
                let peer_name = sanitize_for_digest(
                    collision
                        .get("peerName")
                        .and_then(|v| v.as_str())
                        .unwrap_or("a peer"),
                );
                let reason = sanitize_for_digest(
                    collision
                        .get("reason")
                        .and_then(|v| v.as_str())
                        .unwrap_or("work"),
                );
                let value = sanitize_for_digest(
                    collision
                        .get("value")
                        .and_then(|v| v.as_str())
                        .unwrap_or(""),
                );
                lines.push(format!(
                    "\u{26a0} COLLISION: {peer_name} shares your {reason} {value} \u{2014} coordinate before pushing."
                ));
            }
        }
    }

    let mut message_ids = Vec::new();
    let msg_query = [("sessionId", sid), ("cursor", "durable")];
    let messages_result: Result<serde_json::Value, _> = client
        .get_with_query("/internal/peers/messages/poll", &msg_query)
        .await;
    if let Ok(resp) = messages_result {
        if let Some(messages) = resp.get("messages").and_then(|v| v.as_array()) {
            if !messages.is_empty() {
                lines.push(MESSAGES_HEADER.to_string());
                message_ids.extend(
                    messages
                        .iter()
                        .filter_map(|message| message.get("id").and_then(|v| v.as_str()))
                        .map(String::from),
                );
                for message in messages {
                    let from = sanitize_for_digest(
                        message
                            .get("fromSessionName")
                            .and_then(|v| v.as_str())
                            .unwrap_or("unknown"),
                    );
                    let raw_body = message.get("body").and_then(|v| v.as_str()).unwrap_or("");
                    let body = sanitize_for_digest(&strip_mention_tokens(raw_body));
                    let target = if message.get("toSessionId").is_none_or(|v| v.is_null()) {
                        " (broadcast)"
                    } else {
                        ""
                    };
                    lines.push(format!("\u{1f4e8} {from}{target}: {body}"));
                }
                lines.push(SECTION_RULE.to_string());
            }
        }
    }

    PeerDigestOutput {
        context: lines.join("\n"),
        message_ids,
    }
}

async fn acknowledge_peer_digest(client: &Client, digest: &PeerDigestOutput) {
    if digest.message_ids.is_empty() {
        return;
    }
    let Some(sid) = client.session_id() else {
        return;
    };
    let ack = json!({ "sessionId": sid, "messageIds": digest.message_ids });
    let _ = client.post_json("/internal/peers/ack-batch", &ack).await;
}

async fn print_peer_digest(client: &Client) {
    let digest = collect_peer_digest(client).await;
    if !digest.context.is_empty() {
        eprintln!("{}", digest.context);
        acknowledge_peer_digest(client, &digest).await;
    }
}

// ── Peer broadcasts ─────────────────────────────────────────────────

/// Extract the branch name from a `git push` command string.
/// Returns the remote-tracking branch if present, otherwise None.
fn extract_branch_from_push(command: &str) -> Option<String> {
    // Parse patterns like: git push origin main, git push origin feature/foo
    let parts: Vec<&str> = command.split_whitespace().collect();
    // Find "push" in the args, then look for remote and branch
    let push_idx = parts.iter().position(|&w| w == "push")?;
    // Skip flags (starting with -)
    let mut args_after_push = parts[push_idx + 1..].iter().filter(|w| !w.starts_with('-'));
    let _remote = args_after_push.next()?; // e.g. "origin"
    let branch = args_after_push.next()?; // e.g. "main"
                                          // Handle refspec like "local:remote"
    let branch_name = if let Some((_local, remote)) = branch.split_once(':') {
        remote
    } else {
        branch
    };
    Some(branch_name.to_string())
}

/// Fire-and-forget broadcast when git push to main/master detected.
async fn broadcast_git_push_to_peers(client: &Client, command: &str) {
    let Some(sid) = client.session_id() else {
        return;
    };
    let body = match extract_branch_from_push(command) {
        Some(branch) => format!("pushed to {branch} \u{2014} you may need to rebase"),
        None => "pushed (branch unspecified) \u{2014} you may need to rebase".to_string(),
    };
    let payload = json!({ "fromSessionId": sid, "body": body });
    let _ = client
        .post_json("/internal/peers/messages/send", &payload)
        .await;
}

/// [x386.6] Check IN once per session (sentinel at /tmp/rdv-peer-start-{sid}).
/// Posts a structured check-in to the per-project #agents channel — branch +
/// claimed bd issue (omitted when the loose join has no confidence) — so peers
/// see who joined and what they're on. Replaces the old "session started"
/// broadcast. bd remains the work tracker; this is awareness only.
async fn broadcast_session_start(client: &Client) {
    let Some(sid) = client.session_id() else {
        return;
    };
    let sentinel = format!("/tmp/rdv-peer-start-{sid}");
    if std::fs::metadata(&sentinel).is_ok() {
        return;
    }
    let _ = std::fs::write(&sentinel, "1");

    // Fetch work-context to enrich the check-in (best-effort).
    let ctx_query = [("sessionId", sid)];
    let ctx: Option<serde_json::Value> = client
        .get_with_query::<serde_json::Value, _>("/internal/work-context", &ctx_query)
        .await
        .ok()
        .and_then(|v| v.get("context").cloned());

    let body = build_checkin_body(ctx.as_ref());
    let payload = json!({ "fromSessionId": sid, "channelName": "agents", "body": body });
    let _ = client.post_json("/internal/channels/send", &payload).await;
}

/// Build the check-in message body from an optional work-context payload.
fn build_checkin_body(ctx: Option<&serde_json::Value>) -> String {
    let branch = ctx
        .and_then(|c| c.get("branch"))
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty());
    let confidence = ctx
        .and_then(|c| c.get("joinConfidence"))
        .and_then(|v| v.as_str())
        .unwrap_or("none");
    let issue_id = ctx
        .and_then(|c| c.get("claimedIssueId"))
        .and_then(|v| v.as_str());

    let branch_part = match branch {
        Some(b) => format!(" \u{2014} branch {b}"),
        None => String::new(),
    };
    // Only mention the issue when the join is confident (omit on "none").
    let issue_part = match (confidence, issue_id) {
        ("none", _) | (_, None) => String::new(),
        (_, Some(id)) => format!(", working on {id}"),
    };
    format!("checked in{branch_part}{issue_part}")
}

// ── Proxy state reporting ───────────────────────────────────────────

/// Report the active ANTHROPIC_BASE_URL and API key prefix to the server.
/// When ANTHROPIC_BASE_URL is unset, reports the default (https://api.anthropic.com)
/// since that is the actual endpoint Claude Code will use.
/// Uses a sentinel file to only report when state changes.
async fn report_proxy_state(client: &Client) {
    let Some(sid) = client.session_id() else {
        return;
    };

    const DEFAULT_ANTHROPIC_URL: &str = "https://api.anthropic.com";

    let has_key = std::env::var("ANTHROPIC_API_KEY").is_ok();
    // Skip entirely if no API key is set (agent won't be calling any API)
    if !has_key {
        return;
    }

    let api_key = std::env::var("ANTHROPIC_API_KEY").unwrap_or_default();
    let base_url =
        std::env::var("ANTHROPIC_BASE_URL").unwrap_or_else(|_| DEFAULT_ANTHROPIC_URL.to_string());
    let key_prefix: String = api_key.chars().take(12).collect();

    // Sentinel: only report on change
    let sentinel = format!("/tmp/rdv-proxy-state-{sid}");
    let current = format!("{base_url}|{key_prefix}");
    if std::fs::read_to_string(&sentinel).unwrap_or_default() == current {
        return;
    }

    let payload = json!({
        "sessionId": sid,
        "baseUrl": base_url,
        "keyPrefix": key_prefix,
        "apiKey": api_key,
    });

    if client
        .post_json("/internal/proxy-state", &payload)
        .await
        .is_ok()
    {
        let _ = std::fs::write(&sentinel, &current);
    }
}

// ── Git identity guard ──────────────────────────────────────────────

/// Check whether protected Git invocations would leak identity. `Ok(None)` is
/// reserved for non-Git/allowed commands; lookup and schema failures are errors
/// so callers can fail closed rather than confusing an outage with approval.
async fn check_git_identity_guard(
    client: &Client,
    payload: &serde_json::Value,
) -> Result<Option<String>, String> {
    let commands = shell_commands(payload)?;
    let mut requests = Vec::new();
    for command in commands {
        requests.extend(parse_git_guard_requests(&command)?);
    }
    if requests.is_empty() {
        return Ok(None);
    }

    let sid = client
        .session_id()
        .ok_or_else(|| "missing RDV session identity".to_string())?;

    // Get the session's project and folder IDs
    #[derive(serde::Deserialize)]
    struct SessionInfo {
        #[serde(rename = "projectId")]
        project_id: Option<String>,
        #[serde(rename = "folderId")]
        folder_id: Option<String>,
    }

    let session: SessionInfo = client
        .get(&format!("/api/sessions/{sid}"))
        .await
        .map_err(|error| format!("session lookup failed: {error}"))?;

    // The owner-scoped server lookup is authoritative. Do not trust a profile
    // or tool environment override to redirect policy to another project.
    let project_id = session
        .project_id
        .or(session.folder_id)
        .ok_or_else(|| "session has no project identity".to_string())?;

    // Read git identity from environment (set by session-service)
    let proposed_author_name = std::env::var("GIT_AUTHOR_NAME").unwrap_or_default();
    let proposed_author_email = std::env::var("GIT_AUTHOR_EMAIL").unwrap_or_default();
    let proposed_committer_name = std::env::var("GIT_COMMITTER_NAME").unwrap_or_default();
    let proposed_committer_email = std::env::var("GIT_COMMITTER_EMAIL").unwrap_or_default();

    // Always call the guard API — the server determines if the folder is sensitive
    // even when no identity env vars are set (which is the most dangerous case)
    #[derive(serde::Deserialize)]
    struct GuardResult {
        risk: String,
        reason: Option<String>,
    }

    for request in requests {
        let guard_payload = json!({
            "proposedAuthorName": request.proposed_author_name.as_deref().unwrap_or(&proposed_author_name),
            "proposedAuthorEmail": request.proposed_author_email.as_deref().unwrap_or(&proposed_author_email),
            "proposedCommitterName": request.proposed_committer_name.as_deref().unwrap_or(&proposed_committer_name),
            "proposedCommitterEmail": request.proposed_committer_email.as_deref().unwrap_or(&proposed_committer_email),
            "operation": request.operation.as_str(),
        });
        let value = client
            .post_json(
                &format!("/api/projects/{project_id}/git-guard"),
                &guard_payload,
            )
            .await
            .map_err(|error| format!("policy lookup failed: {error}"))?;
        let result: GuardResult = serde_json::from_value(value)
            .map_err(|error| format!("policy response was invalid: {error}"))?;

        match result.risk.as_str() {
            "block" => {
                return Ok(Some(result.reason.unwrap_or_else(|| {
                    "Git identity policy blocked this commit or push".to_string()
                })))
            }
            "warn" => {
                return Ok(Some(result.reason.unwrap_or_else(|| {
                    "Git identity policy could not prove this commit or push is safe".to_string()
                })))
            }
            "none" => {}
            risk => return Err(format!("policy response used unknown risk {risk:?}")),
        }
    }
    Ok(None)
}

// ── Beads check ────────────────────────────────────────────────────

/// Check if there are in-progress beads issues.
/// Returns Some(message) if unfinished work found, None otherwise.
async fn check_beads_unfinished() -> Option<String> {
    // Check if .beads/ directory exists in current working directory
    if !std::path::Path::new(".beads").exists() {
        return None;
    }

    // Run bd list to check for in-progress issues
    let mut command = tokio::process::Command::new("bd");
    command
        .args(["list", "--status=in_progress", "--json", "--quiet"])
        .kill_on_drop(true);
    let output =
        match tokio::time::timeout(std::time::Duration::from_secs(2), command.output()).await {
            Ok(Ok(output)) => output,
            Ok(Err(_)) | Err(_) => return None, // unavailable or stalled: don't block Stop
        };

    if !output.status.success() {
        return None; // bd command failed, don't block stop
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stdout = stdout.trim();
    if stdout.is_empty() || stdout == "[]" || stdout == "null" {
        return None;
    }

    // Parse the JSON to get issue titles
    if let Ok(issues) = serde_json::from_str::<Vec<serde_json::Value>>(stdout) {
        if issues.is_empty() {
            return None;
        }
        let mut msg = format!(
            "You have {} in-progress beads issue(s) that should be completed or updated before stopping:\n\n",
            issues.len()
        );
        for issue in &issues {
            let id = issue.get("id").and_then(|v| v.as_str()).unwrap_or("?");
            let title = issue
                .get("title")
                .and_then(|v| v.as_str())
                .unwrap_or("Untitled");
            msg.push_str(&format!("- [{id}] {title}\n"));
        }
        msg.push_str(
            "\nPlease complete or close these issues with `bd close <id>`, then try stopping again.",
        );
        Some(msg)
    } else {
        None
    }
}

// ── Stop handler ────────────────────────────────────────────────────

/// Handle agent stop: report idle, notify, broadcast to peers.
/// Returns Ok(()) early if no session ID is available.
/// If beads has in-progress issues, prints them to stdout (which tells Claude Code
/// to continue working) and returns early without reporting idle.
async fn handle_stop(
    client: &Client,
    // [y5ch.2] agent/reason were only used to build the now-removed clean-stop
    // notification. They stay in the signature (callers pass them positionally)
    // but are unused; the leading underscore avoids an unused-variable warning
    // without an #[allow].
    _agent: Option<String>,
    _reason: Option<String>,
    wire_format: StopWireFormat,
    supplied_payload: Option<&serde_json::Value>,
) -> Result<(), Box<dyn std::error::Error>> {
    let Some(sid) = client.session_id() else {
        return Ok(());
    };

    // Safety belt: if older Claude Code versions still route SubagentStop
    // through the Stop hook, or if the payload carries an agent_id, treat it
    // as a subagent stop and skip the notification path. The dedicated
    // SubagentStop hook handler is the primary route — this is fallback.
    let stdin_payload;
    let payload = match supplied_payload {
        Some(payload) => payload,
        None => {
            let mut buf = Vec::new();
            let _ = std::io::stdin().read_to_end(&mut buf);
            stdin_payload = serde_json::from_slice(&buf).unwrap_or(serde_json::Value::Null);
            &stdin_payload
        }
    };
    let hook_event = payload
        .get("hook_event_name")
        .and_then(|v| v.as_str())
        .unwrap_or("Stop");
    if hook_event == "SubagentStop" || payload.get("agent_id").is_some() {
        // Parent is still active; do not flip to idle and do not notify.
        // [remote-dev-1aa5c] Tag the source so this late child-completion event
        // only replaces an active running/subagent state, never waiting,
        // compacting, idle, error, or ended.
        deliver_status_for_wire(client, "running", Some("subagent-stop"), wire_format).await?;
        return Ok(());
    }

    // Check for unfinished beads work before allowing stop
    if let Some(msg) = check_beads_unfinished().await {
        // Both providers use stdout to continue, but Codex requires structured
        // JSON while the existing Claude hook consumes plain text.
        print!("{}", format_stop_block(wire_format, &msg));
        // Still report running status since agent should continue
        // The structured block is authoritative. A transient status outage
        // must not make the wrapper run its idle fallback and contradict it.
        if let Err(error) = deliver_status_for_wire(client, "running", None, wire_format).await {
            eprintln!("warning: failed to preserve running status for blocked stop: {error}");
        }
        return Ok(());
    }

    // Deliver the authoritative lifecycle state before nonessential peer/API
    // cleanup. A stalled auxiliary request must never consume Codex's outer
    // timeout before the shell fallback has a chance to run.
    deliver_status_for_wire(client, "idle", None, wire_format).await?;

    // Clear peer summary (best effort)
    let clear_summary_payload = json!({ "sessionId": sid, "summary": "" });
    let _ = tokio::time::timeout(
        std::time::Duration::from_secs(2),
        client.post_json("/internal/peers/summary", &clear_summary_payload),
    )
    .await;

    // [y5ch.2] A clean stop is PASSIVE — this CLI does not send a separate
    // direct notification request. The idle status endpoint materializes one
    // coalesced passive agent_complete record, below the default push threshold.
    // The old direct "Session ended normally" POST was the single biggest source
    // of notification noise and remains removed. Stuck/crashed agents now
    // surface via the server-side PID-liveness sweep (y5ch.9, emits agent_stuck),
    // and "agent needs you" surfaces via the Notification hook (waiting status).
    // The idle status report above and the peer check-out below remain.

    // [x386.6] Check OUT to #agents (in-band awareness, not a user notification).
    // Replaces the old "finished work" broadcast with a structured check-out
    // attributed to the agent as a system speaker in the per-project channel.
    let ctx_query = [("sessionId", sid)];
    let branch = tokio::time::timeout(
        std::time::Duration::from_secs(2),
        client.get_with_query::<serde_json::Value, _>("/internal/work-context", &ctx_query),
    )
    .await
    .ok()
    .and_then(Result::ok)
    .and_then(|v| v.get("context").cloned())
    .and_then(|c| c.get("branch").and_then(|v| v.as_str()).map(String::from))
    .filter(|s| !s.is_empty());
    let checkout_body = match branch {
        Some(b) => format!("checked out \u{2014} branch {b}"),
        None => "checked out".to_string(),
    };
    let checkout_payload =
        json!({ "fromSessionId": sid, "channelName": "agents", "body": checkout_body });
    let _ = tokio::time::timeout(
        std::time::Duration::from_secs(2),
        client.post_json("/internal/channels/send", &checkout_payload),
    )
    .await;

    Ok(())
}

const MAX_HOOK_INPUT_BYTES: u64 = 1024 * 1024;
const CODEX_GIT_GUARD_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(3);
const CODEX_ANCILLARY_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(2);
const CODEX_DIGEST_ACK_TIMEOUT: std::time::Duration = std::time::Duration::from_millis(500);
const CLAUDE_ANCILLARY_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(1);
const GIT_GUARD_UNAVAILABLE_REASON: &str =
    "Unable to verify Git identity policy; retry when Remote Dev is available.";
const GIT_GUARD_TIMEOUT_REASON: &str = "Git identity policy lookup timed out; retry the command.";

fn read_hook_payload() -> Result<serde_json::Value, Box<dyn std::error::Error>> {
    let mut bytes = Vec::new();
    std::io::stdin()
        .take(MAX_HOOK_INPUT_BYTES + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() as u64 > MAX_HOOK_INPUT_BYTES {
        return Err("hook input exceeds 1 MiB".into());
    }
    if bytes.is_empty() {
        return Ok(serde_json::Value::Null);
    }
    Ok(serde_json::from_slice(&bytes)?)
}

async fn handle_pre_tool_use_payload(client: &Client, payload: &serde_json::Value) {
    let is_subagent = payload.get("agent_id").is_some();
    let (_, guard_result) = tokio::join!(
        report_status(client, if is_subagent { "subagent" } else { "running" }),
        tokio::time::timeout(
            CODEX_GIT_GUARD_TIMEOUT,
            check_git_identity_guard(client, payload),
        ),
    );
    let denial_reason = match guard_result {
        Ok(Ok(reason)) => reason,
        Ok(Err(error)) => {
            eprintln!("warning: Git identity policy lookup failed: {error}");
            Some(GIT_GUARD_UNAVAILABLE_REASON.to_string())
        }
        Err(_) => {
            eprintln!("warning: git identity guard exceeded its hook deadline");
            Some(GIT_GUARD_TIMEOUT_REASON.to_string())
        }
    };
    if let Some(reason) = denial_reason {
        eprintln!("\u{1f6e1}\u{fe0f}  Git identity guard: {reason}");
        std::process::exit(2);
    }

    if !is_subagent {
        let _ = tokio::time::timeout(CLAUDE_ANCILLARY_TIMEOUT, async {
            print_peer_digest(client).await;
            broadcast_session_start(client).await;
            report_proxy_state(client).await;
        })
        .await;
    }
}

async fn handle_codex_pre_tool_use_payload(
    client: &Client,
    payload: &serde_json::Value,
) -> Result<(), Box<dyn std::error::Error>> {
    let is_subagent = payload.get("agent_id").is_some();
    // Policy enforcement has an independent deadline and runs alongside the
    // bounded lifecycle write. Peer digest/check-in work is intentionally not
    // in this budget: a wedged ancillary endpoint must never bypass the guard.
    let (status_result, guard_result) = tokio::join!(
        deliver_status_with_source(
            client,
            if is_subagent { "subagent" } else { "running" },
            None,
        ),
        tokio::time::timeout(
            CODEX_GIT_GUARD_TIMEOUT,
            check_git_identity_guard(client, payload),
        ),
    );
    let denial_reason = match guard_result {
        Ok(Ok(reason)) => reason,
        Ok(Err(error)) => {
            eprintln!("warning: Git identity policy lookup failed: {error}");
            Some(GIT_GUARD_UNAVAILABLE_REASON.to_string())
        }
        Err(_) => {
            eprintln!("warning: git identity guard exceeded its hook deadline");
            Some(GIT_GUARD_TIMEOUT_REASON.to_string())
        }
    };

    // Emit denials before any best-effort peer work. This keeps policy output
    // available even when peer coordination endpoints are slow or unavailable.
    if let Some(reason) = denial_reason.as_deref() {
        if let Some(response) = format_codex_pre_tool_response(None, Some(reason)) {
            println!("{response}");
            let _ = std::io::stdout().flush();
        }
        return status_result;
    }

    let digest = if is_subagent {
        PeerDigestOutput::default()
    } else {
        tokio::time::timeout(CODEX_ANCILLARY_TIMEOUT, async {
            let digest = collect_peer_digest(client).await;
            broadcast_session_start(client).await;
            report_proxy_state(client).await;
            digest
        })
        .await
        .unwrap_or_default()
    };
    let context = (!digest.context.is_empty()).then_some(digest.context.as_str());
    if let Some(response) = format_codex_pre_tool_response(context, None) {
        println!("{response}");
        let _ = std::io::stdout().flush();
        // Ack only after the structured context has been written for Codex,
        // and never let a stuck acknowledgement hold the calling hook open.
        let _ = tokio::time::timeout(
            CODEX_DIGEST_ACK_TIMEOUT,
            acknowledge_peer_digest(client, &digest),
        )
        .await;
    }
    status_result
}

async fn handle_post_tool_use_payload(client: &Client, payload: &serde_json::Value) {
    if let Some(inspection) = inspect_bash_payload(payload) {
        if inspection.targets_main {
            broadcast_git_push_to_peers(client, &inspection.command).await;
        }
    }
}

/// Drain stdin to prevent blocking the calling process.
fn drain_stdin() {
    let _ = std::io::stdin().read_to_end(&mut Vec::new());
}

// ── Main handler ────────────────────────────────────────────────────

pub async fn run(
    args: HookArgs,
    client: &Client,
    _human: bool,
) -> Result<(), Box<dyn std::error::Error>> {
    match args.command {
        HookCommand::PreToolUse => {
            // Read stdin first so we can discriminate parent vs. subagent tool calls.
            // Claude Code includes `agent_id` in the payload when the hook fires
            // from inside a Task-spawned subagent. Reporting "subagent" instead of
            // "running" lets the sidebar paint a distinct color for delegated work.
            let mut buf = Vec::new();
            let _ = std::io::stdin().read_to_end(&mut buf);
            let payload: serde_json::Value =
                serde_json::from_slice(&buf).unwrap_or(serde_json::Value::Null);
            handle_pre_tool_use_payload(client, &payload).await;
        }
        HookCommand::PostToolUse => {
            // Read stdin, parse as JSON to check for Bash git push
            let mut buf = Vec::new();
            let _ = std::io::stdin().read_to_end(&mut buf);
            let payload: serde_json::Value =
                serde_json::from_slice(&buf).unwrap_or(serde_json::Value::Null);

            handle_post_tool_use_payload(client, &payload).await;
        }
        HookCommand::PreCompact => {
            report_status(client, "compacting").await;
        }
        HookCommand::Notification => {
            report_status(client, "waiting").await;
        }
        HookCommand::Stop { agent, reason } => {
            let wire_format = if agent.as_deref() == Some("codex") {
                StopWireFormat::Codex
            } else {
                StopWireFormat::Claude
            };
            handle_stop(client, agent, reason, wire_format, None).await?;
        }
        HookCommand::Notify {
            event,
            body,
            severity,
        } => {
            let Some(sid) = client.session_id() else {
                return Ok(());
            };

            // [y5ch.8] Forward an explicit severity so an agent can emit a
            // CTA-bearing actionable notice (e.g. a permission-style prompt);
            // defaults to passive/info to keep ad-hoc notifies low-noise.
            let payload = json!({
                "sessionId": sid,
                "type": "info",
                "title": event,
                "body": body.unwrap_or_default(),
                "severity": severity.unwrap_or_else(|| "passive".to_string()),
            });
            let _ = client.post_json("/internal/notify", &payload).await;
        }
        HookCommand::SessionEnd => {
            report_status(client, "ended").await;
        }
        HookCommand::SubagentStop => {
            // A Task subagent finished — the parent agent is about to resume.
            // Report "running" (parent will pick up) and create no notification.
            // Drain stdin to avoid blocking the pipe.
            // [remote-dev-1aa5c] Tag the source so this late child-completion
            // event only replaces an active running/subagent state, never
            // waiting, compacting, idle, error, or ended.
            drain_stdin();
            report_status_with_source(client, "running", Some("subagent-stop")).await;
        }
        HookCommand::Validate => {
            let mut results: Vec<serde_json::Value> = Vec::new();
            let mut all_ok = true;
            let sid = client.session_id();

            // Check 1: RDV_SESSION_ID available
            let has_sid = sid.is_some();
            if !has_sid {
                all_ok = false;
            }
            results.push(if has_sid {
                json!({ "check": "session_id", "status": "ok" })
            } else {
                json!({ "check": "session_id", "status": "fail", "error": "RDV_SESSION_ID not set" })
            });

            // Check 2: terminal server, callback key, and exact generation are
            // valid. This endpoint is deliberately read-only: validation must
            // never overwrite a real waiting/idle/subagent lifecycle state.
            let terminal_check = if let Some(s) = sid {
                let generation =
                    std::env::var("RDV_AGENT_GENERATION").unwrap_or_else(|_| "0".to_string());
                let query = [
                    ("sessionId", s),
                    ("generation", generation.as_str()),
                    ("status", "running"),
                ];
                match client
                    .get_with_query::<serde_json::Value, _>(
                        "/internal/agent-hook-health",
                        &query[..2],
                    )
                    .await
                {
                    Ok(_) => json!({ "check": "terminal_server", "status": "ok" }),
                    Err(e) => {
                        all_ok = false;
                        json!({ "check": "terminal_server", "status": "fail", "error": e.to_string() })
                    }
                }
            } else {
                all_ok = false;
                json!({ "check": "terminal_server", "status": "skip", "reason": "no session ID" })
            };
            results.push(terminal_check);

            let output = json!({
                "valid": all_ok,
                "checks": results,
            });
            println!("{}", serde_json::to_string_pretty(&output)?);

            if !all_ok {
                std::process::exit(1);
            }
        }
        HookCommand::Claude {
            event,
            agent,
            reason,
        } => {
            match event.as_str() {
                "session-start" | "active" | "prompt-submit" => {
                    report_status(client, "running").await;
                    report_proxy_state(client).await;
                    // Peer digest is handled by PreToolUse (Bash matcher) to avoid
                    // duplicate output — the "" matcher fires on ALL tools including Bash.
                    broadcast_session_start(client).await;
                }
                "stop" | "idle" => {
                    handle_stop(client, agent, reason, StopWireFormat::Claude, None).await?;
                }
                "notification" | "notify" => {
                    report_status(client, "waiting").await;
                }
                "compacting" => {
                    report_status(client, "compacting").await;
                }
                "post-tool-use" => {
                    // Drain stdin to prevent blocking the caller (Claude Code pipes data)
                    drain_stdin();
                }
                "session-end" => {
                    report_status(client, "ended").await;
                }
                unknown => {
                    eprintln!("error: unknown claude hook event: {unknown}");
                    std::process::exit(1);
                }
            }
        }
        HookCommand::Codex { event } => {
            let payload = read_hook_payload()?;
            match codex_action(&event, &payload).map_err(std::io::Error::other)? {
                CodexHookAction::Status(status, source) => {
                    deliver_status_with_source(client, status, source).await?;
                    if event == "session-start" {
                        broadcast_session_start(client).await;
                    }
                }
                CodexHookAction::PreToolUse => {
                    handle_codex_pre_tool_use_payload(client, &payload).await?;
                }
                CodexHookAction::PostToolUse => {
                    deliver_status_with_source(client, "running", None).await?;
                    let _ = tokio::time::timeout(
                        std::time::Duration::from_secs(2),
                        handle_post_tool_use_payload(client, &payload),
                    )
                    .await;
                }
                CodexHookAction::Stop => {
                    handle_stop(
                        client,
                        Some("codex".to_string()),
                        None,
                        StopWireFormat::Codex,
                        Some(&payload),
                    )
                    .await?;
                }
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod stop_tests {
    /// [y5ch.2] Guard: the clean-stop path must not POST to /internal/notify.
    /// A clean agent stop is passive and must not create a second direct notify
    /// request; the status endpoint owns the coalesced completion record.
    #[test]
    fn handle_stop_source_has_no_notify_post() {
        let src = include_str!("hook.rs");
        let start = src
            .find("async fn handle_stop")
            .expect("handle_stop exists");
        // End the slice at the NEXT top-level item — the immediately following
        // `fn drain_stdin` (a plain fn). Searching only for `\nasync fn ` would
        // overshoot past drain_stdin into `pub async fn run`, whose Notify arm
        // legitimately POSTs /internal/notify, yielding a false positive.
        let after = &src[start + 1..];
        let end = after
            .find("\nfn ")
            .map(|i| start + 1 + i)
            .unwrap_or(src.len());
        let body = &src[start..end];
        assert!(
            !body.contains("/internal/notify"),
            "handle_stop must not call /internal/notify (y5ch.2 noise source)"
        );
        // [x386.6] The peer awareness post remains, now as a structured check-out
        // to the #agents channel (replaces the old "finished work" broadcast).
        assert!(
            body.contains("checked out"),
            "peer check-out must remain after y5ch.2 / x386.6"
        );
        assert!(
            body.contains("/internal/channels/send"),
            "check-out must post to the #agents channel"
        );
    }

    /// [remote-dev-1aa5c] Both subagent-stop report paths must tag the source so
    /// the server only lets their "running" replace an active running/subagent
    /// state, never waiting, compacting, idle, error, or ended. Asserted at
    /// source level for the dedicated arm and the older-client safety belt.
    #[test]
    fn subagent_stop_paths_tag_source() {
        let src = include_str!("hook.rs");

        // (1) Dedicated SubagentStop handler arm.
        let arm_start = src
            .find("HookCommand::SubagentStop =>")
            .expect("SubagentStop arm exists");
        let arm = &src[arm_start..arm_start + 700];
        assert!(
            arm.contains(r#"report_status_with_source(client, "running", Some("subagent-stop"))"#),
            "SubagentStop arm must report running tagged source=subagent-stop"
        );

        // (2) Stop-handler safety belt (SubagentStop routed through Stop).
        let belt_start = src
            .find(r#"if hook_event == "SubagentStop""#)
            .expect("stop-handler safety belt exists");
        let belt = &src[belt_start..belt_start + 700];
        assert!(
            belt.contains("deliver_status_for_wire(") && belt.contains(r#"Some("subagent-stop")"#),
            "Stop-handler safety belt must tag source=subagent-stop"
        );
    }
}

#[cfg(test)]
mod sanitize_tests {
    use super::sanitize_for_digest;

    #[test]
    fn strips_ansi_osc_and_csi_escapes() {
        // A crafted note trying to set the terminal title (OSC) + recolor (CSI).
        let attack = "\u{1b}]0;pwned\u{07}\u{1b}[31mhello";
        let out = sanitize_for_digest(attack);
        // No ESC (0x1b) or BEL (0x07) survive; the payload is inert literal text.
        assert!(!out.contains('\u{1b}'), "ESC must be stripped");
        assert!(!out.contains('\u{07}'), "BEL must be stripped");
        assert_eq!(out, "]0;pwned[31mhello");
    }

    #[test]
    fn strips_newlines_so_fake_section_lines_cannot_be_injected() {
        // An attacker embedding a newline + a spoofed COLLISION line.
        let attack = "ok\n\u{26a0} COLLISION: spoofed shares your branch main";
        let out = sanitize_for_digest(attack);
        assert!(!out.contains('\n'), "newlines must be stripped");
        // Renders as a single inert line (the warning glyph itself is harmless).
        assert_eq!(out, "ok\u{26a0} COLLISION: spoofed shares your branch main");
    }

    #[test]
    fn preserves_ordinary_text_and_unicode() {
        let s = "feat/x386.11 \u{2014} \u{b7} \u{26a0} caf\u{e9}";
        assert_eq!(sanitize_for_digest(s), s);
    }

    #[test]
    fn strips_c1_control_introducers() {
        // 0x9b is the 8-bit CSI introducer; 0x9d is 8-bit OSC. Both are C1
        // controls and must be dropped.
        let attack = "a\u{9b}31mb\u{9d}0;x";
        let out = sanitize_for_digest(attack);
        assert_eq!(out, "a31mb0;x");
    }
}

#[cfg(test)]
mod codex_tests {
    use serde_json::json;

    use super::{
        codex_action, format_codex_pre_tool_response, format_stop_block, inspect_bash_payload,
        parse_git_guard_requests, shell_command, shell_commands, CodexHookAction,
        GitGuardOperation, GitGuardRequest, StopWireFormat,
    };

    #[test]
    fn maps_codex_lifecycle_events_to_rdv_actions() {
        let ordinary_tool = json!({ "tool_name": "Bash", "tool_input": { "command": "true" } });
        let question_tool = json!({ "tool_name": "request_user_input", "tool_input": {} });

        assert_eq!(
            codex_action("session-start", &json!({ "source": "startup" })).unwrap(),
            CodexHookAction::Status("running", None)
        );
        assert_eq!(
            codex_action("prompt-submit", &json!({})).unwrap(),
            CodexHookAction::Status("running", None)
        );
        assert_eq!(
            codex_action("pre-tool-use", &ordinary_tool).unwrap(),
            CodexHookAction::PreToolUse
        );
        assert_eq!(
            codex_action("pre-tool-use", &question_tool).unwrap(),
            CodexHookAction::Status("waiting", None)
        );
        assert_eq!(
            codex_action("permission-request", &json!({})).unwrap(),
            CodexHookAction::Status("waiting", None)
        );
        assert_eq!(
            codex_action("post-tool-use", &json!({})).unwrap(),
            CodexHookAction::PostToolUse
        );
        assert_eq!(
            codex_action("pre-compact", &json!({})).unwrap(),
            CodexHookAction::Status("compacting", None)
        );
        assert_eq!(
            codex_action("post-compact", &json!({})).unwrap(),
            CodexHookAction::Status("running", None)
        );
        assert_eq!(
            codex_action("subagent-start", &json!({})).unwrap(),
            CodexHookAction::Status("subagent", None)
        );
        assert_eq!(
            codex_action("subagent-stop", &json!({})).unwrap(),
            CodexHookAction::Status("running", Some("subagent-stop"))
        );
        assert_eq!(
            codex_action("stop", &json!({})).unwrap(),
            CodexHookAction::Stop
        );
        assert_eq!(
            codex_action("session-end", &json!({})).unwrap(),
            CodexHookAction::Status("ended", None)
        );
        assert!(codex_action("not-real", &json!({})).is_err());
    }

    #[test]
    fn codex_stop_block_is_valid_json_while_claude_stays_plain_text() {
        let codex = format_stop_block(StopWireFormat::Codex, "unfinished work");
        let parsed: serde_json::Value = serde_json::from_str(codex.trim()).unwrap();
        assert_eq!(
            parsed,
            json!({ "decision": "block", "reason": "unfinished work" })
        );

        assert_eq!(
            format_stop_block(StopWireFormat::Claude, "unfinished work"),
            "unfinished work\n"
        );
    }

    #[test]
    fn extracts_codex_shell_tool_names_and_input_shapes() {
        let cases = [
            json!({ "tool_name": "Bash", "tool_input": { "command": "git push" } }),
            json!({ "tool_name": "unified_exec", "tool_input": { "cmd": "git push" } }),
            json!({ "tool_name": "local_shell", "input": { "command": "git push" } }),
            json!({ "tool_name": "exec_command", "arguments": { "cmd": "git push" } }),
            json!({ "tool_name": "functions.exec_command", "cmd": "git push" }),
        ];
        for payload in cases {
            assert_eq!(shell_command(&payload).as_deref(), Some("git push"));
            assert!(inspect_bash_payload(&payload).unwrap().targets_main);
        }
        let argv_cases = [
            json!({ "tool_name": "exec_command", "arguments": { "cmd": ["git", "push"] } }),
            json!({ "tool_name": "functions.exec_command", "cmd": ["git", "push"] }),
        ];
        for payload in argv_cases {
            assert_eq!(shell_command(&payload).as_deref(), Some("git push"));
            assert!(inspect_bash_payload(&payload).unwrap().targets_main);
        }
        assert_eq!(
            shell_command(
                &json!({ "tool_name": "read_file", "tool_input": { "command": "git push" } })
            ),
            None,
        );
        assert_eq!(
            shell_command(
                &json!({ "tool_name": "exec_command", "arguments": { "cmd": ["git", 42] } })
            ),
            None,
        );

        let orchestrated = json!({
            "tool_name": "functions.exec",
            "tool_input": "const result = await tools.exec_command({cmd: \"git -C /repo push\", workdir: \"/repo\"}); text(result.output);"
        });
        assert_eq!(
            shell_commands(&orchestrated).unwrap(),
            vec!["git -C /repo push".to_string()],
        );
        assert!(inspect_bash_payload(&orchestrated).unwrap().targets_main);
        assert!(shell_commands(&json!({
            "tool_name": "functions.exec",
            "tool_input": "const command = \"git push\"; await run(command);"
        }))
        .is_err());
        assert!(shell_commands(&json!({
            "tool_name": "functions.exec",
            "tool_input": "await tools.exec_command({cmd: \"git \" + \"push\"});"
        }))
        .is_err());
        assert!(shell_commands(&json!({
            "tool_name": "functions.exec",
            "tool_input": "const cmd = [\"g\" + \"it\", \"pu\" + \"sh\"].join(\" \" ); await tools.exec_command({cmd});"
        }))
        .is_err());
        assert!(shell_commands(&json!({
            "tool_name": "functions.exec",
            "tool_input": "const decoy = {cmd: \"echo safe\"}; await tools.exec_command(dynamicRequest);"
        }))
        .is_err());
        assert!(shell_commands(&json!({
            "tool_name": "functions.exec",
            "tool_input": "const hidden = \"git push\"; await tools.exec_command({cmd: \"echo safe\"}); await run(hidden);"
        }))
        .is_err());
        assert!(shell_commands(&json!({
            "tool_name": "functions.exec",
            "tool_input": "await tools.exec_command({cmd: \"echo safe\", ...dynamicRequest});"
        }))
        .is_err());
        assert!(shell_commands(&json!({
            "tool_name": "functions.exec",
            "tool_input": "const run = tools.exec_command; await run({cmd: \"git push\"});"
        }))
        .is_err());
        assert!(shell_commands(&json!({
            "tool_name": "functions.exec",
            "tool_input": "await tools[\"exec_command\"]({cmd: \"git push\"});"
        }))
        .is_err());
        assert_eq!(
            shell_commands(&json!({
                "tool_name": "functions.exec",
                "tool_input": "await tools.write_stdin({session_id: 7, chars: \"git push\\n\"});"
            }))
            .unwrap(),
            vec!["git push\n"],
        );
        assert!(shell_commands(&json!({
            "tool_name": "functions.exec",
            "tool_input": "await tools.write_stdin({session_id: 7, chars});"
        }))
        .is_err());
        assert!(shell_commands(&json!({
            "tool_name": "functions.exec",
            "tool_input": "await tools.write_stdin(request);"
        }))
        .is_err());
        assert!(shell_commands(&json!({
            "tool_name": "functions.exec",
            "tool_input": "await tools.write_stdin({session_id: 7});"
        }))
        .unwrap()
        .is_empty());
    }

    #[test]
    fn parses_structured_git_guard_commands_and_inline_identity() {
        assert_eq!(
            parse_git_guard_requests("git -C /repo push").unwrap(),
            vec![GitGuardRequest {
                operation: GitGuardOperation::Push,
                proposed_author_name: None,
                proposed_author_email: None,
                proposed_committer_name: None,
                proposed_committer_email: None,
            }],
        );
        assert_eq!(
            parse_git_guard_requests(
                "git -c user.name='Alias Name' -c user.email=alias@example.com commit"
            )
            .unwrap(),
            vec![GitGuardRequest {
                operation: GitGuardOperation::Commit,
                proposed_author_name: Some("Alias Name".to_string()),
                proposed_author_email: Some("alias@example.com".to_string()),
                proposed_committer_name: Some("Alias Name".to_string()),
                proposed_committer_email: Some("alias@example.com".to_string()),
            }],
        );
        assert_eq!(
            parse_git_guard_requests(
                "GIT_AUTHOR_NAME='Inline Name' GIT_AUTHOR_EMAIL=inline@example.com git\npush"
            )
            .unwrap(),
            vec![GitGuardRequest {
                operation: GitGuardOperation::Push,
                proposed_author_name: Some("Inline Name".to_string()),
                proposed_author_email: Some("inline@example.com".to_string()),
                proposed_committer_name: None,
                proposed_committer_email: None,
            }],
        );
        assert_eq!(
            parse_git_guard_requests("GIT_AUTHOR_NAME='Alias & Co' git push").unwrap()[0]
                .proposed_author_name
                .as_deref(),
            Some("Alias & Co"),
        );
        let split_identity = parse_git_guard_requests(
            "GIT_AUTHOR_NAME=Alias GIT_AUTHOR_EMAIL=alias@example.com GIT_COMMITTER_NAME='Real Name' GIT_COMMITTER_EMAIL=real@example.com git commit",
        )
        .unwrap();
        assert_eq!(
            split_identity[0].proposed_author_name.as_deref(),
            Some("Alias")
        );
        assert_eq!(
            split_identity[0].proposed_committer_name.as_deref(),
            Some("Real Name")
        );
        assert_eq!(
            split_identity[0].proposed_committer_email.as_deref(),
            Some("real@example.com")
        );
        let explicit_author =
            parse_git_guard_requests("git commit --author='Real Name <real@example.com>' -m leak")
                .unwrap();
        assert_eq!(
            explicit_author[0].proposed_author_name.as_deref(),
            Some("Real Name")
        );
        assert_eq!(
            explicit_author[0].proposed_author_email.as_deref(),
            Some("real@example.com")
        );
        for command in [
            "git commit -C HEAD",
            "git commit -c HEAD",
            "git commit --reuse-message=HEAD",
            "git commit --reedit-message HEAD",
            "git commit --amend --no-edit",
        ] {
            let request = parse_git_guard_requests(command).unwrap();
            assert_eq!(request[0].proposed_author_name.as_deref(), Some(""));
            assert_eq!(request[0].proposed_author_email.as_deref(), Some(""));
        }
        let reset_author =
            parse_git_guard_requests("git commit --amend --reset-author --no-edit").unwrap();
        assert_eq!(reset_author[0].proposed_author_name, None);
        assert_eq!(reset_author[0].proposed_author_email, None);
    }

    #[test]
    fn finds_protected_git_operations_after_other_shell_commands() {
        assert_eq!(
            parse_git_guard_requests("git status && command git -C /repo push; true")
                .unwrap()
                .into_iter()
                .map(|request| request.operation)
                .collect::<Vec<_>>(),
            vec![GitGuardOperation::Push],
        );
        assert_eq!(
            parse_git_guard_requests("true;git -C /repo push")
                .unwrap()
                .into_iter()
                .map(|request| request.operation)
                .collect::<Vec<_>>(),
            vec![GitGuardOperation::Push],
        );
        assert_eq!(
            parse_git_guard_requests("if git -C /repo push; then echo pushed; fi")
                .unwrap()
                .into_iter()
                .map(|request| request.operation)
                .collect::<Vec<_>>(),
            vec![GitGuardOperation::Push],
        );
        assert_eq!(
            parse_git_guard_requests("bash -lc 'git -c user.email=nested@example.com commit'")
                .unwrap(),
            vec![GitGuardRequest {
                operation: GitGuardOperation::Commit,
                proposed_author_name: None,
                proposed_author_email: Some("nested@example.com".to_string()),
                proposed_committer_name: None,
                proposed_committer_email: Some("nested@example.com".to_string()),
            }],
        );
        assert_eq!(
            parse_git_guard_requests("printf '%s' \"$(git push)\"")
                .unwrap()
                .into_iter()
                .map(|request| request.operation)
                .collect::<Vec<_>>(),
            vec![GitGuardOperation::Push],
        );
        assert_eq!(
            parse_git_guard_requests("exec git push")
                .unwrap()
                .into_iter()
                .map(|request| request.operation)
                .collect::<Vec<_>>(),
            vec![GitGuardOperation::Push],
        );
        assert_eq!(
            parse_git_guard_requests("eval 'git commit'")
                .unwrap()
                .into_iter()
                .map(|request| request.operation)
                .collect::<Vec<_>>(),
            vec![GitGuardOperation::Commit],
        );
        assert_eq!(
            parse_git_guard_requests("printf `%s` `git push`")
                .unwrap()
                .into_iter()
                .map(|request| request.operation)
                .collect::<Vec<_>>(),
            vec![GitGuardOperation::Push],
        );
        assert_eq!(
            parse_git_guard_requests("git -c alias.ship='push origin main' ship")
                .unwrap()
                .into_iter()
                .map(|request| request.operation)
                .collect::<Vec<_>>(),
            vec![GitGuardOperation::Push],
        );
        assert!(parse_git_guard_requests("printf 'git push'").is_err());
        assert!(parse_git_guard_requests("printf 'push\\n' | xargs git").is_err());
        assert!(parse_git_guard_requests("printf 'cherry-pick HEAD~1\\n' | xargs git").is_err());
        assert!(parse_git_guard_requests("printf 'HEAD~1\\n' | xargs git-cherry-pick").is_err());
        assert!(parse_git_guard_requests("git push && printf 'push\\n' | xargs git").is_err());
        assert!(parse_git_guard_requests("command xargs git push").is_err());
        assert!(parse_git_guard_requests("custom-wrapper git push").is_err());
        for command in [
            "git am patch.mbox",
            "git cherry-pick HEAD~1",
            "git merge topic",
            "git pull --rebase",
            "git rebase main",
            "git revert HEAD",
            "git tag -a release -m release",
            "git notes add -m note",
            "git stash push",
            "git mktag",
        ] {
            let requests = parse_git_guard_requests(command).unwrap();
            assert_eq!(requests.len(), 1, "{command}");
            assert_eq!(
                requests[0].operation,
                GitGuardOperation::Commit,
                "{command}"
            );
        }
        for command in [
            "git am patch.mbox",
            "git cherry-pick HEAD~1",
            "git pull --rebase",
            "git rebase main",
        ] {
            let request = parse_git_guard_requests(command).unwrap();
            assert_eq!(
                request[0].proposed_author_name.as_deref(),
                Some(""),
                "{command}"
            );
            assert_eq!(
                request[0].proposed_author_email.as_deref(),
                Some(""),
                "{command}"
            );
        }
        assert!(parse_git_guard_requests("git status").unwrap().is_empty());
        assert!(parse_git_guard_requests("git ship").is_err());
        assert!(parse_git_guard_requests("git -C 'unterminated push").is_err());
    }

    #[test]
    fn models_or_rejects_identity_changing_environment_wrappers() {
        assert_eq!(
            parse_git_guard_requests("env -i git commit").unwrap(),
            vec![GitGuardRequest {
                operation: GitGuardOperation::Commit,
                proposed_author_name: Some(String::new()),
                proposed_author_email: Some(String::new()),
                proposed_committer_name: Some(String::new()),
                proposed_committer_email: Some(String::new()),
            }],
        );
        assert_eq!(
            parse_git_guard_requests("env -u GIT_AUTHOR_EMAIL git push").unwrap()[0]
                .proposed_author_email
                .as_deref(),
            Some(""),
        );
        assert_eq!(
            parse_git_guard_requests("env -i bash -c 'git commit'").unwrap(),
            vec![GitGuardRequest {
                operation: GitGuardOperation::Commit,
                proposed_author_name: Some(String::new()),
                proposed_author_email: Some(String::new()),
                proposed_committer_name: Some(String::new()),
                proposed_committer_email: Some(String::new()),
            }],
        );
        assert_eq!(
            parse_git_guard_requests("command env -i git commit").unwrap(),
            vec![GitGuardRequest {
                operation: GitGuardOperation::Commit,
                proposed_author_name: Some(String::new()),
                proposed_author_email: Some(String::new()),
                proposed_committer_name: Some(String::new()),
                proposed_committer_email: Some(String::new()),
            }],
        );
        assert_eq!(
            parse_git_guard_requests("exec -c git commit").unwrap(),
            vec![GitGuardRequest {
                operation: GitGuardOperation::Commit,
                proposed_author_name: Some(String::new()),
                proposed_author_email: Some(String::new()),
                proposed_committer_name: Some(String::new()),
                proposed_committer_email: Some(String::new()),
            }],
        );
        assert_eq!(
            parse_git_guard_requests("GIT_COMMITTER_EMAIL=real@example.com eval 'git commit'")
                .unwrap()[0]
                .proposed_committer_email
                .as_deref(),
            Some("real@example.com"),
        );
        assert!(parse_git_guard_requests("sudo git push").is_err());
        assert!(parse_git_guard_requests("doas git commit").is_err());
        assert!(parse_git_guard_requests("sudo sh -c 'git push'").is_err());
    }

    #[test]
    fn codex_pre_tool_response_delivers_context_and_a_structured_denial() {
        let response =
            format_codex_pre_tool_response(Some("peer context"), Some("wrong git identity"))
                .unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&response).unwrap();
        assert_eq!(
            parsed,
            json!({
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "additionalContext": "peer context",
                    "permissionDecision": "deny",
                    "permissionDecisionReason": "wrong git identity"
                }
            }),
        );
        assert!(format_codex_pre_tool_response(None, None).is_none());
    }
}
