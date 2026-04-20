# Phase 1: Schema + Migration Script - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Introduce `project_group`, `project`, and `node_preferences` tables to the Drizzle schema. Add nullable `project_id` bridge columns to every table currently keyed by `folder_id`. Write a one-shot migration script that copies data from old tables to new without destroying the old yet. Production user's DB must survive the migration and the app must boot unchanged after it.

**Architecture:** Additive-only schema changes in Phase 1. The app still reads `folder_id` throughout; new `project_id` columns are populated but unused until Phase 3. A migration script (`scripts/migrate-folders-to-projects.ts`) classifies folders by shape, builds the new tree, and backfills bridge columns. Idempotent via a `migration_state` key-value table.

**Tech Stack:** Drizzle ORM, libsql, TypeScript (Bun runtime).

Reference: [Master plan](2026-04-20-project-folder-refactor-master.md) for shared terminology and decisions.

---

## File Structure

**Create:**
- `scripts/migrate-folders-to-projects.ts` — the migration script (entrypoint)
- `src/db/migrations/migration-state.ts` — tiny helper for idempotent migration
- `tests/migrations/folders-to-projects.test.ts` — unit tests for classifier + Workspace wrap

**Modify:**
- `src/db/schema.ts` — add new tables, add `projectId` bridge columns to 16 tables, add `activeNodeId` / `activeNodeType` / `pinnedNodeId` / `pinnedNodeType` to `user_settings`
- `package.json` — add `db:migrate-folders` script
- `CHANGELOG.md` — note Phase 1 changes under `[Unreleased]`

**Do NOT touch** (explicitly deferred to later phases):
- Anything in `src/services/`, `src/domain/`, `src/application/`, `src/contexts/`, `src/components/`, `crates/rdv/`.
- Existing `folder_id` columns — leave them in place.
- `folder_preferences`, `session_folder` — leave in place; migration reads from them.

---

## Task 1: Add New Table Definitions to schema.ts

**Files:**
- Modify: `src/db/schema.ts` (append new tables after `litellmModels`)

- [ ] **Step 1.1: Add `projectGroups` table**

Append to end of `src/db/schema.ts` (before any trailing exports block):

```typescript
// ─────────────────────────────────────────────────────────────────────────
// Project / Group Coupling (Phase 1 of folder refactor)
// ─────────────────────────────────────────────────────────────────────────

import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";

export const projectGroups: ReturnType<typeof sqliteTable> = sqliteTable(
  "project_group",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // Self-reference: parent of a group is another group. null = top-level.
    parentGroupId: text("parent_group_id").references(
      (): AnySQLiteColumn => projectGroups.id,
      { onDelete: "set null" }
    ),
    name: text("name").notNull(),
    collapsed: integer("collapsed", { mode: "boolean" }).notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    legacyFolderId: text("legacy_folder_id"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    index("project_group_user_idx").on(t.userId),
    index("project_group_parent_idx").on(t.parentGroupId),
    uniqueIndex("project_group_legacy_user_idx").on(t.userId, t.legacyFolderId),
  ]
);
```

- [ ] **Step 1.2: Add `projects` table**

Immediately after `projectGroups`:

```typescript
export const projects = sqliteTable(
  "project",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    groupId: text("group_id")
      .notNull()
      .references(() => projectGroups.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    collapsed: integer("collapsed", { mode: "boolean" }).notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    isAutoCreated: integer("is_auto_created", { mode: "boolean" })
      .notNull()
      .default(false),
    legacyFolderId: text("legacy_folder_id"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    index("project_user_idx").on(t.userId),
    index("project_group_idx").on(t.groupId),
    uniqueIndex("project_legacy_user_idx").on(t.userId, t.legacyFolderId),
  ]
);
```

- [ ] **Step 1.3: Add `nodePreferences` table (polymorphic)**

Immediately after `projects`:

```typescript
export const nodePreferences = sqliteTable(
  "node_preferences",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    ownerType: text("owner_type", { enum: ["group", "project"] }).notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    defaultWorkingDirectory: text("default_working_directory"),
    defaultShell: text("default_shell"),
    startupCommand: text("startup_command"),
    theme: text("theme"),
    fontSize: integer("font_size"),
    fontFamily: text("font_family"),
    // NOTE: text, not integer. `folder_preferences.githubRepoId` references
    // `github_repository.id` (a text UUID), so the polymorphic node store must
    // preserve that type.
    githubRepoId: text("github_repo_id"),
    localRepoPath: text("local_repo_path"),
    defaultAgentProvider: text("default_agent_provider"),
    environmentVars: text("environment_vars", { mode: "json" }),
    pinnedFiles: text("pinned_files", { mode: "json" }),
    gitIdentityName: text("git_identity_name"),
    gitIdentityEmail: text("git_identity_email"),
    isSensitive: integer("is_sensitive", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    index("node_pref_owner_idx").on(t.ownerId, t.ownerType),
    uniqueIndex("node_pref_owner_user_idx").on(t.ownerId, t.ownerType, t.userId),
  ]
);
```

- [ ] **Step 1.4: Typecheck after table additions**

Run: `bun run typecheck`
Expected: PASS (tables reference only existing symbols; no circular refs).

- [ ] **Step 1.5: Commit**

```bash
git add src/db/schema.ts
git commit -m "feat(schema): add project_group, project, node_preferences tables"
```

---

## Task 2: Add `project_id` Bridge Columns to Existing Tables

Drizzle schema additions. Every column is **nullable** in Phase 1 so existing rows are valid without backfill. Phase 1 migration will populate these; Phase 6 will make them NOT NULL (where appropriate) and drop old `folder_id`.

**Files:**
- Modify: `src/db/schema.ts` (edit existing table definitions in place)

- [ ] **Step 2.1: `terminalSessions` — add `projectId`**

Find `terminalSessions = sqliteTable("terminal_session", {`. Add immediately after `folderId` declaration:

```typescript
    projectId: text("project_id").references(() => projects.id, {
      onDelete: "set null",
    }),
```

Also add to the index block at the bottom of the table definition:

```typescript
    index("terminal_session_project_idx").on(t.projectId),
```

- [ ] **Step 2.2: `sessionTemplates` — add `projectId`**

```typescript
    projectId: text("project_id").references(() => projects.id, {
      onDelete: "set null",
    }),
```

Add index `index("session_template_project_idx").on(t.projectId)`.

- [ ] **Step 2.3: `projectTasks` — add `projectId`**

Field (nullable in Phase 1; Phase 6 will enforce NOT NULL):

```typescript
    projectId: text("project_id").references(() => projects.id, {
      onDelete: "cascade",
    }),
```

Add `index("project_task_project_idx").on(t.projectId)`.

- [ ] **Step 2.4: `channelGroups` — add `projectId`**

```typescript
    projectId: text("project_id").references(() => projects.id, {
      onDelete: "cascade",
    }),
```

Add `index("channel_groups_project_idx").on(t.projectId)`.

- [ ] **Step 2.5: `channels` — add `projectId`**

```typescript
    projectId: text("project_id").references(() => projects.id, {
      onDelete: "cascade",
    }),
```

Add `index("channels_project_idx").on(t.projectId)`.

- [ ] **Step 2.6: `agentPeerMessages` — add `projectId`**

```typescript
    projectId: text("project_id"),
```

(No FK: this table already stores `folderId` as plain text without FK for flexibility. Retain that pattern.)
Add `index("peer_msg_project_idx").on(t.projectId)`.

- [ ] **Step 2.7: `agentConfigs` — add `projectId`**

```typescript
    projectId: text("project_id").references(() => projects.id, {
      onDelete: "cascade",
    }),
```

Add `index("agent_config_project_idx").on(t.projectId)`.

- [ ] **Step 2.8: `mcpServers` — add `projectId`**

```typescript
    projectId: text("project_id").references(() => projects.id, {
      onDelete: "cascade",
    }),
```

Add `index("mcp_server_project_idx").on(t.projectId)`.

- [ ] **Step 2.9: `sessionMemory` — add `projectId`**

```typescript
    projectId: text("project_id").references(() => projects.id, {
      onDelete: "set null",
    }),
```

Add `index("session_memory_project_idx").on(t.projectId)`.

- [ ] **Step 2.10: `githubStatsPreferences` — add `projectId`**

```typescript
    projectId: text("project_id").references(() => projects.id, {
      onDelete: "cascade",
    }),
```

- [ ] **Step 2.11: `portRegistry` — add `projectId`**

```typescript
    projectId: text("project_id").references(() => projects.id, {
      onDelete: "cascade",
    }),
```

Add `index("port_registry_project_idx").on(t.projectId)`.

- [ ] **Step 2.12: `worktreeTrashMetadata` — add `originalProjectId`, `originalProjectName`**

These are plain text columns (trash rows must survive project deletion):

```typescript
    originalProjectId: text("original_project_id"),
    originalProjectName: text("original_project_name"),
```

- [ ] **Step 2.13: `folderSecretsConfig` — rename to `projectSecretsConfig` as NEW table, keep old**

Do NOT rename in place. Append as a new table immediately after `nodePreferences`:

```typescript
export const projectSecretsConfig = sqliteTable(
  "project_secrets_config",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    providerConfig: text("provider_config", { mode: "json" }).notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    lastFetchedAt: integer("last_fetched_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    uniqueIndex("project_secrets_project_user_idx").on(t.projectId, t.userId),
  ]
);
```

- [ ] **Step 2.14: `folderGitHubAccountLinks` → new `projectGitHubAccountLinks`**

Real source table (`folder_github_account_link`): only `folder_id` (PK), `provider_account_id`, `created_at` — no `user_id`, no `github_account_id`. Mirror that shape exactly.

```typescript
export const projectGitHubAccountLinks = sqliteTable(
  "project_github_account_link",
  {
    projectId: text("project_id")
      .primaryKey()
      .references(() => projects.id, { onDelete: "cascade" }),
    // Text PK of githubAccountMetadata (GitHub numeric user ID as string).
    providerAccountId: text("provider_account_id").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index("project_gh_link_account_idx").on(t.providerAccountId)]
);
```

- [ ] **Step 2.15: `folderProfileLinks` → new `projectProfileLinks`**

Real source table (`folder_profile_link`): only `folder_id` (PK), `profile_id`, `created_at` — no `user_id`. Mirror that.

```typescript
export const projectProfileLinks = sqliteTable(
  "project_profile_link",
  {
    projectId: text("project_id")
      .primaryKey()
      .references(() => projects.id, { onDelete: "cascade" }),
    profileId: text("profile_id")
      .notNull()
      .references(() => agentProfiles.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index("project_profile_link_profile_idx").on(t.profileId)]
);
```

- [ ] **Step 2.16: (REMOVED — no `folder_repository` table exists)**

Repository association today is stored in two places: `folder_preferences.githubRepoId` / `folder_preferences.localRepoPath` (text, refs `github_repository.id` or a manual path) and the global `github_repository` catalog. There is no `folderRepositories` table to migrate. Repo fields already live in `nodePreferences` (Step 1.3) as the per-node override, which is the project-only path after cutover. Skip this step.

- [ ] **Step 2.17: `userSettings` — add active/pinned node fields**

Find `userSettings = sqliteTable("user_settings", {`. Add after `pinnedFolderId`:

```typescript
    activeNodeId: text("active_node_id"),
    activeNodeType: text("active_node_type", { enum: ["group", "project"] }),
    pinnedNodeId: text("pinned_node_id"),
    pinnedNodeType: text("pinned_node_type", { enum: ["group", "project"] }),
```

- [ ] **Step 2.18: Typecheck**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 2.19: Push schema to dev DB**

Run: `bun run db:push`
Expected: Drizzle reports new tables + new columns, no destructive changes. Accept prompt.

- [ ] **Step 2.20: Commit**

```bash
git add src/db/schema.ts
git commit -m "feat(schema): add project_id bridge columns and project-scoped link tables"
```

---

## Task 3: Write Migration State Helper

**Files:**
- Create: `src/db/migrations/migration-state.ts`

- [ ] **Step 3.1: Write the helper**

```typescript
// src/db/migrations/migration-state.ts
import { db, client } from "@/db";

const MIGRATION_STATE_TABLE = "_migration_state";

async function ensureTable() {
  await client.execute(`
    CREATE TABLE IF NOT EXISTS ${MIGRATION_STATE_TABLE} (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);
}

export async function getMigrationState(key: string): Promise<string | null> {
  await ensureTable();
  const result = await client.execute({
    sql: `SELECT value FROM ${MIGRATION_STATE_TABLE} WHERE key = ?`,
    args: [key],
  });
  return result.rows[0]?.value as string | null ?? null;
}

export async function setMigrationState(key: string, value: string): Promise<void> {
  await ensureTable();
  await client.execute({
    sql: `INSERT INTO ${MIGRATION_STATE_TABLE} (key, value, updated_at) VALUES (?, ?, ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    args: [key, value, Date.now()],
  });
}
```

- [ ] **Step 3.2: Commit**

```bash
git add src/db/migrations/migration-state.ts
git commit -m "chore(db): add migration-state helper for idempotent migrations"
```

---

## Task 4: Write the Migration Script

**Files:**
- Create: `scripts/migrate-folders-to-projects.ts`

The script performs 8 distinct steps. Each step writes a progress marker via `setMigrationState("folders-to-projects:step-N", "done")` so a re-run picks up where it left off.

- [ ] **Step 4.1: Add script skeleton with backup**

```typescript
// scripts/migrate-folders-to-projects.ts
import { randomUUID } from "node:crypto";
import { copyFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { db, client } from "@/db";
import {
  sessionFolders,
  folderPreferences,
  folderSecretsConfig,
  folderGitHubAccountLinks,
  folderProfileLinks,
  terminalSessions,
  sessionTemplates,
  projectTasks,
  channelGroups,
  channels,
  agentPeerMessages,
  agentConfigs,
  mcpServers,
  sessionMemory,
  githubStatsPreferences,
  portRegistry,
  worktreeTrashMetadata,
  userSettings,
  projectGroups,
  projects,
  nodePreferences,
  projectSecretsConfig,
  projectGitHubAccountLinks,
  projectProfileLinks,
  // NOTE: no `projectRepositories` — repo info lives on `nodePreferences` project rows (see Step 2.16).
} from "@/db/schema";
import { and, eq, isNull, sql } from "drizzle-orm";
import {
  getMigrationState,
  setMigrationState,
} from "@/db/migrations/migration-state";
import { createLogger } from "@/lib/logger";

const log = createLogger("MigrateFoldersToProjects");
const MIGRATION_KEY_PREFIX = "folders-to-projects";
const DRY_RUN = process.argv.includes("--dry-run");

function k(step: string) {
  return `${MIGRATION_KEY_PREFIX}:${step}`;
}

async function backupDatabase() {
  const dbPath = resolve(process.cwd(), "sqlite.db");
  if (!existsSync(dbPath)) {
    log.warn("No sqlite.db found to back up; assuming first-run dev DB.");
    return;
  }
  const backupPath = `${dbPath}.bak-${Date.now()}`;
  copyFileSync(dbPath, backupPath);
  log.info("Backup created", { backupPath });
}

async function main() {
  log.info("Starting folders→projects migration", { dryRun: DRY_RUN });
  if (!DRY_RUN) {
    await backupDatabase();
  }
  // Subsequent steps added in later tasks.
  log.info("Migration skeleton ready; no-op until subsequent tasks land.");
}

main().catch((err) => {
  log.error("Migration failed", { error: String(err) });
  process.exit(1);
});
```

- [ ] **Step 4.2: Commit**

```bash
git add scripts/migrate-folders-to-projects.ts
git commit -m "feat(migration): scaffold folders→projects migration script with backup"
```

- [ ] **Step 4.3: Add `db:migrate-folders` to package.json**

Edit `package.json` `scripts` block, add after `db:migrate-channels`:

```json
    "db:migrate-folders": "bun run scripts/migrate-folders-to-projects.ts",
```

- [ ] **Step 4.4: Commit**

```bash
git add package.json
git commit -m "chore: add db:migrate-folders npm script"
```

---

## Task 4b: Preflight — reject bad folder graphs before any writes

Even though the existing `session_folder` table has no FK on `parent_id`, the migration must never half-write groups/projects because of a cycle or an orphan (a `parent_id` that references a deleted folder, or one that belongs to a different user). This is a P0 safety gate.

**Files:**
- Modify: `scripts/migrate-folders-to-projects.ts`
- Create: `tests/migrations/folders-preflight.test.ts`

- [ ] **Step 4b.1: Write the failing preflight tests**

`tests/migrations/folders-preflight.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { validateFolderGraph } from "@/../scripts/migrate-folders-to-projects";

interface Folder {
  id: string;
  userId: string;
  parentId: string | null;
  name: string;
}

describe("validateFolderGraph", () => {
  it("accepts a clean tree", () => {
    const folders: Folder[] = [
      { id: "a", userId: "u1", parentId: null, name: "Root" },
      { id: "b", userId: "u1", parentId: "a", name: "Child" },
    ];
    expect(() => validateFolderGraph(folders)).not.toThrow();
  });

  it("rejects a cycle", () => {
    const folders: Folder[] = [
      { id: "a", userId: "u1", parentId: "b", name: "A" },
      { id: "b", userId: "u1", parentId: "a", name: "B" },
    ];
    expect(() => validateFolderGraph(folders)).toThrow(/cycle/i);
  });

  it("rejects an orphan parent reference", () => {
    const folders: Folder[] = [
      { id: "a", userId: "u1", parentId: "missing", name: "A" },
    ];
    expect(() => validateFolderGraph(folders)).toThrow(/orphan/i);
  });

  it("rejects a cross-user parent reference", () => {
    const folders: Folder[] = [
      { id: "a", userId: "u1", parentId: null, name: "A" },
      { id: "b", userId: "u2", parentId: "a", name: "B" },
    ];
    expect(() => validateFolderGraph(folders)).toThrow(/cross-user/i);
  });
});
```

- [ ] **Step 4b.2: Run test to verify it fails**

Run: `bun run test:run tests/migrations/folders-preflight.test.ts`
Expected: FAIL with "validateFolderGraph is not exported".

- [ ] **Step 4b.3: Implement `validateFolderGraph`**

Add to `scripts/migrate-folders-to-projects.ts` above `classifyFolders`:

```typescript
export function validateFolderGraph(folders: FolderRow[]): void {
  const byId = new Map<string, FolderRow>();
  for (const f of folders) byId.set(f.id, f);

  // Orphan check: every non-null parentId must resolve.
  for (const f of folders) {
    if (f.parentId && !byId.has(f.parentId)) {
      throw new Error(
        `Orphan parent reference: folder ${f.id} ('${f.name}') points to missing parent ${f.parentId}`
      );
    }
    if (f.parentId) {
      const parent = byId.get(f.parentId)!;
      if (parent.userId !== f.userId) {
        throw new Error(
          `Cross-user parent reference: folder ${f.id} (user ${f.userId}) under parent ${parent.id} (user ${parent.userId})`
        );
      }
    }
  }

  // Cycle check: DFS from each node, abort if we revisit on current stack.
  const color = new Map<string, 0 | 1 | 2>(); // 0=unseen, 1=onstack, 2=done
  const walk = (id: string, path: string[]): void => {
    const state = color.get(id) ?? 0;
    if (state === 1) {
      throw new Error(`Cycle detected in folder parent graph: ${[...path, id].join(" -> ")}`);
    }
    if (state === 2) return;
    color.set(id, 1);
    const node = byId.get(id);
    if (node?.parentId) walk(node.parentId, [...path, id]);
    color.set(id, 2);
  };
  for (const f of folders) walk(f.id, []);
}
```

- [ ] **Step 4b.4: Wire preflight into `main()` before any writes**

Find the line in `main()` that currently calls `classifyFolders(folders)`. Insert immediately above it:

```typescript
  validateFolderGraph(folders);
  log.info("Folder graph preflight passed", { folders: folders.length });
```

- [ ] **Step 4b.5: Run tests**

Run: `bun run test:run tests/migrations/folders-preflight.test.ts`
Expected: PASS (4/4).

- [ ] **Step 4b.6: Commit**

```bash
git add scripts/migrate-folders-to-projects.ts tests/migrations/folders-preflight.test.ts
git commit -m "feat(migration): reject cycles/orphans/cross-user folders before migration"
```

---

## Task 5: Classifier — folders into groups/projects

**Classifier truth table (P2):**

| Folder has children? | Folder has direct sessions/tasks/channels/etc? | Classification | Notes |
|---|---|---|---|
| Yes | No | Group | Pure container |
| Yes | Yes | Group + Default project | Task 6 creates a "Default" project under it to own the direct contents |
| No | — (any) | Project | Leaf owns its own content |
| Orphan (cycle/missing parent) | — | REJECTED at Step 4b | Preflight fails before classification runs |
| Cross-user parent | — | REJECTED at Step 4b | Preflight fails |

"Empty leaf" (no children, no direct content) is still classified as a project — the operator can archive it post-migration. This is intentional: we preserve the user's folder identity even if currently empty.

**Files:**
- Modify: `scripts/migrate-folders-to-projects.ts`
- Create: `tests/migrations/folders-to-projects.test.ts`

- [ ] **Step 5.1: Write the failing classifier test**

`tests/migrations/folders-to-projects.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { classifyFolders } from "@/../scripts/migrate-folders-to-projects";

interface Folder {
  id: string;
  userId: string;
  parentId: string | null;
  name: string;
}

describe("classifyFolders", () => {
  it("classifies a leaf folder as project", () => {
    const folders: Folder[] = [
      { id: "f1", userId: "u1", parentId: null, name: "App" },
    ];
    const { groupIds, projectIds } = classifyFolders(folders);
    expect(projectIds).toContain("f1");
    expect(groupIds).not.toContain("f1");
  });

  it("classifies a parent folder with children as group", () => {
    const folders: Folder[] = [
      { id: "f1", userId: "u1", parentId: null, name: "Parent" },
      { id: "f2", userId: "u1", parentId: "f1", name: "Child" },
    ];
    const { groupIds, projectIds } = classifyFolders(folders);
    expect(groupIds).toContain("f1");
    expect(projectIds).toContain("f2");
  });

  it("handles multi-level nesting", () => {
    const folders: Folder[] = [
      { id: "g1", userId: "u1", parentId: null, name: "Root" },
      { id: "g2", userId: "u1", parentId: "g1", name: "Mid" },
      { id: "p1", userId: "u1", parentId: "g2", name: "Leaf" },
    ];
    const { groupIds, projectIds } = classifyFolders(folders);
    expect(groupIds).toEqual(expect.arrayContaining(["g1", "g2"]));
    expect(projectIds).toEqual(["p1"]);
  });
});
```

- [ ] **Step 5.2: Run test to verify it fails**

Run: `bun run test:run tests/migrations/folders-to-projects.test.ts`
Expected: FAIL with "classifyFolders is not exported".

- [ ] **Step 5.3: Implement `classifyFolders`**

Add to `scripts/migrate-folders-to-projects.ts` above `main()`:

```typescript
export interface FolderRow {
  id: string;
  userId: string;
  parentId: string | null;
  name: string;
}

export function classifyFolders(folders: FolderRow[]): {
  groupIds: Set<string>;
  projectIds: Set<string>;
} {
  const childrenByParent = new Map<string, string[]>();
  for (const f of folders) {
    if (!f.parentId) continue;
    const bucket = childrenByParent.get(f.parentId) ?? [];
    bucket.push(f.id);
    childrenByParent.set(f.parentId, bucket);
  }
  const groupIds = new Set<string>();
  const projectIds = new Set<string>();
  for (const f of folders) {
    if ((childrenByParent.get(f.id) ?? []).length > 0) {
      groupIds.add(f.id);
    } else {
      projectIds.add(f.id);
    }
  }
  return { groupIds, projectIds };
}
```

- [ ] **Step 5.4: Run tests**

Run: `bun run test:run tests/migrations/folders-to-projects.test.ts`
Expected: PASS (3/3).

- [ ] **Step 5.5: Commit**

```bash
git add scripts/migrate-folders-to-projects.ts tests/migrations/folders-to-projects.test.ts
git commit -m "feat(migration): add folder classifier (leaf→project, branch→group)"
```

---

## Task 6: Detect Group-With-Contents and Plan Default Projects

A folder classified as a group may still have **direct** sessions, tasks, channels, etc. We must promote those contents into an auto-created "Default" project under that group.

- [ ] **Step 6.1: Write failing test**

Append to `tests/migrations/folders-to-projects.test.ts`:

```typescript
import { planDefaultProjects } from "@/../scripts/migrate-folders-to-projects";

describe("planDefaultProjects", () => {
  it("plans Default project when group has direct sessions", () => {
    const groupIds = new Set(["g1"]);
    const directCounts = new Map([["g1", 3]]);
    const plan = planDefaultProjects(groupIds, directCounts);
    expect(plan.has("g1")).toBe(true);
  });

  it("skips groups with no direct contents", () => {
    const groupIds = new Set(["g1"]);
    const directCounts = new Map<string, number>();
    const plan = planDefaultProjects(groupIds, directCounts);
    expect(plan.size).toBe(0);
  });
});
```

- [ ] **Step 6.2: Run — expect fail**

Run: `bun run test:run tests/migrations/folders-to-projects.test.ts`
Expected: FAIL with "planDefaultProjects is not exported".

- [ ] **Step 6.3: Implement**

In the migration script:

```typescript
export function planDefaultProjects(
  groupIds: Set<string>,
  directCounts: Map<string, number>
): Map<string, { defaultProjectId: string }> {
  const plan = new Map<string, { defaultProjectId: string }>();
  for (const gid of groupIds) {
    const count = directCounts.get(gid) ?? 0;
    if (count > 0) {
      plan.set(gid, { defaultProjectId: crypto.randomUUID() });
    }
  }
  return plan;
}
```

- [ ] **Step 6.4: Run, verify pass, commit**

```bash
bun run test:run tests/migrations/folders-to-projects.test.ts
git add scripts/migrate-folders-to-projects.ts tests/migrations/folders-to-projects.test.ts
git commit -m "feat(migration): plan auto-Default projects for groups with direct contents"
```

---

## Task 7: Workspace Wrap — put root leaves under one group per user

- [ ] **Step 7.1: Write failing test**

Append to the test file:

```typescript
import { planWorkspaceGroup } from "@/../scripts/migrate-folders-to-projects";

describe("planWorkspaceGroup", () => {
  it("creates one Workspace per user when root leaves exist", () => {
    const rootLeaves: FolderRow[] = [
      { id: "p1", userId: "u1", parentId: null, name: "App" },
      { id: "p2", userId: "u1", parentId: null, name: "Scripts" },
      { id: "p3", userId: "u2", parentId: null, name: "Other" },
    ];
    const plan = planWorkspaceGroup(rootLeaves);
    expect(plan.size).toBe(2);
    expect(plan.get("u1")).toBeDefined();
    expect(plan.get("u2")).toBeDefined();
  });

  it("returns empty when no root leaves exist", () => {
    const plan = planWorkspaceGroup([]);
    expect(plan.size).toBe(0);
  });
});
```

- [ ] **Step 7.2: Run — expect fail, then implement**

In the migration script:

```typescript
export function planWorkspaceGroup(
  rootLeaves: FolderRow[]
): Map<string, { groupId: string; childLeafIds: string[] }> {
  const plan = new Map<string, { groupId: string; childLeafIds: string[] }>();
  for (const leaf of rootLeaves) {
    if (leaf.parentId !== null) continue;
    let entry = plan.get(leaf.userId);
    if (!entry) {
      entry = { groupId: crypto.randomUUID(), childLeafIds: [] };
      plan.set(leaf.userId, entry);
    }
    entry.childLeafIds.push(leaf.id);
  }
  return plan;
}
```

- [ ] **Step 7.3: Run, verify pass, commit**

```bash
bun run test:run tests/migrations/folders-to-projects.test.ts
git add scripts/migrate-folders-to-projects.ts tests/migrations/folders-to-projects.test.ts
git commit -m "feat(migration): plan per-user Workspace group for root leaves"
```

---

## Task 8: Wire the Classifier/Planner Into main()

- [ ] **Step 8.1: Extend main() to read folders, classify, build plan**

Replace the placeholder `main()` body with:

```typescript
async function main() {
  log.info("Starting folders→projects migration", { dryRun: DRY_RUN });
  if (!DRY_RUN) {
    await backupDatabase();
  }

  const marker = await getMigrationState(k("complete"));
  if (marker === "done") {
    log.info("Migration already completed on this DB; exiting.");
    return;
  }

  const allFolders = await db
    .select({
      id: sessionFolders.id,
      userId: sessionFolders.userId,
      parentId: sessionFolders.parentId,
      name: sessionFolders.name,
    })
    .from(sessionFolders);
  log.info("Loaded folders", { count: allFolders.length });

  const { groupIds, projectIds } = classifyFolders(allFolders);
  log.info("Classified", { groups: groupIds.size, projects: projectIds.size });

  // Count direct contents per folder (sessions + tasks + channels + peer msgs + channel_groups)
  const directCounts = new Map<string, number>();
  const tablesWithFolder: Array<{ table: any; folderCol: any }> = [
    { table: terminalSessions, folderCol: terminalSessions.folderId },
    { table: projectTasks, folderCol: projectTasks.folderId },
    { table: channelGroups, folderCol: channelGroups.folderId },
    { table: channels, folderCol: channels.folderId },
    { table: agentPeerMessages, folderCol: agentPeerMessages.folderId },
  ];
  for (const { table, folderCol } of tablesWithFolder) {
    const rows = await db
      .select({ folderId: folderCol, count: sql<number>`count(*)` })
      .from(table)
      .groupBy(folderCol);
    for (const row of rows) {
      if (!row.folderId) continue;
      directCounts.set(row.folderId, (directCounts.get(row.folderId) ?? 0) + Number(row.count));
    }
  }

  const defaultProjectPlan = planDefaultProjects(groupIds, directCounts);
  log.info("Default projects to create", { count: defaultProjectPlan.size });

  const rootLeaves = allFolders.filter(
    (f) => f.parentId === null && !groupIds.has(f.id)
  );
  const workspacePlan = planWorkspaceGroup(rootLeaves);
  log.info("Workspace groups to create", { count: workspacePlan.size });

  if (DRY_RUN) {
    log.info("Dry run complete — no writes performed.");
    return;
  }

  // Writes happen in Task 9+
  log.warn("Writes not yet implemented; marking in-progress.");
  await setMigrationState(k("analyzed"), "done");
}
```

- [ ] **Step 8.2: Typecheck + run dry-run**

Run: `bun run typecheck`
Run: `bun run db:migrate-folders --dry-run`
Expected: logs show folder count, classification, no writes.

- [ ] **Step 8.3: Commit**

```bash
git add scripts/migrate-folders-to-projects.ts
git commit -m "feat(migration): analyze-phase implementation with dry-run support"
```

---

## Task 9: Insert Phase — Write groups and projects

- [ ] **Step 9.1: Add insertion helpers to the migration script**

Append below existing logic in `main()` (replace the `log.warn("Writes not yet implemented...")` block):

```typescript
  // 1. Insert Workspace groups (one per user with root leaves)
  const workspaceGroupIds = new Map<string, string>(); // userId -> groupId
  for (const [userId, { groupId }] of workspacePlan) {
    await db.insert(projectGroups).values({
      id: groupId,
      userId,
      parentGroupId: null,
      name: "Workspace",
      collapsed: false,
      sortOrder: -1, // sorts above all migrated groups
      legacyFolderId: null,
    });
    workspaceGroupIds.set(userId, groupId);
  }
  log.info("Inserted Workspace groups", { count: workspaceGroupIds.size });

  // 2. Insert groups in topo order (parents before children)
  const foldersById = new Map(allFolders.map((f) => [f.id, f]));
  const insertedGroups = new Set<string>();
  const groupIdMap = new Map<string, string>(); // legacyFolderId -> new projectGroupId

  function insertGroup(folderId: string): string {
    if (insertedGroups.has(folderId)) return groupIdMap.get(folderId)!;
    const folder = foldersById.get(folderId)!;
    let parentGroupId: string | null = null;
    if (folder.parentId) {
      // Parent must be a group (we only nest groups within groups)
      if (!groupIds.has(folder.parentId)) {
        throw new Error(`Folder ${folderId} has non-group parent ${folder.parentId}`);
      }
      parentGroupId = insertGroup(folder.parentId);
    }
    const newId = crypto.randomUUID();
    // synchronous-ish: we need to await inside, so return a Promise — restructure below
    throw new Error("Use async version below");
  }
```

The synchronous sketch above shows the shape but we need await. Replace with:

```typescript
  const insertedGroups = new Set<string>();
  const groupIdMap = new Map<string, string>();

  async function insertGroupAsync(folderId: string): Promise<string> {
    if (insertedGroups.has(folderId)) return groupIdMap.get(folderId)!;
    const folder = foldersById.get(folderId)!;
    let parentGroupId: string | null = null;
    if (folder.parentId) {
      if (!groupIds.has(folder.parentId)) {
        throw new Error(
          `Consistency error: group ${folderId} has non-group parent ${folder.parentId}`
        );
      }
      parentGroupId = await insertGroupAsync(folder.parentId);
    }
    const newId = crypto.randomUUID();
    await db.insert(projectGroups).values({
      id: newId,
      userId: folder.userId,
      parentGroupId,
      name: folder.name,
      collapsed: false,
      sortOrder: 0,
      legacyFolderId: folderId,
    });
    insertedGroups.add(folderId);
    groupIdMap.set(folderId, newId);
    return newId;
  }

  for (const gid of groupIds) {
    await insertGroupAsync(gid);
  }
  log.info("Inserted migrated groups", { count: groupIdMap.size });

  // 3. Insert projects (leaves)
  const projectIdMap = new Map<string, string>(); // legacyFolderId -> new projectId
  for (const pid of projectIds) {
    const folder = foldersById.get(pid)!;
    let groupId: string | null = null;
    if (folder.parentId) {
      groupId = groupIdMap.get(folder.parentId) ?? null;
    } else {
      // root leaf — goes into Workspace group for its user
      groupId = workspaceGroupIds.get(folder.userId) ?? null;
    }
    if (!groupId) {
      throw new Error(`No parent group resolved for project-candidate folder ${pid}`);
    }
    const newId = crypto.randomUUID();
    await db.insert(projects).values({
      id: newId,
      userId: folder.userId,
      groupId,
      name: folder.name,
      collapsed: false,
      sortOrder: 0,
      isAutoCreated: false,
      legacyFolderId: pid,
    });
    projectIdMap.set(pid, newId);
  }
  log.info("Inserted migrated projects", { count: projectIdMap.size });

  // 4. Insert Default projects for groups with direct contents
  const defaultProjectIdsByGroup = new Map<string, string>();
  for (const [legacyGroupFolderId, { defaultProjectId }] of defaultProjectPlan) {
    const newGroupId = groupIdMap.get(legacyGroupFolderId);
    if (!newGroupId) continue;
    const folder = foldersById.get(legacyGroupFolderId)!;
    await db.insert(projects).values({
      id: defaultProjectId,
      userId: folder.userId,
      groupId: newGroupId,
      name: "Default",
      collapsed: false,
      sortOrder: 0,
      isAutoCreated: true,
      legacyFolderId: null,
    });
    defaultProjectIdsByGroup.set(legacyGroupFolderId, defaultProjectId);
  }
  log.info("Inserted Default projects", { count: defaultProjectIdsByGroup.size });

  await setMigrationState(k("tree-inserted"), "done");
```

- [ ] **Step 9.2: Typecheck, dry-run-against-writable-dev-db**

Run: `bun run typecheck`

- [ ] **Step 9.3: Commit**

```bash
git add scripts/migrate-folders-to-projects.ts
git commit -m "feat(migration): insert groups/projects with topo ordering"
```

---

## Task 10: Backfill `project_id` Columns on Dependent Tables

- [ ] **Step 10.1: Add a helper to resolve legacy folder → target project**

Append inside `main()` after Task 9 writes:

```typescript
  function resolveProjectId(
    legacyFolderId: string | null | undefined
  ): string | null {
    if (!legacyFolderId) return null;
    // Direct project match?
    const direct = projectIdMap.get(legacyFolderId);
    if (direct) return direct;
    // Group with Default project?
    const dflt = defaultProjectIdsByGroup.get(legacyFolderId);
    if (dflt) return dflt;
    return null;
  }
```

- [ ] **Step 10.2: Backfill each dependent table**

Still inside `main()`:

```typescript
  async function backfillProjectId(
    tableName: string,
    updater: (legacyId: string, projectId: string | null) => Promise<void>,
    loader: () => Promise<Array<{ id: string; folderId: string | null }>>
  ) {
    const rows = await loader();
    let updated = 0;
    for (const row of rows) {
      const pid = resolveProjectId(row.folderId);
      if (!pid) continue;
      await updater(row.id, pid);
      updated++;
    }
    log.info(`Backfilled ${tableName}`, { rows: rows.length, updated });
  }

  await backfillProjectId(
    "terminal_session",
    async (id, pid) => {
      await db.update(terminalSessions).set({ projectId: pid }).where(eq(terminalSessions.id, id));
    },
    async () => {
      const rows = await db
        .select({ id: terminalSessions.id, folderId: terminalSessions.folderId })
        .from(terminalSessions);
      return rows as Array<{ id: string; folderId: string | null }>;
    }
  );

  await backfillProjectId(
    "project_task",
    async (id, pid) => {
      await db.update(projectTasks).set({ projectId: pid }).where(eq(projectTasks.id, id));
    },
    async () => {
      const rows = await db
        .select({ id: projectTasks.id, folderId: projectTasks.folderId })
        .from(projectTasks);
      return rows as Array<{ id: string; folderId: string | null }>;
    }
  );

  await backfillProjectId(
    "channel_groups",
    async (id, pid) => {
      await db.update(channelGroups).set({ projectId: pid }).where(eq(channelGroups.id, id));
    },
    async () => {
      const rows = await db
        .select({ id: channelGroups.id, folderId: channelGroups.folderId })
        .from(channelGroups);
      return rows as Array<{ id: string; folderId: string | null }>;
    }
  );

  await backfillProjectId(
    "channels",
    async (id, pid) => {
      await db.update(channels).set({ projectId: pid }).where(eq(channels.id, id));
    },
    async () => {
      const rows = await db
        .select({ id: channels.id, folderId: channels.folderId })
        .from(channels);
      return rows as Array<{ id: string; folderId: string | null }>;
    }
  );

  await backfillProjectId(
    "agent_peer_message",
    async (id, pid) => {
      await db.update(agentPeerMessages).set({ projectId: pid }).where(eq(agentPeerMessages.id, id));
    },
    async () => {
      const rows = await db
        .select({ id: agentPeerMessages.id, folderId: agentPeerMessages.folderId })
        .from(agentPeerMessages);
      return rows as Array<{ id: string; folderId: string | null }>;
    }
  );

  await backfillProjectId(
    "agent_config",
    async (id, pid) => {
      await db.update(agentConfigs).set({ projectId: pid }).where(eq(agentConfigs.id, id));
    },
    async () => {
      const rows = await db
        .select({ id: agentConfigs.id, folderId: agentConfigs.folderId })
        .from(agentConfigs);
      return rows as Array<{ id: string; folderId: string | null }>;
    }
  );

  await backfillProjectId(
    "mcp_server",
    async (id, pid) => {
      await db.update(mcpServers).set({ projectId: pid }).where(eq(mcpServers.id, id));
    },
    async () => {
      const rows = await db
        .select({ id: mcpServers.id, folderId: mcpServers.folderId })
        .from(mcpServers);
      return rows as Array<{ id: string; folderId: string | null }>;
    }
  );

  await backfillProjectId(
    "session_memory",
    async (id, pid) => {
      await db.update(sessionMemory).set({ projectId: pid }).where(eq(sessionMemory.id, id));
    },
    async () => {
      const rows = await db
        .select({ id: sessionMemory.id, folderId: sessionMemory.folderId })
        .from(sessionMemory);
      return rows as Array<{ id: string; folderId: string | null }>;
    }
  );

  await backfillProjectId(
    "github_stats_preference",
    async (id, pid) => {
      await db.update(githubStatsPreferences).set({ projectId: pid }).where(eq(githubStatsPreferences.id, id));
    },
    async () => {
      const rows = await db
        .select({ id: githubStatsPreferences.id, folderId: githubStatsPreferences.folderId })
        .from(githubStatsPreferences);
      return rows as Array<{ id: string; folderId: string | null }>;
    }
  );

  await backfillProjectId(
    "port_registry",
    async (id, pid) => {
      await db.update(portRegistry).set({ projectId: pid }).where(eq(portRegistry.id, id));
    },
    async () => {
      const rows = await db
        .select({ id: portRegistry.id, folderId: portRegistry.folderId })
        .from(portRegistry);
      return rows as Array<{ id: string; folderId: string | null }>;
    }
  );

  await backfillProjectId(
    "session_template",
    async (id, pid) => {
      await db.update(sessionTemplates).set({ projectId: pid }).where(eq(sessionTemplates.id, id));
    },
    async () => {
      const rows = await db
        .select({ id: sessionTemplates.id, folderId: sessionTemplates.folderId })
        .from(sessionTemplates);
      return rows as Array<{ id: string; folderId: string | null }>;
    }
  );

  // worktree_trash_metadata uses originalFolderId/name (plain text)
  const trashRows = await db
    .select({
      id: worktreeTrashMetadata.id,
      originalFolderId: worktreeTrashMetadata.originalFolderId,
    })
    .from(worktreeTrashMetadata);
  for (const row of trashRows) {
    const pid = resolveProjectId(row.originalFolderId);
    if (!pid) continue;
    const folderName = foldersById.get(row.originalFolderId ?? "")?.name ?? null;
    await db
      .update(worktreeTrashMetadata)
      .set({ originalProjectId: pid, originalProjectName: folderName })
      .where(eq(worktreeTrashMetadata.id, row.id));
  }
  log.info("Backfilled worktree_trash_metadata", { rows: trashRows.length });

  await setMigrationState(k("backfilled-fks"), "done");
```

- [ ] **Step 10.3: Typecheck**

Run: `bun run typecheck`

- [ ] **Step 10.4: Commit**

```bash
git add scripts/migrate-folders-to-projects.ts
git commit -m "feat(migration): backfill project_id bridge columns on dependent tables"
```

---

## Task 11: Migrate `folder_preferences` → `node_preferences`

- [ ] **Step 11.1: Append preferences migration to main()**

```typescript
  // Inheritable fields (valid for both group and project owners).
  // Project-only fields (githubRepoId, localRepoPath, pinnedFiles) must be
  // nulled out on group-owned rows — Phase 2 `NodePreferences.forGroup` forbids
  // them, and keeping real values here breaks the factory invariant.
  const INHERITABLE_KEYS = [
    "defaultWorkingDirectory",
    "defaultShell",
    "startupCommand",
    "theme",
    "fontSize",
    "fontFamily",
    "defaultAgentProvider",
    "environmentVars",
    "gitIdentityName",
    "gitIdentityEmail",
    "isSensitive",
  ] as const;
  const PROJECT_ONLY_KEYS = ["githubRepoId", "localRepoPath", "pinnedFiles"] as const;

  const allPrefs = await db.select().from(folderPreferences);
  for (const pref of allPrefs) {
    // Determine owner: group if folder is group; project (including Default) if folder is project-mapped
    const groupTarget = groupIdMap.get(pref.folderId);
    const projectTarget =
      projectIdMap.get(pref.folderId) ??
      defaultProjectIdsByGroup.get(pref.folderId) ??
      null;
    const ownerId = projectTarget ?? groupTarget;
    if (!ownerId) {
      log.warn("Orphan folder preferences row", { folderId: pref.folderId });
      continue;
    }
    const ownerType: "group" | "project" = projectTarget ? "project" : "group";

    // Warn when we'd drop project-only fields on a group (data loss that the
    // operator should see during dry-run).
    if (ownerType === "group") {
      for (const k of PROJECT_ONLY_KEYS) {
        if (pref[k] != null) {
          log.warn("Dropping project-only field on group owner", {
            folderId: pref.folderId,
            field: k,
          });
        }
      }
    }

    await db.insert(nodePreferences).values({
      id: crypto.randomUUID(),
      ownerId,
      ownerType,
      userId: pref.userId,
      defaultWorkingDirectory: pref.defaultWorkingDirectory,
      defaultShell: pref.defaultShell,
      startupCommand: pref.startupCommand,
      theme: pref.theme,
      fontSize: pref.fontSize,
      fontFamily: pref.fontFamily,
      // Project-only fields: null on group owners, real value on project owners.
      githubRepoId: ownerType === "project" ? pref.githubRepoId : null,
      localRepoPath: ownerType === "project" ? pref.localRepoPath : null,
      pinnedFiles: ownerType === "project" ? pref.pinnedFiles : null,
      defaultAgentProvider: pref.defaultAgentProvider,
      environmentVars: pref.environmentVars,
      gitIdentityName: pref.gitIdentityName,
      gitIdentityEmail: pref.gitIdentityEmail,
      isSensitive: pref.isSensitive ?? false,
    });
  }
  log.info("Migrated folder preferences → node_preferences", { rows: allPrefs.length });

  await setMigrationState(k("prefs-migrated"), "done");
```

- [ ] **Step 11.2: Commit**

```bash
git add scripts/migrate-folders-to-projects.ts
git commit -m "feat(migration): copy folder_preferences into polymorphic node_preferences"
```

---

## Task 12: Migrate Link Tables (secrets, github, profile, repositories)

- [ ] **Step 12.1: Append link-table migrations**

```typescript
  // folder_secrets_config -> project_secrets_config (only for project-mapped folders)
  const secrets = await db.select().from(folderSecretsConfig);
  for (const s of secrets) {
    const pid = resolveProjectId(s.folderId);
    if (!pid) {
      log.warn("Dropping orphan secrets config", { folderId: s.folderId });
      continue;
    }
    await db.insert(projectSecretsConfig).values({
      id: s.id,
      userId: s.userId,
      projectId: pid,
      provider: s.provider,
      providerConfig: s.providerConfig,
      enabled: s.enabled,
      lastFetchedAt: s.lastFetchedAt,
    });
  }
  log.info("Migrated secrets configs", { rows: secrets.length });

  // folder_github_account_link has no userId column — it's only (folderId, providerAccountId).
  const ghLinks = await db.select().from(folderGitHubAccountLinks);
  for (const gh of ghLinks) {
    const pid = resolveProjectId(gh.folderId);
    if (!pid) continue;
    await db.insert(projectGitHubAccountLinks).values({
      projectId: pid,
      providerAccountId: gh.providerAccountId,
    });
  }
  log.info("Migrated github account links", { rows: ghLinks.length });

  // folder_profile_link has no userId column — it's only (folderId, profileId).
  const profileLinks = await db.select().from(folderProfileLinks);
  for (const pl of profileLinks) {
    const pid = resolveProjectId(pl.folderId);
    if (!pid) continue;
    await db.insert(projectProfileLinks).values({
      projectId: pid,
      profileId: pl.profileId,
    });
  }
  log.info("Migrated profile links", { rows: profileLinks.length });

  // NOTE: No folderRepositories table exists. Repo fields are already carried on
  // `folder_preferences` → `node_preferences` in Task 11. No additional migration
  // needed here.

  await setMigrationState(k("links-migrated"), "done");
```

- [ ] **Step 12.2: Commit**

```bash
git add scripts/migrate-folders-to-projects.ts
git commit -m "feat(migration): migrate secrets/github/profile/repository link tables"
```

---

## Task 13: Migrate `user_settings.activeFolderId` → `activeNodeId`+`activeNodeType`

- [ ] **Step 13.1: Append user settings migration**

```typescript
  const allSettings = await db.select().from(userSettings);
  for (const s of allSettings) {
    const patch: Partial<typeof userSettings.$inferSelect> = {};
    if (s.activeFolderId) {
      const pid = projectIdMap.get(s.activeFolderId) ?? defaultProjectIdsByGroup.get(s.activeFolderId);
      const gid = groupIdMap.get(s.activeFolderId);
      if (pid) {
        patch.activeNodeId = pid;
        patch.activeNodeType = "project";
      } else if (gid) {
        patch.activeNodeId = gid;
        patch.activeNodeType = "group";
      }
    }
    if (s.pinnedFolderId) {
      const pid = projectIdMap.get(s.pinnedFolderId) ?? defaultProjectIdsByGroup.get(s.pinnedFolderId);
      const gid = groupIdMap.get(s.pinnedFolderId);
      if (pid) {
        patch.pinnedNodeId = pid;
        patch.pinnedNodeType = "project";
      } else if (gid) {
        patch.pinnedNodeId = gid;
        patch.pinnedNodeType = "group";
      }
    }
    if (Object.keys(patch).length > 0) {
      await db.update(userSettings).set(patch).where(eq(userSettings.userId, s.userId));
    }
  }
  log.info("Migrated user_settings active/pinned node", { rows: allSettings.length });

  await setMigrationState(k("user-settings-migrated"), "done");
  await setMigrationState(k("complete"), "done");
  log.info("Migration complete ✓");
```

- [ ] **Step 13.2: Typecheck**

Run: `bun run typecheck`

- [ ] **Step 13.3: Commit**

```bash
git add scripts/migrate-folders-to-projects.ts
git commit -m "feat(migration): translate user_settings active/pinned folder to node discriminator"
```

---

## Task 14: Integration Smoke Test

- [ ] **Step 14.1: Dry-run against a copy of the dev DB**

```bash
cp sqlite.db sqlite.db.predryrun
bun run db:migrate-folders --dry-run
```

Expected: classification counts logged; no rows written.

- [ ] **Step 14.2: Real run**

```bash
bun run db:migrate-folders
```

Expected:
- Backup file `sqlite.db.bak-<timestamp>` created.
- All phases log completion.
- `_migration_state` row `folders-to-projects:complete = done` present.

- [ ] **Step 14.3: Sanity checks**

```bash
# Row counts preserved
bun run -e 'import { db } from "@/db"; import { terminalSessions, projectTasks, channels } from "@/db/schema"; (async () => { console.log("sessions", (await db.select().from(terminalSessions)).length); console.log("tasks", (await db.select().from(projectTasks)).length); console.log("channels", (await db.select().from(channels)).length); })()'
```

Expected: counts match pre-migration.

- [ ] **Step 14.4: App still boots**

```bash
bun run dev
# In another shell:
curl -sS http://localhost:6001/login
```

Expected: HTML response. Kill the dev server.

- [ ] **Step 14.5: Re-run migration is a no-op**

```bash
bun run db:migrate-folders
```

Expected: "Migration already completed on this DB; exiting."

- [ ] **Step 14.5a: Crash-recovery — kill mid-migration, resume, verify idempotence**

This guards against partial writes surviving a crash. The `_migration_state` table MUST let a restarted run skip already-completed phases.

```bash
# 1. Start from a fresh copy of the pre-migration DB.
cp sqlite.db.bak-<timestamp> sqlite.db

# 2. Launch the migration in the background.
bun run db:migrate-folders &
MIGPID=$!

# 3. After ~500ms (long enough to get past preflight + some writes),
#    kill it. Adjust the sleep on slow machines.
sleep 0.5 && kill -TERM $MIGPID

# 4. Restart. It should pick up from wherever _migration_state left off.
bun run db:migrate-folders

# 5. Sanity: row counts match a clean run from scratch.
```

Expected: the second run logs "Resuming from phase: <X>" and completes without duplicate-key errors. Compare row counts from Step 14.3 — they must match exactly.

- [ ] **Step 14.5b: Preflight rejects real bad data**

```bash
# 1. Copy the pre-migration DB.
cp sqlite.db.bak-<timestamp> sqlite.db.badgraph
# 2. Corrupt one folder's parent to point at a missing UUID.
sqlite3 sqlite.db.badgraph "UPDATE session_folder SET parent_id = 'DEFINITELY-NOT-REAL' WHERE id = (SELECT id FROM session_folder LIMIT 1)"
# 3. Point the migration at the corrupted DB (via SQLITE_PATH env or similar).
SQLITE_PATH=./sqlite.db.badgraph bun run db:migrate-folders
```

Expected: migration exits non-zero with "Orphan parent reference" before any writes. `sqlite.db.badgraph` must contain zero rows in `project_group`/`project` afterward.

- [ ] **Step 14.6: Commit the CHANGELOG update**

Edit `CHANGELOG.md` — under `## [Unreleased]` add:

```markdown
### Added
- New tables `project_group`, `project`, `node_preferences` laying the groundwork for strict project/folder coupling.
- Migration script `bun run db:migrate-folders` copies legacy folder/preference data into the new tables without destroying the old rows.

### Changed
- `user_settings` now carries `active_node_id`/`active_node_type` and `pinned_node_id`/`pinned_node_type` alongside the legacy `active_folder_id`/`pinned_folder_id` (dropped in Phase 6).
```

```bash
git add CHANGELOG.md
git commit -m "docs(changelog): note Phase 1 schema + migration additions"
```

---

## Phase 1 Exit Criteria

- [ ] `bun run typecheck` passes
- [ ] `bun run test:run` passes (classifier, planner tests green)
- [ ] `bun run db:migrate-folders` completes on the user's local DB
- [ ] Re-run is a no-op (idempotent)
- [ ] App boots, login page renders
- [ ] `project_group` and `project` rows mirror old `session_folder` rows (spot-check 3 random folders)
- [ ] `node_preferences` row count == pre-migration `folder_preferences` row count
- [ ] CHANGELOG updated

**On success:** `bd update remote-dev-1efl.1 --status closed` and unblock Phase 2.
