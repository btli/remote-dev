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
  projectRepositories,
  folderRepositories,
} from "@/db/schema";
import { and, eq, isNull, sql } from "drizzle-orm";
import {
  getMigrationState,
  setMigrationState,
} from "@/db/migrations/migration-state";
import { createLogger } from "@/lib/logger";
import { getDatabasePath } from "@/lib/paths";

const log = createLogger("MigrateFoldersToProjects");
const MIGRATION_KEY_PREFIX = "folders-to-projects";
const DRY_RUN = process.argv.includes("--dry-run");

function k(step: string) {
  return `${MIGRATION_KEY_PREFIX}:${step}`;
}

async function backupDatabase() {
  let dbPath: string;
  try {
    dbPath = getDatabasePath();
  } catch {
    dbPath = resolve(process.cwd(), "sqlite.db");
  }
  if (!existsSync(dbPath)) {
    log.warn("No sqlite.db found to back up; assuming first-run dev DB.");
    return;
  }
  const backupPath = `${dbPath}.bak-${Date.now()}`;
  copyFileSync(dbPath, backupPath);
  log.info("Backup created", { backupPath });
}

export interface FolderRow {
  id: string;
  userId: string;
  parentId: string | null;
  name: string;
}

export function classifyFolders(folders: FolderRow[]): {
  groupIds: string[];
  projectIds: string[];
} {
  const childrenByParent = new Map<string, string[]>();
  for (const f of folders) {
    if (!f.parentId) continue;
    const bucket = childrenByParent.get(f.parentId) ?? [];
    bucket.push(f.id);
    childrenByParent.set(f.parentId, bucket);
  }
  const groupIds: string[] = [];
  const projectIds: string[] = [];
  for (const f of folders) {
    if ((childrenByParent.get(f.id) ?? []).length > 0) {
      groupIds.push(f.id);
    } else {
      projectIds.push(f.id);
    }
  }
  return { groupIds, projectIds };
}

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
      throw new Error(
        `Cycle detected in folder parent graph: ${[...path, id].join(" -> ")}`
      );
    }
    if (state === 2) return;
    color.set(id, 1);
    const node = byId.get(id);
    if (node?.parentId) walk(node.parentId, [...path, id]);
    color.set(id, 2);
  };
  for (const f of folders) walk(f.id, []);
}

async function main() {
  log.info("Starting folders→projects migration", { dryRun: DRY_RUN });
  if (!DRY_RUN) {
    await backupDatabase();
  }

  const folders = await db
    .select({
      id: sessionFolders.id,
      userId: sessionFolders.userId,
      parentId: sessionFolders.parentId,
      name: sessionFolders.name,
    })
    .from(sessionFolders);

  validateFolderGraph(folders);
  log.info("Folder graph preflight passed", { folders: folders.length });

  // Subsequent steps added in later tasks.
  log.info("Migration skeleton ready; no-op until subsequent tasks land.");
}

main().catch((err) => {
  log.error("Migration failed", { error: String(err) });
  process.exit(1);
});
