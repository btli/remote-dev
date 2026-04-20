# Phase 5: rdv CLI Refactor - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans.

**Goal:** Rename folder-centric `rdv` commands to project-centric. Add `rdv group ...` for group management. Update every command that sends `folderId` to the server to send `projectId` instead (with fallback). Preserve JSON and `--human` output.

**Architecture:** The existing `crates/rdv/src/commands/folder.rs` becomes `project.rs` (or both, with `folder.rs` delegating to `project.rs` for one release cycle so external scripts don't break). A new `group.rs` mirrors the group API. Internal helpers in `hook.rs`, `agent.rs`, `context.rs`, `peer.rs`, `channel.rs` switch from `folderId` to `projectId`.

**Tech Stack:** Rust, clap, reqwest, serde.

Reference: [Master plan](2026-04-20-project-folder-refactor-master.md).

---

## File Structure

**Create:**
- `crates/rdv/src/commands/project.rs`
- `crates/rdv/src/commands/group.rs`
- `crates/rdv/tests/project_cli.rs`
- `crates/rdv/tests/group_cli.rs`

**Modify:**
- `crates/rdv/src/main.rs` — register new subcommands (`project`, `group`); retain `folder` as deprecated alias
- `crates/rdv/src/commands/folder.rs` — each variant logs a deprecation warning and delegates to the new project equivalent
- `crates/rdv/src/commands/agent.rs` — `rdv agent start` takes `--project-id` instead of `--folder-id`
- `crates/rdv/src/commands/context.rs` — report `projectId` in context output
- `crates/rdv/src/commands/hook.rs` — update hook payloads
- `crates/rdv/src/commands/peer.rs` — peer list/send uses project scope
- `crates/rdv/src/commands/channel.rs` — channel commands use project scope
- `crates/rdv/src/commands/mod.rs` — add new `mod project; mod group;`

**Do NOT touch:**
- `crates/rdv/src/api.rs` — generic HTTP helpers are already agnostic
- Release scripts / install.sh

---

## Task 1: Add `group` subcommand

- [ ] **Step 1.1: Scaffold `group.rs`**

`crates/rdv/src/commands/group.rs`:

```rust
use anyhow::Result;
use clap::Subcommand;
use serde::{Deserialize, Serialize};
use crate::api::{self, ApiClient};
use crate::output::{Human, Output};

#[derive(Subcommand, Debug)]
pub enum GroupCommand {
    /// List groups
    List,
    /// Create a group
    Create {
        #[arg(long)]
        name: String,
        #[arg(long)]
        parent_group_id: Option<String>,
    },
    /// Rename / update a group
    Update {
        id: String,
        #[arg(long)]
        name: Option<String>,
        #[arg(long)]
        collapsed: Option<bool>,
    },
    /// Move group under a new parent
    Move {
        id: String,
        #[arg(long)]
        new_parent_group_id: Option<String>,
    },
    /// Delete a group
    Delete {
        id: String,
        #[arg(long)]
        force: bool,
    },
}

#[derive(Debug, Serialize, Deserialize)]
struct Group {
    id: String,
    name: String,
    #[serde(rename = "parentGroupId")]
    parent_group_id: Option<String>,
}

pub async fn run(cmd: GroupCommand, human: bool, client: &ApiClient) -> Result<()> {
    match cmd {
        GroupCommand::List => {
            let body: serde_json::Value = client.get("/api/groups").await?;
            let groups: Vec<Group> = serde_json::from_value(body["groups"].clone())?;
            if human {
                for g in &groups {
                    println!(
                        "{:<36} {:<30} parent={}",
                        g.id,
                        g.name,
                        g.parent_group_id.as_deref().unwrap_or("(root)")
                    );
                }
            } else {
                Output::new(&groups).print_json();
            }
        }
        GroupCommand::Create { name, parent_group_id } => {
            let body = serde_json::json!({
                "name": name,
                "parentGroupId": parent_group_id,
            });
            let res: serde_json::Value = client.post("/api/groups", &body).await?;
            Output::new(&res).print_json_or_human(human, |v, _| {
                println!("Created group {}", v["group"]["id"]);
            });
        }
        GroupCommand::Update { id, name, collapsed } => {
            let body = serde_json::json!({ "name": name, "collapsed": collapsed });
            let url = format!("/api/groups/{id}");
            let res: serde_json::Value = client.patch(&url, &body).await?;
            Output::new(&res).print_json_or_human(human, |v, _| {
                println!("Updated group {}", v["group"]["id"]);
            });
        }
        GroupCommand::Move { id, new_parent_group_id } => {
            let url = format!("/api/groups/{id}/move");
            let body = serde_json::json!({ "newParentGroupId": new_parent_group_id });
            client.post::<serde_json::Value>(&url, &body).await?;
            if human {
                println!("Moved group {id}");
            }
        }
        GroupCommand::Delete { id, force } => {
            let url = if force {
                format!("/api/groups/{id}?force=true")
            } else {
                format!("/api/groups/{id}")
            };
            client.delete(&url).await?;
            if human {
                println!("Deleted group {id}");
            }
        }
    }
    Ok(())
}
```

(Adapt `ApiClient` method names to match the existing helper module — `post`, `patch`, `delete` should already exist.)

- [ ] **Step 1.2: Register in `commands/mod.rs`**

```rust
pub mod group;
pub mod project;
```

- [ ] **Step 1.3: Hook into `main.rs`**

Under `Commands` enum:

```rust
/// Manage project groups
Group {
    #[command(subcommand)]
    command: crate::commands::group::GroupCommand,
},
```

Add match arm in the dispatcher:

```rust
Commands::Group { command } => commands::group::run(command, args.human, &client).await?,
```

- [ ] **Step 1.4: Build + commit**

```bash
cd crates/rdv && cargo build
git add crates/rdv/src/commands/group.rs crates/rdv/src/commands/mod.rs crates/rdv/src/main.rs
git commit -m "feat(rdv): add group subcommand (list/create/update/move/delete)"
```

---

## Task 2: Add `project` subcommand

- [ ] **Step 2.1: Scaffold `project.rs`**

`crates/rdv/src/commands/project.rs`:

```rust
use anyhow::Result;
use clap::Subcommand;
use serde::{Deserialize, Serialize};
use crate::api::ApiClient;
use crate::output::Output;

#[derive(Subcommand, Debug)]
pub enum ProjectCommand {
    /// List projects
    List {
        #[arg(long)]
        group_id: Option<String>,
    },
    /// Create a project inside a group
    Create {
        #[arg(long)]
        group_id: String,
        #[arg(long)]
        name: String,
    },
    /// Rename / update a project
    Update {
        id: String,
        #[arg(long)]
        name: Option<String>,
        #[arg(long)]
        collapsed: Option<bool>,
    },
    /// Move a project to a different group
    Move {
        id: String,
        #[arg(long)]
        new_group_id: String,
    },
    /// Delete a project
    Delete { id: String },
}

#[derive(Debug, Serialize, Deserialize)]
struct Project {
    id: String,
    name: String,
    #[serde(rename = "groupId")]
    group_id: String,
    #[serde(rename = "isAutoCreated")]
    is_auto_created: bool,
}

pub async fn run(cmd: ProjectCommand, human: bool, client: &ApiClient) -> Result<()> {
    match cmd {
        ProjectCommand::List { group_id } => {
            let url = match &group_id {
                Some(g) => format!("/api/projects?groupId={g}"),
                None => "/api/projects".to_string(),
            };
            let body: serde_json::Value = client.get(&url).await?;
            let projects: Vec<Project> = serde_json::from_value(body["projects"].clone())?;
            if human {
                for p in &projects {
                    println!(
                        "{:<36} {:<30} group={} auto={}",
                        p.id, p.name, p.group_id, p.is_auto_created
                    );
                }
            } else {
                Output::new(&projects).print_json();
            }
        }
        ProjectCommand::Create { group_id, name } => {
            let body = serde_json::json!({ "groupId": group_id, "name": name });
            let res: serde_json::Value = client.post("/api/projects", &body).await?;
            Output::new(&res).print_json_or_human(human, |v, _| {
                println!("Created project {}", v["project"]["id"]);
            });
        }
        ProjectCommand::Update { id, name, collapsed } => {
            let body = serde_json::json!({ "name": name, "collapsed": collapsed });
            let url = format!("/api/projects/{id}");
            let res: serde_json::Value = client.patch(&url, &body).await?;
            Output::new(&res).print_json_or_human(human, |v, _| {
                println!("Updated project {}", v["project"]["id"]);
            });
        }
        ProjectCommand::Move { id, new_group_id } => {
            let url = format!("/api/projects/{id}/move");
            client
                .post::<serde_json::Value>(&url, &serde_json::json!({ "newGroupId": new_group_id }))
                .await?;
            if human {
                println!("Moved project {id} to group {new_group_id}");
            }
        }
        ProjectCommand::Delete { id } => {
            client.delete(&format!("/api/projects/{id}")).await?;
            if human {
                println!("Deleted project {id}");
            }
        }
    }
    Ok(())
}
```

- [ ] **Step 2.2: Register in main**

```rust
/// Manage projects
Project {
    #[command(subcommand)]
    command: crate::commands::project::ProjectCommand,
},
// ...
Commands::Project { command } => commands::project::run(command, args.human, &client).await?,
```

- [ ] **Step 2.3: Build + commit**

```bash
cargo build
git add crates/rdv/src/commands/project.rs crates/rdv/src/main.rs
git commit -m "feat(rdv): add project subcommand (list/create/update/move/delete)"
```

---

## Task 3: Deprecate `folder` Subcommand

- [ ] **Step 3.1: Add deprecation warnings**

In `crates/rdv/src/commands/folder.rs`, at the top of `run()`:

```rust
eprintln!(
    "warning: `rdv folder` is deprecated; use `rdv project` or `rdv group` instead. This alias will be removed in a future release."
);
```

Each folder operation should delegate to the corresponding project command by making the same HTTP call but targeting `/api/projects` or `/api/groups` depending on context. For simplicity, keep the legacy path calling `/api/folders` unchanged for one more release (the server-side compatibility is preserved until Phase 6).

- [ ] **Step 3.2: Commit**

```bash
cargo build
git add crates/rdv/src/commands/folder.rs
git commit -m "chore(rdv): mark folder subcommand deprecated; keeps working until Phase 6"
```

---

## Task 4: `rdv agent start` Takes `--project-id`

- [ ] **Step 4.1: Update flag**

In `crates/rdv/src/commands/agent.rs`:

- Rename `--folder-id` flag to `--project-id` (keep the old flag as hidden alias):

```rust
#[derive(Args, Debug)]
pub struct AgentStartArgs {
    /// Project to start the agent inside
    #[arg(long, alias = "folder-id")]
    pub project_id: String,
    // ... existing fields
}
```

- In the `run` body, change `folderId` to `projectId` in the JSON body sent to the server:

```rust
let body = serde_json::json!({
    "projectId": args.project_id,
    // ... rest
});
```

- [ ] **Step 4.2: Build + commit**

```bash
cargo build
git add crates/rdv/src/commands/agent.rs
git commit -m "feat(rdv): agent start accepts --project-id (alias --folder-id for transition)"
```

---

## Task 5: `context.rs` Reports Project Context

- [ ] **Step 5.1: Update output**

In `crates/rdv/src/commands/context.rs`, the context JSON should include:

```rust
#[derive(Serialize)]
struct Context {
    session_id: String,
    project_id: Option<String>,
    project_name: Option<String>,
    group_id: Option<String>,
    group_name: Option<String>,
    // legacy fields still populated during transition:
    folder_id: Option<String>,
    folder_name: Option<String>,
}
```

The server-side `/internal/context` (or whatever the endpoint is) should be updated in the same commit to return both project and folder info.

- [ ] **Step 5.2: Build + commit**

```bash
cargo build
git add crates/rdv/src/commands/context.rs
git commit -m "feat(rdv): context reports project and group alongside legacy folder"
```

---

## Task 6: Hook Commands — Update Payloads

- [ ] **Step 6.1: `hook.rs`**

In `crates/rdv/src/commands/hook.rs`, every hook subcommand that POSTs to the terminal server includes `folder_id` in its body. Add `project_id` alongside it (read from env var `RDV_PROJECT_ID` if present, else null). The terminal server needs to accept both during transition.

Example for `pre-tool-use`:

```rust
let body = serde_json::json!({
    "sessionId": session_id,
    "projectId": project_id,
    "folderId": folder_id,  // legacy, still honored
    "tool": tool_name,
});
```

Apply similarly to `post-tool-use`, `pre-compact`, `notification`, `stop`, `session-end`, and `validate`.

- [ ] **Step 6.2: Build + commit**

```bash
cargo build
git add crates/rdv/src/commands/hook.rs
git commit -m "feat(rdv): hook payloads include projectId alongside folderId"
```

---

## Task 7: Peer + Channel Commands Use Project Scope

- [ ] **Step 7.1: `peer.rs`**

Update peer list/send/summary to send `projectId` (from `RDV_PROJECT_ID` env or from the current session's project) in place of `folderId`. The internal API was updated in Phase 3 to accept project-scoped queries.

- [ ] **Step 7.2: `channel.rs`**

Same pattern: `channel list` / `channel send` / `channel messages` use project scope.

- [ ] **Step 7.3: Build + commit**

```bash
cargo build
git add crates/rdv/src/commands/peer.rs crates/rdv/src/commands/channel.rs
git commit -m "feat(rdv): peer + channel commands use project scope"
```

---

## Task 8: Tests

- [ ] **Step 8.1: `project_cli.rs`**

`crates/rdv/tests/project_cli.rs`:

```rust
use assert_cmd::Command;

#[test]
fn project_list_requires_server() {
    let mut cmd = Command::cargo_bin("rdv").unwrap();
    // RDV_API_KEY unset — should fail fast with a clear error
    cmd.env_remove("RDV_API_KEY")
        .env_remove("RDV_API_SOCKET")
        .args(&["project", "list"]);
    cmd.assert().failure();
}

#[test]
fn project_help_shows_subcommands() {
    let mut cmd = Command::cargo_bin("rdv").unwrap();
    cmd.args(&["project", "--help"]);
    cmd.assert()
        .success()
        .stdout(predicates::str::contains("list"))
        .stdout(predicates::str::contains("create"))
        .stdout(predicates::str::contains("move"));
}
```

- [ ] **Step 8.2: `group_cli.rs`**

Same pattern for `rdv group --help`.

- [ ] **Step 8.3: Run tests**

```bash
cd crates/rdv && cargo test
```

- [ ] **Step 8.4: Commit**

```bash
git add crates/rdv/tests/project_cli.rs crates/rdv/tests/group_cli.rs
git commit -m "test(rdv): add smoke tests for project + group CLI shape"
```

---

## Task 9: CHANGELOG

- [ ] **Step 9.1: Update**

```markdown
### Added
- `rdv project` subcommand for managing projects (list/create/update/move/delete).
- `rdv group` subcommand for managing project groups.

### Changed
- `rdv agent start` accepts `--project-id`; the old `--folder-id` alias stays until Phase 6.
- Hook, peer, and channel commands include `projectId` in payloads.

### Deprecated
- `rdv folder` prints a warning on every invocation; removed in Phase 6.
```

- [ ] **Step 9.2: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs(changelog): note Phase 5 rdv CLI changes"
```

---

## Phase 5 Exit Criteria

- [ ] `cargo build` in `crates/rdv/` succeeds
- [ ] `cargo test` in `crates/rdv/` succeeds
- [ ] `rdv project list` against a running dev server prints JSON
- [ ] `rdv group list` prints JSON
- [ ] `rdv folder list` still works but prints the deprecation warning
- [ ] Agent start via `rdv agent start --project-id <id>` creates a new session scoped to that project
- [ ] Hooks fire and record `projectId` on the server
- [ ] CHANGELOG updated

**On success:** `bd update remote-dev-1efl.5 --status closed`.
