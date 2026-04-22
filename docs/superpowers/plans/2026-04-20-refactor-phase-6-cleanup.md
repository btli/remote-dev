# Phase 6: Cleanup + Docs + Tests - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans.

**Goal:** Retire legacy `folder_*` tables, columns, code paths, and deprecation shims. Tighten new schema (`project_id` becomes NOT NULL where appropriate). Update docs (`CLAUDE.md`, `docs/ARCHITECTURE.md`, `docs/API.md`, `docs/openapi.yaml`, README). Run full test suite, fix any fallout.

**Architecture:** A three-pass cleanup: (1) make `project_id` NOT NULL on tables where every row is now populated; (2) drop old `folder_id` columns, old tables (`session_folder`, `folder_preferences`, `folder_secrets_config`, `folder_github_account_link`, `folder_profile_link`, `folder_repository`), old contexts/components, old `rdv folder` subcommand; (3) docs refresh.

**Tech Stack:** Drizzle ORM, Vitest, Rust, Markdown.

Reference: [Master plan](2026-04-20-project-folder-refactor-master.md).

---

## File Structure

**Delete:**
- `src/domain/entities/Folder.ts`
- `src/domain/value-objects/FolderStatus.ts` (if present)
- `src/application/use-cases/folder/**`
- `src/application/ports/FolderRepository.ts`
- `src/infrastructure/persistence/repositories/DrizzleFolderRepository.ts`
- `src/infrastructure/persistence/mappers/folderMapper.ts`
- `src/services/folder-service.ts`
- `src/services/folder-scope-util.ts` (legacy translator)
- `src/contexts/FolderContext.tsx`
- `src/components/preferences/FolderPreferencesModal.tsx`
- `src/app/api/folders/**`
- `src/app/api/preferences/folders/**`
- `src/app/api/preferences/active-folder/**`
- `crates/rdv/src/commands/folder.rs`

**Modify (schema tightening + old column drops):**
- `src/db/schema.ts` — drop `session_folder`, `folder_preferences`, `folder_secrets_config`, `folder_github_account_link`, `folder_profile_link`, `folder_repository`; drop `folder_id` columns on all 16 dependent tables; make `project_id` NOT NULL where appropriate; drop `active_folder_id`/`pinned_folder_id` from `user_settings`.
- `package.json` — drop `db:migrate-folders` script; retain migration file for 1 release then remove.

**Modify (docs):**
- `CLAUDE.md` — rewrite the "Folders / Projects" section to match the new hierarchy
- `docs/ARCHITECTURE.md` — update layer descriptions
- `docs/API.md` — remove folder endpoints, document project/group endpoints
- `docs/openapi.yaml` — update (remove old paths, add new)
- `README.md` if it references folders

---

## Preconditions

- Phase 4 and Phase 5 are both closed (`bd ready` shows no blockers).
- `bun run typecheck` and `bun run test:run` are green on `HEAD`.
- `sqlite.db` has the `_migration_state` row `folders-to-projects:complete = done`.

**STOP** if any of these are not true.

---

## Task 1: Final Backfill Audit

Before dropping columns, every `project_id` on rows that still have `folder_id` must resolve. If any do not, create a follow-up bd issue and **do not proceed**.

- [ ] **Step 1.1: Audit script**

Create `scripts/audit-folder-project-coverage.ts`:

```typescript
import { db } from "@/db";
import { createLogger } from "@/lib/logger";
import { isNull, and, isNotNull, sql } from "drizzle-orm";
import {
  terminalSessions,
  projectTasks,
  channelGroups,
  channels,
  agentPeerMessages,
  agentConfigs,
  mcpServers,
  sessionMemory,
  githubStatsPreferences,
  portRegistry,
  sessionTemplates,
  worktreeTrashMetadata,
} from "@/db/schema";

const log = createLogger("AuditFolderProjectCoverage");

const tables = [
  { name: "terminal_session", t: terminalSessions, folderCol: terminalSessions.folderId, projectCol: terminalSessions.projectId },
  { name: "project_task", t: projectTasks, folderCol: projectTasks.folderId, projectCol: projectTasks.projectId },
  { name: "channel_groups", t: channelGroups, folderCol: channelGroups.folderId, projectCol: channelGroups.projectId },
  { name: "channels", t: channels, folderCol: channels.folderId, projectCol: channels.projectId },
  { name: "agent_peer_message", t: agentPeerMessages, folderCol: agentPeerMessages.folderId, projectCol: agentPeerMessages.projectId },
  { name: "agent_config", t: agentConfigs, folderCol: agentConfigs.folderId, projectCol: agentConfigs.projectId },
  { name: "mcp_server", t: mcpServers, folderCol: mcpServers.folderId, projectCol: mcpServers.projectId },
  { name: "session_memory", t: sessionMemory, folderCol: sessionMemory.folderId, projectCol: sessionMemory.projectId },
  { name: "github_stats_preference", t: githubStatsPreferences, folderCol: githubStatsPreferences.folderId, projectCol: githubStatsPreferences.projectId },
  { name: "port_registry", t: portRegistry, folderCol: portRegistry.folderId, projectCol: portRegistry.projectId },
  { name: "session_template", t: sessionTemplates, folderCol: sessionTemplates.folderId, projectCol: sessionTemplates.projectId },
];

async function main() {
  let failed = false;
  for (const tbl of tables) {
    const orphans = await db
      .select({ count: sql<number>`count(*)` })
      .from(tbl.t)
      .where(and(isNotNull(tbl.folderCol), isNull(tbl.projectCol)));
    const count = Number(orphans[0].count);
    if (count > 0) {
      failed = true;
      log.error(`${tbl.name}: ${count} rows have folder_id but no project_id`);
    } else {
      log.info(`${tbl.name}: OK`);
    }
  }
  if (failed) {
    log.error("Audit failed; Phase 6 cannot proceed until every row has project_id");
    process.exit(1);
  }
  log.info("All tables have project_id coverage ✓");
}

main().catch((err) => {
  log.error("audit crashed", { error: String(err) });
  process.exit(1);
});
```

Add script entry to `package.json`:

```json
"db:audit-coverage": "bun run scripts/audit-folder-project-coverage.ts",
```

- [ ] **Step 1.2: Run audit**

```bash
bun run db:audit-coverage
```

Expected: every table reports OK.

- [ ] **Step 1.3: Commit**

```bash
git add scripts/audit-folder-project-coverage.ts package.json
git commit -m "chore(db): add coverage audit script to verify project_id backfill"
```

---

## Task 2: Tighten `project_id` NOT NULL Where Data is Required

- [ ] **Step 2.1: Edit `src/db/schema.ts`**

Change the following `project_id` columns to `.notNull()` (these have full coverage post-migration):
- `projectTasks.projectId`
- `channelGroups.projectId`
- `channels.projectId`
- `agentPeerMessages.projectId`

Keep nullable (rows that legitimately have no project):
- `terminalSessions.projectId` (allowed NULL for unscoped legacy sessions; Phase 6 policy decision)
- `sessionTemplates.projectId` (templates can be global)
- `sessionMemory.projectId`
- `githubStatsPreferences.projectId`
- `portRegistry.projectId` (port registry sometimes user-scoped only)
- `agentConfigs.projectId`, `mcpServers.projectId` (can be user-global)

- [ ] **Step 2.2: Push schema**

```bash
bun run db:push
```

Expected: Drizzle reports adding NOT NULL. Accept prompt.

- [ ] **Step 2.3: Commit**

```bash
git add src/db/schema.ts
git commit -m "chore(schema): enforce NOT NULL on project_id where every row has coverage"
```

---

## Task 3: Drop Old `folder_id` Columns

- [ ] **Step 3.1: Remove `folder_id` from every dependent table**

Edit `src/db/schema.ts`:

For each of `terminalSessions`, `sessionTemplates`, `projectTasks`, `channelGroups`, `channels`, `agentPeerMessages`, `agentConfigs`, `mcpServers`, `sessionMemory`, `githubStatsPreferences`, `portRegistry`:
- Delete the `folderId: text("folder_id")...` declaration.
- Delete any index referencing `t.folderId`.

Also delete `worktreeTrashMetadata.originalFolderId` + `originalFolderName`.

- [ ] **Step 3.2: Remove old folder-scoped link tables**

Delete the definitions of:
- `sessionFolders`
- `folderPreferences`
- `folderSecretsConfig`
- `folderGitHubAccountLinks`
- `folderProfileLinks`
- `folderRepositories`

- [ ] **Step 3.3: Drop legacy columns on `user_settings`**

Remove `activeFolderId` and `pinnedFolderId` from `userSettings`.

- [ ] **Step 3.4: Push + verify**

```bash
bun run db:push
```

Drizzle will prompt for destructive changes. Accept.

- [ ] **Step 3.5: Commit**

```bash
git add src/db/schema.ts
git commit -m "chore(schema): drop folder_id columns and legacy folder-scoped tables"
```

---

## Task 4: Delete Legacy TypeScript Code

- [ ] **Step 4.1: Delete domain + app layer files**

```bash
rm src/domain/entities/Folder.ts
rm -f src/domain/value-objects/FolderStatus.ts
rm -rf src/application/use-cases/folder
rm -f src/application/ports/FolderRepository.ts
rm -f src/infrastructure/persistence/repositories/DrizzleFolderRepository.ts
rm -f src/infrastructure/persistence/mappers/folderMapper.ts
rm -f src/services/folder-service.ts
rm -f src/services/folder-scope-util.ts
```

- [ ] **Step 4.2: Delete context + components**

```bash
rm src/contexts/FolderContext.tsx
rm src/components/preferences/FolderPreferencesModal.tsx
```

- [ ] **Step 4.3: Delete old API routes**

```bash
rm -rf src/app/api/folders
rm -rf src/app/api/preferences/folders
rm -rf src/app/api/preferences/active-folder
```

- [ ] **Step 4.4: Clean container**

Edit `src/infrastructure/container.ts` — remove every `folder*` binding and its use-cases.

- [ ] **Step 4.5: Clean imports**

Run: `bun run typecheck` — every remaining reference to the deleted symbols surfaces as an error. Fix each in-place:
- Most will be dead imports in service files — delete the line.
- Any live consumer must have been migrated in Phase 3/4; if one was missed, migrate it now and note in CHANGELOG.

- [ ] **Step 4.6: Commit**

```bash
git add -A
git commit -m "chore(code): delete legacy folder domain, services, context, components, API"
```

---

## Task 5: Delete Legacy rdv Subcommand

- [ ] **Step 5.1: Delete `folder.rs`**

```bash
rm crates/rdv/src/commands/folder.rs
```

Edit `crates/rdv/src/commands/mod.rs` — remove `pub mod folder;`.
Edit `crates/rdv/src/main.rs` — remove the `Folder` variant and its dispatch.

- [ ] **Step 5.2: Drop `--folder-id` alias in `agent.rs`**

Remove the `alias = "folder-id"` on `--project-id` in agent args.

- [ ] **Step 5.3: Build + test**

```bash
cd crates/rdv && cargo build && cargo test
```

- [ ] **Step 5.4: Commit**

```bash
git add crates/rdv/
git commit -m "chore(rdv): remove deprecated folder subcommand and folder-id alias"
```

---

## Task 6: Remove Migration Script

Keep the migration script file for one more release as a reference, but remove the npm script entry. Mark the script itself as archived by moving it under `scripts/archive/`.

- [ ] **Step 6.1: Move**

```bash
mkdir -p scripts/archive
git mv scripts/migrate-folders-to-projects.ts scripts/archive/migrate-folders-to-projects.ts
git mv scripts/audit-folder-project-coverage.ts scripts/archive/audit-folder-project-coverage.ts
```

- [ ] **Step 6.2: Remove from package.json**

Delete `db:migrate-folders` and `db:audit-coverage` entries.

- [ ] **Step 6.3: Commit**

```bash
git add scripts package.json
git commit -m "chore: archive folder→project migration scripts"
```

---

## Task 7: Full Quality Gates

- [ ] **Step 7.1: Typecheck**

```bash
bun run typecheck
```

Expected: PASS.

- [ ] **Step 7.2: Lint**

```bash
bun run lint
```

Fix any reported issues inline.

- [ ] **Step 7.3: Tests**

```bash
bun run test:run
```

Expected: all green. If tests reference `FolderContext` or `FolderService`, update them to project/group equivalents.

- [ ] **Step 7.4: Build**

```bash
bun run build
```

Expected: successful Next.js production build.

- [ ] **Step 7.5: Rust tests**

```bash
cd crates/rdv && cargo test && cargo build --release
```

- [ ] **Step 7.6: Commit any test/lint fixes**

```bash
git add -A
git commit -m "chore: fix typecheck/lint/test fallout from Phase 6 cleanup"
```

---

## Task 8: Documentation Refresh

- [ ] **Step 8.1: Update `CLAUDE.md`**

In the "Database Layer" section, replace `session_folder`, `folder_preferences`, `folder_secrets_config`, `folder_github_account_link`, `folder_profile_link` rows with the new equivalents:

```markdown
| `project_group` | Nestable grouping containers (preferences only) |
| `project` | Leaf project nodes (owns sessions, tasks, channels, secrets, git) |
| `node_preferences` | Polymorphic preferences keyed by (ownerId, ownerType) |
| `project_secrets_config` | Per-project secrets provider |
| `project_github_account_link` | Per-project GitHub account binding |
| `project_profile_link` | Per-project agent profile binding |
| `project_repository` | Per-project repo + local path association |
```

Update the "API Routes" section: remove `/api/folders*`, add `/api/groups`, `/api/projects`, `/api/node-preferences/*`, `/api/preferences/active-node`.

Update the "State Management" section: replace `FolderContext` with `ProjectTreeContext`, noting aggregation support.

- [ ] **Step 8.2: Update `docs/ARCHITECTURE.md`** with the same changes.

- [ ] **Step 8.3: Update `docs/API.md`** — remove folder endpoint docs, add group/project/node-preferences endpoint docs. The schemas should match the Zod schemas in Phase 3.

- [ ] **Step 8.4: Update `docs/openapi.yaml`** — same.

- [ ] **Step 8.5: README sanity scan**

Run: `grep -n 'folder' README.md`. Update any references that still say "folders" to "projects" or "groups" as appropriate.

- [ ] **Step 8.6: Commit**

```bash
git add CLAUDE.md docs/ README.md
git commit -m "docs: rewrite folder-referencing docs for new project/group hierarchy"
```

---

## Task 9: CHANGELOG Release Stamp

- [ ] **Step 9.1: Promote Unreleased → version stamp**

Replace `## [Unreleased]` heading with `## [X.Y.Z] - 2026-04-20` (pick the next minor version). Add a new empty `## [Unreleased]` section at the top.

- [ ] **Step 9.2: Summarize the refactor in the release notes**

Under the new version section, ensure the following lines are present (consolidated from earlier Phase-specific CHANGELOG entries):

```markdown
### Breaking
- `folder` concept removed. The API is now organized around **project groups** (containers, preferences only) and **projects** (leaves, own sessions/tasks/channels/secrets).
- `/api/folders/*` endpoints removed; use `/api/projects/*` and `/api/groups/*`.
- `rdv folder` subcommand removed; use `rdv project` and `rdv group`.
- `user_settings.active_folder_id` replaced by `active_node_id` + `active_node_type` (`"group" | "project"`).

### Added
- Recursive descendant-project rollup when the active node is a group — tasks, channels, and peer messages aggregate automatically.
```

- [ ] **Step 9.3: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs(changelog): stamp release with project/folder refactor summary"
```

---

## Task 10: Smoke Test the Whole App

- [ ] **Step 10.1: Fresh dev server**

```bash
bun run dev
```

- [ ] **Step 10.2: Manual regression**

- [ ] Sign in as a seeded user.
- [ ] Sidebar renders a group/project tree.
- [ ] Create a new group, create a project inside it, drop into the project — all via UI.
- [ ] Launch a new terminal session in that project; confirm the DB row has `project_id` set and `folder_id` column no longer exists.
- [ ] Switch active node to the group; the task sidebar and channel sidebar show aggregated data across all descendant projects.
- [ ] Open `ProjectPreferencesModal` for the project; set `defaultWorkingDirectory`; save; reopen — persists.
- [ ] Open `GroupPreferencesModal` for the group; attempt to set `localRepoPath` (should not be shown — project-only field).
- [ ] Run `rdv project list` and `rdv group list` — both return JSON.
- [ ] Run `rdv folder list` — fails with "unknown subcommand: folder".

- [ ] **Step 10.3: Close the dev server**

---

## Phase 6 Exit Criteria

- [ ] `bun run typecheck` + `bun run lint` + `bun run test:run` + `bun run build` all green
- [ ] `cargo build` + `cargo test` in `crates/rdv/` green
- [ ] All legacy `folder*` code deleted (TS, Rust, SQL schema)
- [ ] Coverage audit passes before column drops
- [ ] Docs updated (`CLAUDE.md`, `docs/ARCHITECTURE.md`, `docs/API.md`, `docs/openapi.yaml`, README)
- [ ] CHANGELOG stamped with release version
- [ ] Manual smoke test passes

**On success:**
```bash
bd update remote-dev-1efl.6 --status closed
bd update remote-dev-1efl --status closed
```

Follow the project's Session Completion protocol to pull/rebase, push, and verify.
