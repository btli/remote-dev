# Project/Folder Coupling Refactor - Master Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement per-phase plans task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Couple "projects" strictly to "folders". Non-leaf folders become groupings (containers for preferences only). Leaf folders become projects (own sessions, tasks, channels, secrets, git, profile, account binding).

**Architecture:** Two new tables (`project_group`, `project`) replace `session_folder`. A polymorphic `node_preferences` table holds inherited preferences keyed by either a group or project. Downstream tables (`terminal_session`, `project_task`, `channel_groups`, `channels`, `agent_peer_message`, etc.) rename their `folder_id` FK to `project_id` with a non-destructive migration strategy (new column added alongside old; old dropped in Phase 6). Groups can still be "active" and display aggregated data across descendant projects via recursive CTE rollup.

**Tech Stack:** Next.js 16, React 19, Drizzle ORM, libsql (SQLite), Bun, Node.js, Rust (rdv CLI), Electron.

---

## Per-Phase Plans

Each phase has its own plan document. Execute in order (Phase 5 may run in parallel with Phase 4 after Phase 3 completes):

| Phase | Plan | bd Issue |
|-------|------|----------|
| 1 | [2026-04-20-refactor-phase-1-schema.md](2026-04-20-refactor-phase-1-schema.md) | remote-dev-1efl.1 |
| 2 | [2026-04-20-refactor-phase-2-domain.md](2026-04-20-refactor-phase-2-domain.md) | remote-dev-1efl.2 |
| 3 | [2026-04-20-refactor-phase-3-services-api.md](2026-04-20-refactor-phase-3-services-api.md) | remote-dev-1efl.3 |
| 4 | [2026-04-20-refactor-phase-4-ui.md](2026-04-20-refactor-phase-4-ui.md) | remote-dev-1efl.4 |
| 5 | [2026-04-20-refactor-phase-5-rdv.md](2026-04-20-refactor-phase-5-rdv.md) | remote-dev-1efl.5 |
| 6 | [2026-04-20-refactor-phase-6-cleanup.md](2026-04-20-refactor-phase-6-cleanup.md) | remote-dev-1efl.6 |

---

## Shared Concepts and Decisions

All phases share these decisions. Reference this section from each phase plan.

### 1. Terminology

| Old | New |
|-----|-----|
| folder (non-leaf) | group |
| folder (leaf) | project |
| `folderId` FK | `projectId` FK (on leaf-owning tables); `groupId` FK where genuinely group-scoped |
| `folder_preferences` | `node_preferences` (polymorphic by `ownerType`) |
| `session_folder` table | `project_group` + `project` tables |
| `activeFolderId` in user_settings | `activeNodeId` + `activeNodeType: "group" \| "project"` |

### 2. Hierarchy Rules

- **Groups** can nest arbitrarily (a group's `parentGroupId` points at another group; NULL means root).
- **Projects** are leaves. A project belongs to exactly one group (`groupId` NOT NULL). Projects cannot nest.
- **Root projects**: Any root-level leaf becomes a project under a single auto-created "Workspace" group. Every user has at most one "Workspace" group (created on demand during migration).

### 3. Ownership Matrix

| Asset | Owned By |
|-------|----------|
| sessions (`terminal_session`) | project |
| tasks (`project_task`) | project |
| channels (`channels`) + channel groups (`channel_groups`) | project |
| peer messages (`agent_peer_message`) | project |
| secrets config (`folder_secrets_config` → `project_secrets_config`) | project |
| github account binding (`folder_github_account_link` → `project_github_account_link`) | project |
| agent profile link (`folder_profile_link` → `project_profile_link`) | project |
| local git repo / working directory | project |
| port registry (`port_registry`) | project |
| session templates (`session_template`) | project (SET NULL, so still nullable) |
| agent configs (`agent_config`) | project |
| mcp servers (`mcp_server`) | project |
| session memory (`session_memory`) | project (SET NULL) |
| github stats prefs (`github_stats_preference`) | project (nullable for global) |
| folder repositories (`folder_repository` → `project_repository`) | project |
| preferences (inheritable: theme, font, env vars, defaults) | **both** via `node_preferences` |

### 4. Preference Inheritance

- `node_preferences` is a single polymorphic table:
  - `ownerType: "group" | "project"`
  - `ownerId: text` (matches either `project_group.id` or `project.id`)
- Inheritable fields (set at any node): `defaultWorkingDirectory`, `defaultShell`, `startupCommand`, `theme`, `fontSize`, `fontFamily`, `environmentVars` (JSON merged), `gitIdentityName`, `gitIdentityEmail`, `isSensitive`.
- Project-only fields (rejected when set on group): `githubRepoId`, `localRepoPath`, `defaultAgentProvider`, `pinnedFiles`.
- Resolution: walk from the node up through `parentGroupId` chain collecting preferences; user settings are the global fallback; field-level override semantics (not whole-record replacement). See `src/lib/preferences.ts` for the existing walker pattern — rename + generalize for groups/projects.

### 5. Groups-Can-Be-Active (Aggregation)

- A user's "active node" may be a group OR a project (`user_settings.activeNodeType` discriminator).
- When active node is a group, task/channel/peer queries aggregate across **all descendant projects** via recursive CTE:

```sql
WITH RECURSIVE descendants(id) AS (
  SELECT id FROM project_group WHERE id = :groupId
  UNION ALL
  SELECT pg.id FROM project_group pg JOIN descendants d ON pg.parent_group_id = d.id
)
SELECT p.id FROM project p WHERE p.group_id IN (SELECT id FROM descendants);
```

- This is implemented once in `GroupScopeService.resolveProjectIds(nodeId, nodeType)` → `string[]` and reused across task/channel/peer queries.

### 6. Migration Strategy

- **Big-bang, single branch** (`feat/project-folder-refactor`), commit per phase.
- **File backup**: the migration script copies `sqlite.db` → `sqlite.db.bak-<timestamp>` before running.
- **Preflight validation (Phase 1 Task 4b)**: reject cycles, orphan parent references, and cross-user parents before any write.
- **Classification** (see Phase 1 Task 5 truth table): folder with children → group; folder without children → project; group with direct contents → group + auto-created Default project.
- **Auto-Default projects**: if a pre-migration folder classified as group has direct sessions/tasks/channels/peers, create a `Default` project under it and re-home those rows.
- **Workspace wrapping**: any root leaf becomes a project under a synthetic `Workspace` group for that user.
- **Bridge columns (soft transition)**:
  - On new `project_group`: `legacyFolderId` (nullable text, unique per user) — maps the old folder ID.
  - On new `project`: `legacyFolderId` (nullable text, unique per user).
  - On every table that had `folderId`: add `projectId` (nullable text) **alongside** the old `folderId`. Phase 6 drops `folderId`.
  - **Dual-write** is required in every service that writes into a bridged table before any Phase 3/4 reader switches to `projectId`. See Phase 3 Task 10 for the complete list (SessionService, TemplateService, TaskService, ChannelService, AgentConfigService, MCPRegistryService).
- **Forward-only cutover policy (applies from Phase 3 onward)**:
  - Phase 1 can still be rolled back by restoring `sqlite.db.bak-<timestamp>` and `git reset --hard` the phase commit.
  - **After Phase 3 ships** (new write paths `/api/groups`, `/api/projects`, dual-write extended), rollback means **data loss** for any group/project created after cutover, because no reverse-sync back into `session_folder` exists. We do not plan a reverse migration; instead we operationally ban rollback after Phase 3 and rely on forward-fix.
  - If Phase 3 regresses, the fix is a forward-patch commit, not `git revert`.
- **Rollback audit window (Phase 1 only)**: `session_folder` stays populated for 30 days post-migration as an audit trail; `folder_preferences` likewise. Phase 6 drops both.

### 6a. Folder-Scoped Column Appendix

This table enumerates every folder-scoped column in the current schema and the exact migration action. Phase 1 must not add a `folder_id` reference that isn't in this list. If you add a new folder-scoped column before this refactor lands, you MUST update this appendix and the corresponding Phase 1 task.

| Source table | Source column | Migration action |
|---|---|---|
| `terminal_session` | `folder_id` | Phase 1 Task 2.1 adds `project_id` bridge column; Phase 3 dual-writes |
| `session_template` | `folder_id` | Phase 1 Task 2.2 adds `project_id` bridge column; Phase 3 dual-writes |
| `session_recording` | `folder_id` | Phase 1 Task 2.3 adds `project_id` bridge column; Phase 3 dual-writes |
| `project_task` | `folder_id` | Phase 1 Task 2.4 adds `project_id` bridge column; Phase 3 dual-writes |
| `task_dependency` | (inherits via `project_task.folder_id`) | No change; resolves through parent |
| `channels` / `channel_groups` | `folder_id` | Phase 1 Task 2.5 adds `project_id` bridge; Phase 3 dual-writes |
| `agent_peer_message` | `folder_id` | Phase 1 Task 2.6 adds `project_id` bridge; Phase 3 dual-writes |
| `agent_config` | `folder_id` | Phase 1 Task 2.7 adds `project_id` bridge; Phase 3 dual-writes |
| `mcp_server` | `folder_id` | Phase 1 Task 2.8 adds `project_id` bridge; Phase 3 dual-writes |
| `port_registry` | `folder_id` | Phase 1 Task 2.9 adds `project_id` bridge; Phase 3 dual-writes |
| `trash_item` (polymorphic) | `folder_id` where applicable | Phase 1 Task 2.10 bridge; Phase 3 dual-writes |
| `worktree_trash_metadata` | `folder_id` | Phase 1 Task 2.11 bridge |
| `folder_preferences` | all preference fields | Phase 1 Task 11 copies to `node_preferences` (project-only fields nulled on group owners) |
| `folder_secrets_config` | `folder_id` + provider config | Phase 1 Task 2.12 creates `project_secrets_config`; Task 12 migrates |
| `folder_github_account_link` | `folder_id`, `provider_account_id` | Phase 1 Task 2.14 creates `project_github_account_link`; Task 12 migrates (no `user_id` column in source) |
| `folder_profile_link` | `folder_id`, `profile_id` | Phase 1 Task 2.15 creates `project_profile_link`; Task 12 migrates (no `user_id` column in source) |
| `folder_preferences.github_repo_id` (text) | — | Carried forward via `node_preferences.github_repo_id` (Task 11) on project-owned rows |
| `folder_preferences.local_repo_path` | — | Same as above |
| `user_settings.active_folder_id` | — | Phase 1 Task 11.x translates to `active_node_id` + `active_node_type` |
| `user_settings.pinned_folder_id` | — | Phase 1 Task 11.x translates similarly |

### 7. Phase Execution Order

```
[remote-dev-1efl.7 Adversarial review]
            ↓ blocks
[Phase 1: Schema + migration] → [Phase 2: Domain] → [Phase 3: Services + API]
                                                            ↓ fans out
                                            [Phase 4: UI]   [Phase 5: rdv CLI]
                                                            ↓ fan in
                                                    [Phase 6: Cleanup + docs]
```

Phases 4 and 5 can proceed in parallel once Phase 3 is complete.

### 8. Risk Register (post-review)

- **Recursive CTE scale + cycle safety**: libsql supports `WITH RECURSIVE` but `UNION ALL` with no visit-tracking will loop forever on a cycle, and materializing descendant IDs through `inArray` hits SQLite's bind-parameter ceiling (~32k by default) on deep hierarchies. Phase 3 Task 2 uses cycle-guarded SQL and keeps aggregation in-query — never fans out to JS for `IN (?...)`. A 3-level-rollup integration test (Phase 3 Task 11) must cover this.
- libsql does not support true DDL transactions. Use `client.batch("write")` for DML only; DDL is executed sequentially with checkpointing by writing a `migration_state` row after each step.
- Unique constraints on `legacyFolderId` must be scoped per user (composite unique `(userId, legacyFolderId)`) since different users may have colliding folder IDs in practice they don't (IDs are UUIDs) but scope anyway for safety.
- **Dual-write blast radius**: SessionService is not the only writer — TemplateService, TaskService, ChannelService, AgentConfigService, MCPRegistryService all insert into bridged tables. All must dual-write before any reader switches. Phase 3 Task 10 enumerates them.
- **Dual-API window is wider than `/api/folders`**: `/api/preferences/active-folder`, folder-scoped preference/secrets/profile routes, FolderContext, TaskContext, ChannelContext, PeerChatContext all still call folder-based endpoints. Phase 3 keeps the full folder-scoped surface alive; Phase 6 is the only phase that removes routes.
- **`/api/sessions` contract change**: Phase 3 Task 7 MUST add `projectId` request parsing (with `folderId` fallback) before Phase 4/5 can depend on it. No Phase 4/5 task may assume the server accepts `projectId` unless that change has landed.
- **Polymorphic node_preferences invariant**: group-owned rows MUST NOT carry project-only fields (`githubRepoId`, `localRepoPath`, `pinnedFiles`). Phase 1 Task 11 enforces this at write time; Phase 2 `NodePreferences.forGroup` enforces it at the domain layer; Phase 3 mapper rejects non-null project-only fields on group rows on the read path.
- Drizzle schema changes require `bun run db:push` at each phase that introduces new columns. Phase 6 pushes the drop.
- **Rollback policy**: Phase 1 is reversible via backup restore. After Phase 3, rollout is forward-only (§6). If a Phase ≥3 bug surfaces, fix forward — do not `git revert` past Phase 3.

### 9. Testing Strategy Per Phase

| Phase | Testing |
|-------|---------|
| 1 | Unit: classifier, preflight, Workspace wrap. **Integration (required)**: classifier on real copy of production SQLite; crash/re-run recovery via `_migration_state` (kill migration mid-way, restart, confirm idempotence); preflight rejects cycles/orphans against real bad data. Migration dry-run on production-copy DB must pass. |
| 2 | Domain entity unit tests (Vitest); state machine + hierarchy invariants; `NodePreferences.forGroup`/`forProject` factory invariants |
| 3 | Service unit tests. **Integration (required)**: 3-level rollup against real DrizzleProjectGroupRepository (group→subgroup→project, verify task/channel/peer queries return the right IDs); concurrent-write safety during dual-write window (spawn two sessions under the same folder at the same time and verify both `folderId` and `projectId` are populated consistently); `/api/sessions` accepts `projectId`-only, `folderId`-only, and both. |
| 4 | Type-check; manual smoke via dev server; Playwright/manual for regression; ensure no folder-scoped context breaks mid-phase (dual-API window is live) |
| 5 | Rust `cargo test` for CLI commands; integration test against live terminal server; verify `--folder-id` alias still works through the deprecation window |
| 6 | Full typecheck + lint + test suite; CHANGELOG and docs review; confirm migration backup files are retained separately before `session_folder` / `folder_preferences` drop |

---

## Cross-Phase Invariants (MUST hold at end of each phase)

1. **`bun run typecheck` passes** at the end of every phase commit.
2. **`bun run test:run` passes** at the end of every phase commit (new tests from that phase plus all prior tests).
3. **Application still boots and renders the sidebar** at the end of every phase (even Phase 1, which adds schema but changes nothing UI-visible).
4. **No data loss**: `select count(*) from terminal_session` is non-decreasing across phases; ditto for `project_task`, `channel` rows, etc.

---

## Self-Review Checklist (applied after all phase plans are written)

- [ ] Every table in schema.ts that references `folder_id` has a rename strategy in a phase plan
- [ ] Every React context / UI file using folders has a phase 4 task
- [ ] Every `rdv` CLI subcommand referencing folders has a phase 5 task
- [ ] The migration script handles: empty DB, DB with only root leaves, DB with nested groups, DB with group-with-sessions (requires Default project), DB with already-migrated state (idempotent early-exit)
- [ ] Phase 6 drops all bridge columns and old tables and updates docs
- [ ] CHANGELOG.md is updated at end of each phase with an `### Changed` line
