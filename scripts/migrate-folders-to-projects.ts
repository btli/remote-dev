// scripts/migrate-folders-to-projects.ts
import { randomUUID } from "node:crypto";
import { copyFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { db } from "@/db";
import {
  sessionFolders,
  folderPreferences,
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
  projectGroups,
  projects,
  nodePreferences,
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

export function planDefaultProjects(
  groupIds: Set<string>,
  directCounts: Map<string, number>
): Map<string, { defaultProjectId: string }> {
  const plan = new Map<string, { defaultProjectId: string }>();
  for (const gid of groupIds) {
    const count = directCounts.get(gid) ?? 0;
    if (count > 0) {
      plan.set(gid, { defaultProjectId: randomUUID() });
    }
  }
  return plan;
}

export function planWorkspaceGroup(
  rootLeaves: FolderRow[]
): Map<string, { groupId: string; childLeafIds: string[] }> {
  const plan = new Map<string, { groupId: string; childLeafIds: string[] }>();
  for (const leaf of rootLeaves) {
    if (leaf.parentId !== null) continue;
    let entry = plan.get(leaf.userId);
    if (!entry) {
      entry = { groupId: randomUUID(), childLeafIds: [] };
      plan.set(leaf.userId, entry);
    }
    entry.childLeafIds.push(leaf.id);
  }
  return plan;
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

  validateFolderGraph(allFolders);
  log.info("Folder graph preflight passed", { folders: allFolders.length });

  const { groupIds, projectIds } = classifyFolders(allFolders);
  const groupIdSet = new Set(groupIds);
  log.info("Classified", { groups: groupIds.length, projects: projectIds.length });

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
      directCounts.set(
        row.folderId,
        (directCounts.get(row.folderId) ?? 0) + Number(row.count)
      );
    }
  }

  const defaultProjectPlan = planDefaultProjects(groupIdSet, directCounts);
  log.info("Default projects to create", { count: defaultProjectPlan.size });

  const rootLeaves = allFolders.filter(
    (f) => f.parentId === null && !groupIdSet.has(f.id)
  );
  const workspacePlan = planWorkspaceGroup(rootLeaves);
  log.info("Workspace groups to create", { count: workspacePlan.size });

  if (DRY_RUN) {
    log.info("Dry run complete — no writes performed.");
    return;
  }

  // ───────────────────────────────────────────────────────────────────────
  // Task 9: Insert groups and projects
  // ───────────────────────────────────────────────────────────────────────
  const treeInsertedMarker = await getMigrationState(k("tree-inserted"));
  const workspaceGroupIds = new Map<string, string>(); // userId -> groupId
  const groupIdMap = new Map<string, string>(); // legacyFolderId -> new projectGroupId
  const projectIdMap = new Map<string, string>(); // legacyFolderId -> new projectId
  const defaultProjectIdsByGroup = new Map<string, string>();
  const foldersById = new Map(allFolders.map((f) => [f.id, f]));

  if (treeInsertedMarker === "done") {
    log.info("Tree already inserted; rebuilding in-memory id maps from DB.");
    // Rebuild workspaceGroupIds: Workspace groups have no legacyFolderId,
    // parent_group_id IS NULL, and name="Workspace".
    const wsRows = await db
      .select({
        id: projectGroups.id,
        userId: projectGroups.userId,
      })
      .from(projectGroups)
      .where(
        and(
          isNull(projectGroups.parentGroupId),
          isNull(projectGroups.legacyFolderId),
          eq(projectGroups.name, "Workspace")
        )
      );
    for (const row of wsRows) workspaceGroupIds.set(row.userId, row.id);

    // Rebuild groupIdMap from rows with a legacyFolderId
    const migGroupRows = await db
      .select({
        id: projectGroups.id,
        legacyFolderId: projectGroups.legacyFolderId,
      })
      .from(projectGroups);
    for (const row of migGroupRows) {
      if (row.legacyFolderId) groupIdMap.set(row.legacyFolderId, row.id);
    }

    // Rebuild projectIdMap for legacy-folder-backed projects and Default projects
    const migProjectRows = await db
      .select({
        id: projects.id,
        legacyFolderId: projects.legacyFolderId,
        groupId: projects.groupId,
        isAutoCreated: projects.isAutoCreated,
      })
      .from(projects);
    for (const row of migProjectRows) {
      if (row.legacyFolderId) {
        projectIdMap.set(row.legacyFolderId, row.id);
      } else if (row.isAutoCreated) {
        // Default project — reverse-map by its group's legacyFolderId
        const parentLegacyFolderId = [...groupIdMap.entries()].find(
          ([, gid]) => gid === row.groupId
        )?.[0];
        if (parentLegacyFolderId) {
          defaultProjectIdsByGroup.set(parentLegacyFolderId, row.id);
        }
      }
    }
    log.info("Restored id maps", {
      workspaceGroups: workspaceGroupIds.size,
      groups: groupIdMap.size,
      projects: projectIdMap.size,
      defaults: defaultProjectIdsByGroup.size,
    });
  } else {
    // 1. Insert Workspace groups (one per user with root leaves)
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

    // 2. Insert migrated groups in topo order (parents before children)
    const insertedGroups = new Set<string>();

    async function insertGroupAsync(folderId: string): Promise<string> {
      if (insertedGroups.has(folderId)) return groupIdMap.get(folderId)!;
      const folder = foldersById.get(folderId)!;
      let parentGroupId: string | null = null;
      if (folder.parentId) {
        if (!groupIdSet.has(folder.parentId)) {
          throw new Error(
            `Consistency error: group ${folderId} has non-group parent ${folder.parentId}`
          );
        }
        parentGroupId = await insertGroupAsync(folder.parentId);
      }
      const newId = randomUUID();
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
      const newId = randomUUID();
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
  }

  // ───────────────────────────────────────────────────────────────────────
  // Task 10: Backfill project_id columns on dependent tables
  // ───────────────────────────────────────────────────────────────────────
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

  const backfilledMarker = await getMigrationState(k("backfilled-fks"));
  if (backfilledMarker === "done") {
    log.info("Bridge columns already backfilled; skipping Task 10.");
  } else {
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
        await db
          .update(terminalSessions)
          .set({ projectId: pid })
          .where(eq(terminalSessions.id, id));
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
        await db
          .update(projectTasks)
          .set({ projectId: pid })
          .where(eq(projectTasks.id, id));
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
        await db
          .update(channelGroups)
          .set({ projectId: pid })
          .where(eq(channelGroups.id, id));
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
        await db
          .update(agentPeerMessages)
          .set({ projectId: pid })
          .where(eq(agentPeerMessages.id, id));
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
        await db
          .update(agentConfigs)
          .set({ projectId: pid })
          .where(eq(agentConfigs.id, id));
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
        await db
          .update(mcpServers)
          .set({ projectId: pid })
          .where(eq(mcpServers.id, id));
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
        await db
          .update(sessionMemory)
          .set({ projectId: pid })
          .where(eq(sessionMemory.id, id));
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
        await db
          .update(githubStatsPreferences)
          .set({ projectId: pid })
          .where(eq(githubStatsPreferences.id, id));
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
        await db
          .update(portRegistry)
          .set({ projectId: pid })
          .where(eq(portRegistry.id, id));
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
        await db
          .update(sessionTemplates)
          .set({ projectId: pid })
          .where(eq(sessionTemplates.id, id));
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
      const folderName = row.originalFolderId
        ? foldersById.get(row.originalFolderId)?.name ?? null
        : null;
      await db
        .update(worktreeTrashMetadata)
        .set({ originalProjectId: pid, originalProjectName: folderName })
        .where(eq(worktreeTrashMetadata.id, row.id));
    }
    log.info("Backfilled worktree_trash_metadata", { rows: trashRows.length });

    await setMigrationState(k("backfilled-fks"), "done");
  }

  // ───────────────────────────────────────────────────────────────────────
  // Task 11: Migrate folder_preferences → node_preferences
  // ───────────────────────────────────────────────────────────────────────
  // Inheritable fields (valid for both group and project owners).
  // Project-only fields (githubRepoId, localRepoPath, pinnedFiles) must be
  // nulled out on group-owned rows — Phase 2 NodePreferences.forGroup forbids
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
  void INHERITABLE_KEYS; // keeps the policy list traceable in source

  const prefsMarker = await getMigrationState(k("prefs-migrated"));
  if (prefsMarker === "done") {
    log.info("Preferences already migrated; skipping Task 11.");
  } else {
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
      // operator should see during the run log).
      if (ownerType === "group") {
        for (const key of PROJECT_ONLY_KEYS) {
          if (pref[key] != null) {
            log.warn("Dropping project-only field on group owner", {
              folderId: pref.folderId,
              field: key,
            });
          }
        }
      }

      await db.insert(nodePreferences).values({
        id: randomUUID(),
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
    log.info("Migrated folder preferences → node_preferences", {
      rows: allPrefs.length,
    });
    await setMigrationState(k("prefs-migrated"), "done");
  }
}

main().catch((err) => {
  log.error("Migration failed", { error: String(err) });
  process.exit(1);
});
