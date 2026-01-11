//! Extension management commands.
//!
//! Manages SDK extensions: list, enable, disable, uninstall, create.
//!
//! Uses direct database access via rdv-core for extension operations.

use anyhow::{bail, Context, Result};
use colored::Colorize;
use rusqlite::{params, Row};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{self, Write};
use std::path::PathBuf;

use crate::cli::{ExtAction, ExtCommand};
use crate::config::Config;
use crate::database::get_database;

/// Extension data from database
#[derive(Debug, Serialize, Deserialize)]
struct ExtensionRow {
    id: String,
    manifest: String,
    config: String,
    state: String,
    enabled: bool,
    installed_at: String,
    updated_at: String,
    error: Option<String>,
}

/// Parsed extension manifest
#[derive(Debug, Serialize, Deserialize)]
struct ExtensionManifest {
    id: String,
    name: String,
    version: String,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    author: Option<String>,
}

/// Tool info from database
#[derive(Debug, Serialize, Deserialize)]
struct ToolRow {
    id: String,
    name: String,
    display_name: String,
    description: String,
    category: Option<String>,
}

/// Prompt info from database
#[derive(Debug, Serialize, Deserialize)]
struct PromptRow {
    id: String,
    name: String,
    display_name: String,
    description: String,
    category: Option<String>,
}

/// Map database row to ExtensionRow
fn map_extension_row(row: &Row<'_>) -> rusqlite::Result<ExtensionRow> {
    Ok(ExtensionRow {
        id: row.get(0)?,
        manifest: row.get(1)?,
        config: row.get(2)?,
        state: row.get(3)?,
        enabled: row.get::<_, i32>(4)? == 1,
        installed_at: row.get(5)?,
        updated_at: row.get(6)?,
        error: row.get(7)?,
    })
}

/// Map database row to ToolRow
fn map_tool_row(row: &Row<'_>) -> rusqlite::Result<ToolRow> {
    Ok(ToolRow {
        id: row.get(0)?,
        name: row.get(1)?,
        display_name: row.get(2)?,
        description: row.get(3)?,
        category: row.get(4)?,
    })
}

/// Map database row to PromptRow
fn map_prompt_row(row: &Row<'_>) -> rusqlite::Result<PromptRow> {
    Ok(PromptRow {
        id: row.get(0)?,
        name: row.get(1)?,
        display_name: row.get(2)?,
        description: row.get(3)?,
        category: row.get(4)?,
    })
}

/// Execute extension command.
pub fn execute(cmd: ExtCommand, config: &Config) -> Result<()> {
    match cmd.action {
        ExtAction::List { all, json } => list(all, json, config),
        ExtAction::Show { id, json } => show(&id, json, config),
        ExtAction::Enable { id } => enable(&id, config),
        ExtAction::Disable { id } => disable(&id, config),
        ExtAction::Uninstall { id, force } => uninstall(&id, force, config),
        ExtAction::Create {
            name,
            output,
            description,
            with_tool,
            with_prompt,
        } => create(&name, output, description, with_tool, with_prompt, config),
    }
}

/// List installed extensions.
fn list(all: bool, json: bool, _config: &Config) -> Result<()> {
    let db = get_database()?;

    let query = if all {
        "SELECT id, manifest, config, state, enabled, installed_at, updated_at, error FROM sdk_extensions ORDER BY id"
    } else {
        "SELECT id, manifest, config, state, enabled, installed_at, updated_at, error FROM sdk_extensions WHERE enabled = 1 ORDER BY id"
    };

    let extensions: Vec<ExtensionRow> = db
        .with_connection(|conn| {
            let mut stmt = conn.prepare(query)?;
            let rows = stmt.query_map([], map_extension_row)?;
            rows.collect()
        })
        .context("Failed to query extensions")?;

    if json {
        println!("{}", serde_json::to_string_pretty(&extensions)?);
        return Ok(());
    }

    if extensions.is_empty() {
        println!("{}", "No extensions installed.".yellow());
        if !all {
            println!("  Use {} to show disabled extensions.", "--all".cyan());
        }
        return Ok(());
    }

    println!("{}", "Installed Extensions".bold());
    println!("{}", "═".repeat(60));

    for ext in extensions {
        let manifest: ExtensionManifest =
            serde_json::from_str(&ext.manifest).unwrap_or_else(|_| ExtensionManifest {
                id: ext.id.clone(),
                name: ext.id.clone(),
                version: "unknown".into(),
                description: None,
                author: None,
            });

        let state_icon = match ext.state.as_str() {
            "active" => "●".green(),
            "disabled" => "○".yellow(),
            "failed" => "✗".red(),
            "loading" => "◐".blue(),
            _ => "?".white(),
        };

        println!(
            "{} {} {} {}",
            state_icon,
            manifest.name.bold(),
            format!("v{}", manifest.version).dimmed(),
            format!("({})", ext.id).dimmed()
        );

        if let Some(desc) = manifest.description {
            println!("  {}", desc);
        }

        if let Some(ref err) = ext.error {
            println!("  {} {}", "Error:".red(), err);
        }
    }

    println!();
    Ok(())
}

/// Show extension details.
fn show(id: &str, json: bool, _config: &Config) -> Result<()> {
    let db = get_database()?;
    let id_owned = id.to_string();

    // Get extension
    let ext: ExtensionRow = db
        .with_connection(|conn| {
            conn.query_row(
                "SELECT id, manifest, config, state, enabled, installed_at, updated_at, error FROM sdk_extensions WHERE id = ?1",
                [&id_owned],
                map_extension_row,
            )
        })
        .context(format!("Extension not found: {}", id))?;

    // Get tools
    let tools: Vec<ToolRow> = db
        .with_connection(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id, name, display_name, description, category FROM sdk_extension_tools WHERE extension_id = ?1",
            )?;
            let rows = stmt.query_map([&id_owned], map_tool_row)?;
            rows.collect()
        })
        .context("Failed to query tools")?;

    // Get prompts
    let prompts: Vec<PromptRow> = db
        .with_connection(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id, name, display_name, description, category FROM sdk_extension_prompts WHERE extension_id = ?1",
            )?;
            let rows = stmt.query_map([&id_owned], map_prompt_row)?;
            rows.collect()
        })
        .context("Failed to query prompts")?;

    if json {
        let output = serde_json::json!({
            "extension": ext,
            "tools": tools,
            "prompts": prompts,
        });
        println!("{}", serde_json::to_string_pretty(&output)?);
        return Ok(());
    }

    let manifest: ExtensionManifest =
        serde_json::from_str(&ext.manifest).unwrap_or_else(|_| ExtensionManifest {
            id: ext.id.clone(),
            name: ext.id.clone(),
            version: "unknown".into(),
            description: None,
            author: None,
        });

    let state_icon = match ext.state.as_str() {
        "active" => "●".green(),
        "disabled" => "○".yellow(),
        "failed" => "✗".red(),
        "loading" => "◐".blue(),
        _ => "?".white(),
    };

    println!("{}", "Extension Details".bold());
    println!("{}", "═".repeat(60));
    println!("  {} {}", "ID:".cyan(), ext.id);
    println!("  {} {}", "Name:".cyan(), manifest.name);
    println!("  {} {}", "Version:".cyan(), manifest.version);
    println!("  {} {} {}", "State:".cyan(), state_icon, ext.state);

    if let Some(desc) = manifest.description {
        println!("  {} {}", "Description:".cyan(), desc);
    }
    if let Some(author) = manifest.author {
        println!("  {} {}", "Author:".cyan(), author);
    }
    println!("  {} {}", "Installed:".cyan(), ext.installed_at);
    println!("  {} {}", "Updated:".cyan(), ext.updated_at);

    if let Some(ref err) = ext.error {
        println!("  {} {}", "Error:".red(), err);
    }

    // Tools
    if !tools.is_empty() {
        println!();
        println!("  {} ({})", "Tools".bold(), tools.len());
        for tool in &tools {
            println!(
                "    {} {}",
                format!("{}:{}", id, tool.name).cyan(),
                tool.description
            );
        }
    }

    // Prompts
    if !prompts.is_empty() {
        println!();
        println!("  {} ({})", "Prompts".bold(), prompts.len());
        for prompt in &prompts {
            println!(
                "    {} {}",
                format!("{}:{}", id, prompt.name).cyan(),
                prompt.description
            );
        }
    }

    println!();
    Ok(())
}

/// Enable an extension.
fn enable(id: &str, _config: &Config) -> Result<()> {
    let db = get_database()?;
    let id_owned = id.to_string();

    // Check if extension exists
    let exists: bool = db
        .with_connection(|conn| {
            conn.query_row(
                "SELECT 1 FROM sdk_extensions WHERE id = ?1",
                [&id_owned],
                |_| Ok(true),
            )
        })
        .unwrap_or(false);

    if !exists {
        bail!("Extension not found: {}", id);
    }

    // Update state
    let now = chrono::Utc::now().to_rfc3339();
    db.with_connection(|conn| {
        conn.execute(
            "UPDATE sdk_extensions SET state = 'active', enabled = 1, error = NULL, updated_at = ?1 WHERE id = ?2",
            params![now, id_owned],
        )
    })
    .context("Failed to enable extension")?;

    println!("{} Extension {} enabled.", "✓".green(), id.cyan());
    println!(
        "  {}",
        "Note: Extension will be fully loaded on next server restart.".dimmed()
    );
    Ok(())
}

/// Disable an extension.
fn disable(id: &str, _config: &Config) -> Result<()> {
    let db = get_database()?;
    let id_owned = id.to_string();

    // Check if extension exists
    let exists: bool = db
        .with_connection(|conn| {
            conn.query_row(
                "SELECT 1 FROM sdk_extensions WHERE id = ?1",
                [&id_owned],
                |_| Ok(true),
            )
        })
        .unwrap_or(false);

    if !exists {
        bail!("Extension not found: {}", id);
    }

    // Update state
    let now = chrono::Utc::now().to_rfc3339();
    db.with_connection(|conn| {
        conn.execute(
            "UPDATE sdk_extensions SET state = 'disabled', enabled = 0, updated_at = ?1 WHERE id = ?2",
            params![now, id_owned],
        )
    })
    .context("Failed to disable extension")?;

    println!("{} Extension {} disabled.", "✓".green(), id.cyan());
    Ok(())
}

/// Uninstall an extension.
fn uninstall(id: &str, force: bool, _config: &Config) -> Result<()> {
    let db = get_database()?;
    let id_owned = id.to_string();

    // Check if extension exists and get manifest
    let manifest: String = db
        .with_connection(|conn| {
            conn.query_row(
                "SELECT manifest FROM sdk_extensions WHERE id = ?1",
                [&id_owned],
                |row| row.get(0),
            )
        })
        .context(format!("Extension not found: {}", id))?;

    let manifest_data: ExtensionManifest = serde_json::from_str(&manifest).unwrap_or_else(|_| {
        ExtensionManifest {
            id: id.to_string(),
            name: id.to_string(),
            version: "unknown".into(),
            description: None,
            author: None,
        }
    });

    // Confirm unless --force
    if !force {
        print!(
            "Are you sure you want to uninstall {} ({})? [y/N] ",
            manifest_data.name.bold(),
            id
        );
        io::stdout().flush()?;

        let mut input = String::new();
        io::stdin().read_line(&mut input)?;

        if !input.trim().eq_ignore_ascii_case("y") {
            println!("{}", "Cancelled.".yellow());
            return Ok(());
        }
    }

    // Delete extension (cascades to tools, prompts, resources)
    db.with_connection(|conn| conn.execute("DELETE FROM sdk_extensions WHERE id = ?1", [&id_owned]))
        .context("Failed to delete extension")?;

    println!(
        "{} Extension {} uninstalled.",
        "✓".green(),
        manifest_data.name.cyan()
    );
    Ok(())
}

/// Create a new extension scaffold.
fn create(
    name: &str,
    output: Option<String>,
    description: Option<String>,
    with_tool: bool,
    with_prompt: bool,
    _config: &Config,
) -> Result<()> {
    // Convert name to kebab-case
    let ext_id = name
        .to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '-' })
        .collect::<String>()
        .split('-')
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("-");

    // Determine output directory
    let base_dir = output
        .map(PathBuf::from)
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));

    let ext_dir = base_dir.join(&ext_id);

    if ext_dir.exists() {
        bail!("Directory already exists: {:?}", ext_dir);
    }

    // Create directory
    fs::create_dir_all(&ext_dir).context("Failed to create extension directory")?;

    // Generate manifest
    let manifest = generate_manifest(&ext_id, name, description.as_deref(), with_tool, with_prompt);
    let manifest_path = ext_dir.join("manifest.json");
    fs::write(&manifest_path, manifest).context("Failed to write manifest.json")?;

    // Generate README
    let readme = generate_readme(&ext_id, name, description.as_deref());
    let readme_path = ext_dir.join("README.md");
    fs::write(&readme_path, readme).context("Failed to write README.md")?;

    // Generate example tool handler
    if with_tool {
        let handler = generate_tool_handler(&ext_id);
        let handler_path = ext_dir.join("handlers.ts");
        fs::write(&handler_path, handler).context("Failed to write handlers.ts")?;
    }

    println!("{} Extension scaffold created.", "✓".green());
    println!();
    println!("  {} {:?}", "Location:".cyan(), ext_dir);
    println!("  {} manifest.json", "Files:".cyan());
    println!("         README.md");
    if with_tool {
        println!("         handlers.ts");
    }
    println!();
    println!("{}", "Next steps:".bold());
    println!("  1. Edit manifest.json to customize your extension");
    println!("  2. Implement tool handlers (if any)");
    println!(
        "  3. Register with: {}",
        "rdv ext install <path>".cyan()
    );
    println!();

    Ok(())
}

/// Generate extension manifest JSON.
fn generate_manifest(
    id: &str,
    name: &str,
    description: Option<&str>,
    with_tool: bool,
    with_prompt: bool,
) -> String {
    let mut tools = Vec::new();
    let mut prompts = Vec::new();

    if with_tool {
        tools.push(serde_json::json!({
            "name": "example_tool",
            "displayName": "Example Tool",
            "description": "An example tool that echoes input",
            "category": "utilities",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "message": {
                        "type": "string",
                        "description": "Message to echo"
                    }
                },
                "required": ["message"]
            },
            "outputSchema": {
                "type": "object",
                "properties": {
                    "result": {
                        "type": "string"
                    }
                }
            },
            "isAsync": false,
            "hasSideEffects": false,
            "permissions": [],
            "examples": [
                {
                    "name": "Basic echo",
                    "description": "Echo a message",
                    "input": { "message": "Hello, World!" },
                    "expectedOutput": { "result": "Hello, World!" }
                }
            ]
        }));
    }

    if with_prompt {
        prompts.push(serde_json::json!({
            "name": "example_prompt",
            "displayName": "Example Prompt",
            "description": "An example prompt template",
            "category": "templates",
            "template": "You are helping with: {{task}}\n\nContext:\n{{context}}\n\nPlease proceed.",
            "variables": [
                {
                    "name": "task",
                    "description": "The task to help with",
                    "type": "string",
                    "required": true
                },
                {
                    "name": "context",
                    "description": "Additional context",
                    "type": "string",
                    "required": false,
                    "default": "No additional context provided."
                }
            ],
            "tags": ["template", "example"],
            "examples": []
        }));
    }

    let manifest = serde_json::json!({
        "id": id,
        "name": name,
        "version": "0.1.0",
        "description": description.unwrap_or(&format!("{} extension", name)),
        "author": std::env::var("USER").unwrap_or_else(|_| "unknown".into()),
        "license": "MIT",
        "homepage": "",
        "repository": "",
        "keywords": [],
        "engines": {
            "rdv": ">=0.2.0"
        },
        "tools": tools,
        "prompts": prompts,
        "resources": [],
        "memoryProviders": [],
        "uiComponents": [],
        "capabilities": {
            "tools": with_tool,
            "prompts": with_prompt,
            "memory": false,
            "resources": false,
            "ui": false
        },
        "config": {
            "schema": {
                "type": "object",
                "properties": {},
                "required": []
            },
            "defaults": {}
        }
    });

    serde_json::to_string_pretty(&manifest).unwrap()
}

/// Generate README.md for extension.
fn generate_readme(id: &str, name: &str, description: Option<&str>) -> String {
    format!(
        r#"# {name}

{desc}

## Installation

```bash
rdv ext install ./{id}
```

## Usage

### Tools

List the available tools provided by this extension.

### Prompts

List the available prompts provided by this extension.

## Configuration

Describe any configuration options.

## Development

```bash
# Test the extension
rdv ext enable {id}

# Disable when done
rdv ext disable {id}
```

## License

MIT
"#,
        name = name,
        desc = description.unwrap_or(&format!("{} extension for Remote Dev", name)),
        id = id
    )
}

/// Generate example tool handler.
fn generate_tool_handler(ext_id: &str) -> String {
    format!(
        r#"/**
 * Tool handlers for {ext_id} extension.
 *
 * Each tool defined in manifest.json needs a corresponding handler function.
 */

import type {{ ToolContext, ToolResult }} from '@rdv/sdk';

/**
 * Example tool handler.
 *
 * @param input - The tool input as defined in manifest.json inputSchema
 * @param context - Execution context (user, session, folder info)
 * @returns Tool result
 */
export async function example_tool(
  input: {{ message: string }},
  context: ToolContext
): Promise<ToolResult> {{
  return {{
    success: true,
    output: {{
      result: input.message,
    }},
  }};
}}
"#,
        ext_id = ext_id
    )
}
