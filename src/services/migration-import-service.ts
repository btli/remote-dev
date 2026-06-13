/**
 * MigrationImportService — DESTINATION side of server-to-server project
 * migration (stage 1: DB rows).
 *
 * Lifecycle: `initImport` stages an inbound migration (row + staging dir),
 * `importDb` applies the validated {@link DbBundle} in one transaction with
 * FK-safe ordering and an id-remap table, `verifyImport` recounts imported
 * rows against the counts recorded at import time, and `rollbackImport`
 * removes everything an import created.
 *
 * Remap policy:
 * - project id: kept when free on this instance, else a fresh uuid.
 * - agent profiles: ALWAYS fresh uuids (configDir is keyed by id; the
 *   directory itself is materialized by the stage-2 file transfer).
 * - all other child rows: fresh uuids, with in-bundle references
 *   (group→channel, message threads, task dependency edges) remapped.
 * - working directories: rewritten to `~/projects/<basename>` on this host;
 *   the source→destination path map is recorded for stage-2 extraction.
 */
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { basename } from "node:path";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { and, eq, inArray, ne } from "drizzle-orm";
import { db } from "@/db";
import {
  projects,
  nodePreferences,
  projectTasks,
  taskDependencies,
  channelGroups,
  channels,
  agentPeerMessages,
  mcpServers,
  agentConfigs,
  projectSecretsConfig,
  projectRepositories,
  githubRepositories,
  projectGitHubAccountLinks,
  githubAccountMetadata,
  projectProfileLinks,
  agentProfiles,
  profileGitIdentities,
  profileAppearanceSettings,
  agentProfileJsonConfigs,
  profileSecretsConfig,
  triggerConfigs,
  agentSchedules,
  migrationImports,
} from "@/db/schema";
import { encrypt } from "@/lib/encryption";
import { getMigrationStagingDir, getProfilesDir } from "@/lib/paths";
import { runtimeJoin as join } from "@/lib/dynamic-fs";
import {
  dbBundleSchema,
  type BundleManifest,
  type ConflictReport,
  type DbBundle,
  type ImportResult,
  type MigrationOptions,
  type VerifyResult,
} from "@/lib/migration-bundle";
import type { ChannelType } from "@/types/channels";
import type { TaskPriority, TaskSource, TaskStatus } from "@/types/task";
import type { AgentProvider, AgentConfigType, MCPTransport } from "@/types/agent";
import type { ScheduleType } from "@/types/schedule";
import type { TriggerKind } from "@/types/agent-run";
import type { AppearanceMode, ColorSchemeId } from "@/types/appearance";
import { createLogger } from "@/lib/logger";

const log = createLogger("MigrationImport");

/** Row type for a `migration_import` record. */
export type MigrationImportRow = typeof migrationImports.$inferSelect;

/**
 * Bookkeeping persisted in `optionsJson`. Stage 2 reads `pathMap` to know
 * where to extract the working tree; `verifyImport` reads
 * `expectedRowCounts`; `rollbackImport` reads `profileIdRemaps`.
 */
export interface ImportBookkeeping {
  options: MigrationOptions;
  /** Source absolute path → destination absolute path. */
  pathMap?: Record<string, string>;
  expectedRowCounts?: Record<string, number>;
  /** Source profile id → destination profile id. */
  profileIdRemaps?: Record<string, string>;
}

/** Import ids come from a REMOTE instance and are used as a path component. */
const IMPORT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

function parseBookkeeping(row: MigrationImportRow): ImportBookkeeping {
  try {
    return JSON.parse(row.optionsJson) as ImportBookkeeping;
  } catch {
    return { options: {} as MigrationOptions };
  }
}

/** Fetch one import row (owner-scoped). */
export async function getImport(
  userId: string,
  importId: string,
): Promise<MigrationImportRow | null> {
  const row = await db.query.migrationImports.findFirst({
    where: and(eq(migrationImports.id, importId), eq(migrationImports.userId, userId)),
  });
  return row ?? null;
}

/**
 * Stage an inbound migration: create the import row (id = the SOURCE job id,
 * the cross-instance correlation key) and its staging directory, persisting
 * the manifest for the file phase. Rejects ids that are unsafe as a path
 * component and duplicate non-failed imports.
 */
export async function initImport(
  destUserId: string,
  jobId: string,
  sourceInstanceUrl: string,
  manifest: BundleManifest,
  options: MigrationOptions,
): Promise<MigrationImportRow> {
  if (!IMPORT_ID_PATTERN.test(jobId)) {
    throw new Error("Invalid import id (must be a uuid-like token)");
  }

  const existing = await db.query.migrationImports.findFirst({
    where: eq(migrationImports.id, jobId),
  });
  if (existing) {
    if (existing.userId === destUserId && existing.status === "failed") {
      // A failed prior attempt may be retried: clear it first.
      await rollbackImport(destUserId, jobId);
      await db.delete(migrationImports).where(eq(migrationImports.id, jobId));
    } else {
      throw new Error(`Import ${jobId} already exists (status: ${existing.status})`);
    }
  }

  const stagingDir = join(getMigrationStagingDir(), jobId);
  await mkdir(stagingDir, { recursive: true });
  await writeFile(
    join(stagingDir, "manifest.json"),
    JSON.stringify(manifest, null, 2),
    "utf8",
  );

  const bookkeeping: ImportBookkeeping = { options };
  const [row] = await db
    .insert(migrationImports)
    .values({
      id: jobId,
      userId: destUserId,
      sourceInstanceUrl,
      status: "staged",
      stagingDir,
      totalChunks: manifest.totalChunks,
      manifestJson: JSON.stringify(manifest),
      optionsJson: JSON.stringify(bookkeeping),
    })
    .returning();

  log.info("Import staged", { importId: jobId, userId: destUserId, sourceInstanceUrl });
  return row;
}

/**
 * Rewrite a source working-directory path to this host:
 * `~/projects/<basename>`, suffixing `-2`/`-3`/… when another project's
 * preferences already reference the candidate. `usedInRun` covers paths
 * assigned earlier in the same import.
 */
async function rewriteWorkingDir(
  tx: Pick<typeof db, "select">,
  sourcePath: string,
  newProjectId: string,
  usedInRun: Set<string>,
): Promise<string> {
  const base = basename(sourcePath.replace(/\/+$/, "")) || "project";
  for (let attempt = 1; attempt < 100; attempt++) {
    const candidate = join(
      homedir(),
      "projects",
      attempt === 1 ? base : `${base}-${attempt}`,
    );
    if (usedInRun.has(candidate)) continue;
    const taken = await tx
      .select({ id: nodePreferences.id })
      .from(nodePreferences)
      .where(
        and(
          eq(nodePreferences.defaultWorkingDirectory, candidate),
          ne(nodePreferences.ownerId, newProjectId),
        ),
      )
      .limit(1);
    if (taken.length === 0) {
      usedInRun.add(candidate);
      return candidate;
    }
  }
  // Pathological collision space — fall back to a unique suffix.
  const fallback = join(homedir(), "projects", `${base}-${randomUUID().slice(0, 8)}`);
  usedInRun.add(fallback);
  return fallback;
}

/**
 * Apply a validated DB bundle inside one transaction. Returns the
 * {@link ImportResult}; marks the import row failed and rethrows on error.
 */
export async function importDb(
  destUserId: string,
  importId: string,
  bundle: DbBundle,
): Promise<ImportResult> {
  const importRow = await getImport(destUserId, importId);
  if (!importRow) throw new Error("Import not found");
  if (importRow.status !== "staged" && importRow.status !== "receiving") {
    throw new Error(`Import is not awaiting a DB bundle (status: ${importRow.status})`);
  }

  const parsed = dbBundleSchema.safeParse(bundle);
  if (!parsed.success) {
    const message = `Invalid DB bundle: ${parsed.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ")}`;
    await markFailed(importId, message);
    throw new Error(message);
  }
  const data = parsed.data;

  await db
    .update(migrationImports)
    .set({ status: "importing", updatedAt: new Date() })
    .where(eq(migrationImports.id, importId));

  const conflicts: ConflictReport[] = [];
  const idRemaps: Record<string, string> = {};
  const rowCounts: Record<string, number> = {};
  const pathMap: Record<string, string> = {};
  const profileIdRemaps: Record<string, string> = {};

  try {
    const result = await db.transaction(async (tx) => {
      // ── 1. Project row ─────────────────────────────────────────────────
      const collision = await tx
        .select({ id: projects.id })
        .from(projects)
        .where(eq(projects.id, data.project.id))
        .limit(1);
      const newProjectId = collision.length === 0 ? data.project.id : randomUUID();
      if (newProjectId !== data.project.id) {
        idRemaps[data.project.id] = newProjectId;
        conflicts.push({
          type: "project_id_collision",
          message: `Project id ${data.project.id} already exists on this instance — imported as ${newProjectId}`,
        });
      }
      if (data.project.groupId) {
        conflicts.push({
          type: "group_not_migrated",
          message: "Project was in a group on the source — imported to root",
        });
      }
      await tx.insert(projects).values({
        id: newProjectId,
        userId: destUserId,
        groupId: null,
        name: data.project.name,
        collapsed: data.project.collapsed,
        sortOrder: data.project.sortOrder,
        isAutoCreated: data.project.isAutoCreated,
        createdAt: new Date(data.project.createdAt),
        updatedAt: new Date(),
      });
      rowCounts.project = 1;

      // Resolve the GitHub repo relink target once (used by the repo link,
      // node preferences, and any trigger config pointing at the same repo).
      let destRepoId: string | null = null;
      if (data.repositoryHint) {
        const repo = await tx
          .select({ id: githubRepositories.id })
          .from(githubRepositories)
          .where(
            and(
              eq(githubRepositories.userId, destUserId),
              eq(githubRepositories.githubId, data.repositoryHint.githubId),
            ),
          )
          .limit(1);
        destRepoId = repo[0]?.id ?? null;
      }

      // ── 2. Agent profiles (always fresh uuids) + satellites ────────────
      rowCounts.profiles = 0;
      rowCounts.profileGitIdentities = 0;
      rowCounts.profileAppearanceSettings = 0;
      rowCounts.profileJsonConfigs = 0;
      rowCounts.profileSecrets = 0;
      for (const profile of data.profiles) {
        const newProfileId = randomUUID();
        idRemaps[profile.id] = newProfileId;
        profileIdRemaps[profile.id] = newProfileId;
        await tx.insert(agentProfiles).values({
          id: newProfileId,
          userId: destUserId,
          name: profile.name,
          description: profile.description,
          provider: profile.provider as AgentProvider,
          // The directory itself is materialized by the stage-2 file transfer.
          configDir: join(getProfilesDir(), newProfileId),
          isDefault: false,
        });
        rowCounts.profiles++;
        if (profile.isDefault) {
          conflicts.push({
            type: "profile_default_not_carried",
            message: `Profile "${profile.name}" was the source default — imported as non-default`,
          });
        }
        if (profile.gitIdentity) {
          await tx.insert(profileGitIdentities).values({
            profileId: newProfileId,
            userName: profile.gitIdentity.userName,
            userEmail: profile.gitIdentity.userEmail,
            sshKeyPath: profile.gitIdentity.sshKeyPath,
            gpgKeyId: profile.gitIdentity.gpgKeyId,
            githubUsername: profile.gitIdentity.githubUsername,
          });
          rowCounts.profileGitIdentities++;
        }
        if (profile.appearance) {
          await tx.insert(profileAppearanceSettings).values({
            profileId: newProfileId,
            userId: destUserId,
            appearanceMode: profile.appearance.appearanceMode as AppearanceMode,
            lightColorScheme: profile.appearance.lightColorScheme as ColorSchemeId,
            darkColorScheme: profile.appearance.darkColorScheme as ColorSchemeId,
            terminalOpacity: profile.appearance.terminalOpacity,
            terminalBlur: profile.appearance.terminalBlur,
            terminalCursorStyle: profile.appearance
              .terminalCursorStyle as "block" | "underline" | "bar",
          });
          rowCounts.profileAppearanceSettings++;
        }
        for (const config of profile.jsonConfigs) {
          await tx.insert(agentProfileJsonConfigs).values({
            profileId: newProfileId,
            userId: destUserId,
            agentType: config.agentType as Exclude<AgentProvider, "all">,
            configJson: config.configJson,
            isValid: config.isValid,
            validationErrors: config.validationErrors,
          });
          rowCounts.profileJsonConfigs++;
        }
        if (profile.secrets) {
          // Re-encrypt under THIS instance's AUTH_SECRET.
          await tx.insert(profileSecretsConfig).values({
            profileId: newProfileId,
            userId: destUserId,
            provider: profile.secrets.provider,
            providerConfig: encrypt(JSON.stringify(profile.secrets.providerConfigPlain)),
            enabled: profile.secrets.enabled,
          });
          rowCounts.profileSecrets++;
        }
      }

      // ── 3. Node preferences (upsert; rewrite host-bound paths) ─────────
      rowCounts.nodePreferences = 0;
      const usedDirs = new Set<string>();
      for (const pref of data.nodePreferences) {
        let workingDir: string | null = null;
        if (pref.defaultWorkingDirectory) {
          workingDir = await rewriteWorkingDir(
            tx,
            pref.defaultWorkingDirectory,
            newProjectId,
            usedDirs,
          );
          pathMap[pref.defaultWorkingDirectory] = workingDir;
        }
        let localRepoPath: string | null = null;
        if (pref.localRepoPath) {
          // Reuse the mapping when the repo path matches the working dir;
          // otherwise rewrite it to its own ~/projects/<basename>.
          localRepoPath =
            pathMap[pref.localRepoPath] ??
            join(homedir(), "projects", basename(pref.localRepoPath.replace(/\/+$/, "")));
          pathMap[pref.localRepoPath] = localRepoPath;
        }
        const values = {
          id: randomUUID(),
          ownerId: newProjectId,
          ownerType: "project" as const,
          userId: destUserId,
          defaultWorkingDirectory: workingDir,
          defaultShell: pref.defaultShell,
          startupCommand: pref.startupCommand,
          theme: pref.theme,
          fontSize: pref.fontSize,
          fontFamily: pref.fontFamily,
          githubRepoId: pref.githubRepoId ? destRepoId : null,
          localRepoPath,
          defaultAgentProvider: pref.defaultAgentProvider,
          agentProviderSettings: pref.agentProviderSettings ?? null,
          environmentVars: pref.environmentVars ?? null,
          pinnedFiles: pref.pinnedFiles ?? null,
          gitIdentityName: pref.gitIdentityName,
          gitIdentityEmail: pref.gitIdentityEmail,
          isSensitive: pref.isSensitive,
        };
        const { id: _id, ...updateSet } = values;
        await tx
          .insert(nodePreferences)
          .values(values)
          .onConflictDoUpdate({
            target: [
              nodePreferences.ownerId,
              nodePreferences.ownerType,
              nodePreferences.userId,
            ],
            set: { ...updateSet, updatedAt: new Date() },
          });
        rowCounts.nodePreferences++;
        if (pref.githubRepoId && !destRepoId) {
          conflicts.push({
            type: "github_repo_not_linked",
            message:
              "Preferences referenced a GitHub repository that is not linked on this instance — cleared",
          });
        }
      }

      // ── 4. Profile links, MCP servers, agent configs, project secrets ──
      rowCounts.projectProfileLinks = 0;
      for (const profile of data.profiles) {
        if (rowCounts.projectProfileLinks >= 1) {
          // project_profile_link PK is projectId — only one link can exist.
          conflicts.push({
            type: "profile_link_dropped",
            message: `Profile "${profile.name}" could not be linked (project already has a linked profile)`,
          });
          continue;
        }
        await tx.insert(projectProfileLinks).values({
          projectId: newProjectId,
          profileId: profileIdRemaps[profile.id],
        });
        rowCounts.projectProfileLinks++;
      }

      rowCounts.mcpServers = 0;
      for (const server of data.mcpServers) {
        await tx.insert(mcpServers).values({
          id: randomUUID(),
          userId: destUserId,
          projectId: newProjectId,
          name: server.name,
          transport: server.transport as MCPTransport,
          command: server.command,
          args: server.args,
          env: server.env,
          enabled: server.enabled,
          autoStart: server.autoStart,
        });
        rowCounts.mcpServers++;
      }

      rowCounts.agentConfigs = 0;
      for (const config of data.agentConfigs) {
        await tx.insert(agentConfigs).values({
          id: randomUUID(),
          userId: destUserId,
          projectId: newProjectId,
          provider: config.provider as AgentProvider,
          configType: config.configType as AgentConfigType,
          content: config.content,
        });
        rowCounts.agentConfigs++;
      }

      rowCounts.projectSecrets = 0;
      if (data.projectSecrets) {
        // Re-encrypt under THIS instance's AUTH_SECRET (stored form is the
        // encrypted JSON string, matching secrets-service writes).
        await tx.insert(projectSecretsConfig).values({
          id: randomUUID(),
          userId: destUserId,
          projectId: newProjectId,
          provider: data.projectSecrets.provider,
          providerConfig: encrypt(JSON.stringify(data.projectSecrets.providerConfigPlain)),
          enabled: data.projectSecrets.enabled,
        });
        rowCounts.projectSecrets = 1;
      }

      // ── 5. GitHub repo / account links (hint-based relink) ─────────────
      rowCounts.projectRepositories = 0;
      if (data.repositoryHint) {
        if (destRepoId) {
          await tx.insert(projectRepositories).values({
            projectId: newProjectId,
            repositoryId: destRepoId,
            userId: destUserId,
          });
          rowCounts.projectRepositories = 1;
        } else {
          conflicts.push({
            type: "github_repo_not_linked",
            message: `GitHub repository ${data.repositoryHint.fullName} is not linked on this instance — link it and re-attach manually`,
            detail: `githubId=${data.repositoryHint.githubId}`,
          });
        }
      }

      rowCounts.projectGithubAccountLinks = 0;
      if (data.githubAccountHint) {
        const account = await tx
          .select({ providerAccountId: githubAccountMetadata.providerAccountId })
          .from(githubAccountMetadata)
          .where(
            and(
              eq(githubAccountMetadata.userId, destUserId),
              eq(
                githubAccountMetadata.providerAccountId,
                data.githubAccountHint.providerAccountId,
              ),
            ),
          )
          .limit(1);
        if (account.length > 0) {
          await tx.insert(projectGitHubAccountLinks).values({
            projectId: newProjectId,
            providerAccountId: data.githubAccountHint.providerAccountId,
          });
          rowCounts.projectGithubAccountLinks = 1;
        } else {
          conflicts.push({
            type: "github_account_not_linked",
            message: `GitHub account @${data.githubAccountHint.login} is not linked on this instance — project account binding dropped`,
          });
        }
      }

      // ── 6. Channels: groups → channels → messages ──────────────────────
      rowCounts.channelGroups = 0;
      for (const group of data.channelGroups) {
        const newId = randomUUID();
        idRemaps[group.id] = newId;
        await tx.insert(channelGroups).values({
          id: newId,
          projectId: newProjectId,
          name: group.name,
          position: group.position,
          createdAt: new Date(group.createdAt),
        });
        rowCounts.channelGroups++;
      }

      rowCounts.channels = 0;
      for (const channel of data.channels) {
        const newGroupId = idRemaps[channel.groupId];
        if (!newGroupId) {
          conflicts.push({
            type: "channel_group_missing",
            message: `Channel #${channel.name} referenced a group missing from the bundle — skipped`,
          });
          continue;
        }
        const newId = randomUUID();
        idRemaps[channel.id] = newId;
        await tx.insert(channels).values({
          id: newId,
          projectId: newProjectId,
          groupId: newGroupId,
          name: channel.name,
          displayName: channel.displayName,
          type: channel.type as ChannelType,
          topic: channel.topic,
          isDefault: channel.isDefault,
          createdBySessionId: null,
          lastMessageAt: channel.lastMessageAt ? new Date(channel.lastMessageAt) : null,
          messageCount: channel.messageCount,
          archivedAt: channel.archivedAt ? new Date(channel.archivedAt) : null,
          createdAt: new Date(channel.createdAt),
        });
        rowCounts.channels++;
      }

      rowCounts.peerMessages = 0;
      // Two passes: assign ids first so threaded parents remap regardless of order.
      for (const message of data.peerMessages) {
        idRemaps[message.id] = randomUUID();
      }
      for (const message of data.peerMessages) {
        await tx.insert(agentPeerMessages).values({
          id: idRemaps[message.id],
          projectId: newProjectId,
          // Session ids are host-bound — always null on the destination.
          fromSessionId: null,
          fromSessionName: message.fromSessionName,
          toSessionId: null,
          body: message.body,
          isUserMessage: message.isUserMessage,
          channelId: message.channelId ? (idRemaps[message.channelId] ?? null) : null,
          parentMessageId: message.parentMessageId
            ? (idRemaps[message.parentMessageId] ?? null)
            : null,
          replyCount: message.replyCount,
          createdAt: new Date(message.createdAt),
        });
        rowCounts.peerMessages++;
      }

      // ── 7. Tasks → dependencies ────────────────────────────────────────
      rowCounts.tasks = 0;
      for (const task of data.tasks) {
        const newId = randomUUID();
        idRemaps[task.id] = newId;
        await tx.insert(projectTasks).values({
          id: newId,
          userId: destUserId,
          projectId: newProjectId,
          sessionId: null,
          title: task.title,
          description: task.description,
          status: task.status as TaskStatus,
          priority: task.priority as TaskPriority,
          source: task.source as TaskSource,
          labels: task.labels,
          subtasks: task.subtasks,
          metadata: task.metadata,
          instructions: task.instructions,
          agentTaskKey: task.agentTaskKey,
          owner: task.owner,
          dueDate: task.dueDate ? new Date(task.dueDate) : null,
          githubIssueUrl: task.githubIssueUrl,
          sortOrder: task.sortOrder,
          createdAt: new Date(task.createdAt),
          updatedAt: new Date(task.updatedAt),
        });
        rowCounts.tasks++;
      }

      rowCounts.taskDependencies = 0;
      for (const dep of data.taskDependencies) {
        const blockerId = idRemaps[dep.blockerId];
        const blockedId = idRemaps[dep.blockedId];
        if (!blockerId || !blockedId) {
          conflicts.push({
            type: "task_dependency_dropped",
            message: "A task dependency referenced a task missing from the bundle — dropped",
          });
          continue;
        }
        await tx.insert(taskDependencies).values({ blockerId, blockedId });
        rowCounts.taskDependencies++;
      }

      // ── 8. Trigger configs (disabled pending review) ───────────────────
      rowCounts.triggerConfigs = 0;
      for (const trigger of data.triggerConfigs) {
        let triggerRepoId: string | null = null;
        if (trigger.githubRepoHint) {
          const repo = await tx
            .select({ id: githubRepositories.id })
            .from(githubRepositories)
            .where(
              and(
                eq(githubRepositories.userId, destUserId),
                eq(githubRepositories.githubId, trigger.githubRepoHint.githubId),
              ),
            )
            .limit(1);
          triggerRepoId = repo[0]?.id ?? null;
          if (!triggerRepoId) {
            conflicts.push({
              type: "github_repo_not_linked",
              message: `Trigger "${trigger.name}" referenced unlinked repository ${trigger.githubRepoHint.fullName} — repo binding cleared`,
            });
          }
        }
        await tx.insert(triggerConfigs).values({
          id: randomUUID(),
          userId: destUserId,
          projectId: newProjectId,
          githubRepoId: triggerRepoId,
          name: trigger.name,
          kind: trigger.kind as TriggerKind,
          filter: trigger.filter,
          agentProvider: trigger.agentProvider,
          agentFlags: trigger.agentFlags,
          promptTemplate: trigger.promptTemplate,
          worktreeType: trigger.worktreeType,
          enabled: false,
        });
        rowCounts.triggerConfigs++;
        conflicts.push({
          type: "trigger_disabled",
          message: `Trigger "${trigger.name}" imported disabled — re-enable after review`,
        });
      }

      // ── 9. Agent schedules (disabled + paused: no double cron firing) ──
      rowCounts.agentSchedules = 0;
      for (const schedule of data.agentSchedules) {
        await tx.insert(agentSchedules).values({
          id: randomUUID(),
          userId: destUserId,
          projectId: newProjectId,
          name: schedule.name,
          agentProvider: schedule.agentProvider,
          agentFlags: schedule.agentFlags,
          prompt: schedule.prompt,
          worktreeType: schedule.worktreeType,
          baseBranch: schedule.baseBranch,
          scheduleType: schedule.scheduleType as ScheduleType,
          cronExpression: schedule.cronExpression,
          scheduledAt: schedule.scheduledAt ? new Date(schedule.scheduledAt) : null,
          timezone: schedule.timezone,
          enabled: false,
          status: "paused",
          maxRetries: schedule.maxRetries,
          nextRunAt: null,
        });
        rowCounts.agentSchedules++;
        conflicts.push({
          type: "schedule_disabled",
          message: `Schedule "${schedule.name}" imported disabled/paused — re-enable after the source copy is retired`,
        });
      }

      return { newProjectId };
    });

    // Persist bookkeeping for verify (counts), rollback (profiles), and
    // stage 2 (path map) on the import row.
    const bookkeeping: ImportBookkeeping = {
      ...parseBookkeeping(importRow),
      pathMap,
      expectedRowCounts: rowCounts,
      profileIdRemaps,
    };
    await db
      .update(migrationImports)
      .set({
        importedProjectId: result.newProjectId,
        optionsJson: JSON.stringify(bookkeeping),
        updatedAt: new Date(),
      })
      .where(eq(migrationImports.id, importId));

    log.info("DB bundle imported", {
      importId,
      projectId: result.newProjectId,
      conflicts: conflicts.length,
      tables: Object.keys(rowCounts).length,
    });

    return {
      importedProjectId: result.newProjectId,
      idRemaps,
      conflicts,
      rowCounts,
    };
  } catch (error) {
    await markFailed(importId, String(error));
    log.error("DB bundle import failed", { importId, error: String(error) });
    throw error;
  }
}

/**
 * Mark a (db-imported) staging import completed. Stage 2 will run the file
 * phases between importDb and finalize; in stage 1 this is called right after
 * the DB bundle lands.
 */
export async function finalizeImport(
  destUserId: string,
  importId: string,
): Promise<MigrationImportRow> {
  const row = await getImport(destUserId, importId);
  if (!row) throw new Error("Import not found");
  if (row.status !== "importing" || !row.importedProjectId) {
    throw new Error(
      `Import cannot be finalized (status: ${row.status}, project: ${row.importedProjectId ?? "none"})`,
    );
  }
  const [updated] = await db
    .update(migrationImports)
    .set({ status: "completed", updatedAt: new Date() })
    .where(eq(migrationImports.id, importId))
    .returning();
  log.info("Import finalized", { importId, projectId: row.importedProjectId });
  return updated;
}

/** Tables recounted by verifyImport, keyed like ImportResult.rowCounts. */
async function countImportedRows(
  destUserId: string,
  projectId: string,
  profileIds: string[],
): Promise<Record<string, number>> {
  const count = async (rows: Promise<unknown[]>): Promise<number> => (await rows).length;

  const [
    projectCount,
    prefs,
    tasks,
    deps,
    groups,
    chans,
    messages,
    mcps,
    configs,
    secrets,
    profiles,
    links,
    triggers,
    schedules,
  ] = await Promise.all([
    count(
      db
        .select({ id: projects.id })
        .from(projects)
        .where(and(eq(projects.id, projectId), eq(projects.userId, destUserId))),
    ),
    count(
      db
        .select({ id: nodePreferences.id })
        .from(nodePreferences)
        .where(
          and(
            eq(nodePreferences.ownerId, projectId),
            eq(nodePreferences.ownerType, "project"),
            eq(nodePreferences.userId, destUserId),
          ),
        ),
    ),
    count(
      db
        .select({ id: projectTasks.id })
        .from(projectTasks)
        .where(eq(projectTasks.projectId, projectId)),
    ),
    count(
      db
        .select({ blockerId: taskDependencies.blockerId })
        .from(taskDependencies)
        .innerJoin(projectTasks, eq(taskDependencies.blockerId, projectTasks.id))
        .where(eq(projectTasks.projectId, projectId)),
    ),
    count(
      db
        .select({ id: channelGroups.id })
        .from(channelGroups)
        .where(eq(channelGroups.projectId, projectId)),
    ),
    count(
      db.select({ id: channels.id }).from(channels).where(eq(channels.projectId, projectId)),
    ),
    count(
      db
        .select({ id: agentPeerMessages.id })
        .from(agentPeerMessages)
        .where(eq(agentPeerMessages.projectId, projectId)),
    ),
    count(
      db
        .select({ id: mcpServers.id })
        .from(mcpServers)
        .where(eq(mcpServers.projectId, projectId)),
    ),
    count(
      db
        .select({ id: agentConfigs.id })
        .from(agentConfigs)
        .where(eq(agentConfigs.projectId, projectId)),
    ),
    count(
      db
        .select({ id: projectSecretsConfig.id })
        .from(projectSecretsConfig)
        .where(eq(projectSecretsConfig.projectId, projectId)),
    ),
    profileIds.length
      ? count(
          db
            .select({ id: agentProfiles.id })
            .from(agentProfiles)
            .where(inArray(agentProfiles.id, profileIds)),
        )
      : Promise.resolve(0),
    count(
      db
        .select({ projectId: projectProfileLinks.projectId })
        .from(projectProfileLinks)
        .where(eq(projectProfileLinks.projectId, projectId)),
    ),
    count(
      db
        .select({ id: triggerConfigs.id })
        .from(triggerConfigs)
        .where(eq(triggerConfigs.projectId, projectId)),
    ),
    count(
      db
        .select({ id: agentSchedules.id })
        .from(agentSchedules)
        .where(eq(agentSchedules.projectId, projectId)),
    ),
  ]);

  return {
    project: projectCount,
    nodePreferences: prefs,
    tasks,
    taskDependencies: deps,
    channelGroups: groups,
    channels: chans,
    peerMessages: messages,
    mcpServers: mcps,
    agentConfigs: configs,
    projectSecrets: secrets,
    profiles,
    projectProfileLinks: links,
    triggerConfigs: triggers,
    agentSchedules: schedules,
  };
}

/**
 * Recount the imported project's rows against the counts recorded by
 * importDb. Filesystem verification (working tree, profile dirs) is a
 * stage-2 concern — `missingPaths` is always empty in stage 1.
 */
export async function verifyImport(
  destUserId: string,
  importId: string,
): Promise<VerifyResult> {
  const row = await getImport(destUserId, importId);
  if (!row) throw new Error("Import not found");
  if (!row.importedProjectId) {
    return { ok: false, rowCounts: {}, missingPaths: [] };
  }

  const bookkeeping = parseBookkeeping(row);
  const expected = bookkeeping.expectedRowCounts ?? {};
  const profileIds = Object.values(bookkeeping.profileIdRemaps ?? {});
  const actual = await countImportedRows(destUserId, row.importedProjectId, profileIds);

  // Compare only keys the recount covers (importDb tracks a few link-table
  // counts the recount reproduces too; any drift in shared keys fails).
  let ok = true;
  for (const [table, actualCount] of Object.entries(actual)) {
    if (table in expected && expected[table] !== actualCount) {
      ok = false;
      log.warn("Verify count mismatch", {
        importId,
        table,
        expected: expected[table],
        actual: actualCount,
      });
    }
  }

  return { ok, rowCounts: actual, missingPaths: [] };
}

/**
 * Remove everything an import created: the imported project row (FK cascade
 * collects its child rows), the imported profiles (NOT cascade-covered —
 * profile links cascade only removes the link), and the staging directory.
 * Marks the import failed.
 */
export async function rollbackImport(
  destUserId: string,
  importId: string,
): Promise<void> {
  const row = await getImport(destUserId, importId);
  if (!row) throw new Error("Import not found");

  if (row.importedProjectId) {
    await db
      .delete(projects)
      .where(
        and(eq(projects.id, row.importedProjectId), eq(projects.userId, destUserId)),
      );
  }

  const profileIds = Object.values(parseBookkeeping(row).profileIdRemaps ?? {});
  if (profileIds.length > 0) {
    await db
      .delete(agentProfiles)
      .where(
        and(inArray(agentProfiles.id, profileIds), eq(agentProfiles.userId, destUserId)),
      );
  }

  try {
    await rm(row.stagingDir, { recursive: true, force: true });
  } catch (error) {
    log.warn("Failed to remove staging dir during rollback", {
      importId,
      stagingDir: row.stagingDir,
      error: String(error),
    });
  }

  await markFailed(importId, "Rolled back");
  log.info("Import rolled back", { importId, projectId: row.importedProjectId });
}

async function markFailed(importId: string, errorMessage: string): Promise<void> {
  await db
    .update(migrationImports)
    .set({ status: "failed", errorMessage, updatedAt: new Date() })
    .where(eq(migrationImports.id, importId));
}
