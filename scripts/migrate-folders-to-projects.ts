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
