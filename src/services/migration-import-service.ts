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
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { pipeline } from "node:stream/promises";
import { homedir } from "node:os";
import { basename, dirname } from "node:path";
import {
  copyFile,
  mkdir,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { and, eq, inArray, lt, ne } from "drizzle-orm";
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
  ARCHIVE_NAMES,
  dbBundleSchema,
  type ArchiveManifestEntry,
  type BundleManifest,
  type ConflictReport,
  type DbBundle,
  type ImportResult,
  type MigrationOptions,
  type VerifyResult,
} from "@/lib/migration-bundle";
import { execFile, execFileNoThrow } from "@/lib/exec";
import {
  agentSettingsDirs,
  copyTree,
  sha256File,
  walkFiles,
} from "@/services/migration-file-service";
import type { MigrationImportStatus } from "@/types/migration";
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
  /** Conflicts produced by the file-phase finalize (extraction). */
  finalizeConflicts?: ConflictReport[];
}

/**
 * Typed import error: routes map `status` straight onto the HTTP response
 * (409 chunk-hash mismatch, 404 unknown, …) instead of string-matching.
 */
export class MigrationImportError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
  ) {
    super(message);
    this.name = "MigrationImportError";
  }
}

/** Import ids come from a REMOTE instance and are used as a path component. */
const IMPORT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

function parseManifest(row: MigrationImportRow): BundleManifest | null {
  if (!row.manifestJson) return null;
  try {
    return JSON.parse(row.manifestJson) as BundleManifest;
  } catch {
    return null;
  }
}

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
    throw new MigrationImportError(
      "Invalid import id (must be a uuid-like token)",
      400,
      "INVALID_IMPORT_ID",
    );
  }

  const existing = await db.query.migrationImports.findFirst({
    where: eq(migrationImports.id, jobId),
  });
  if (existing) {
    const retryable = existing.userId === destUserId && existing.status === "failed";
    if (!retryable) {
      throw new MigrationImportError(
        `Import ${jobId} already exists (status: ${existing.status})`,
        409,
        "ALREADY_EXISTS",
      );
    }
    // A failed prior attempt may be retried. Clean its artifacts (idempotent),
    // then CLAIM the retry with a conditional delete: only the caller whose
    // delete actually removed the failed row proceeds to re-insert, so a
    // concurrent duplicate POST gets a clean 409 instead of a PK crash.
    await rollbackImport(destUserId, jobId);
    const deleted = await db
      .delete(migrationImports)
      .where(
        and(
          eq(migrationImports.id, jobId),
          eq(migrationImports.userId, destUserId),
          eq(migrationImports.status, "failed"),
        ),
      )
      .returning({ id: migrationImports.id });
    if (deleted.length === 0) {
      throw new MigrationImportError(
        `Import ${jobId} already exists (a concurrent retry claimed it)`,
        409,
        "ALREADY_EXISTS",
      );
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
  let row: MigrationImportRow;
  try {
    [row] = await db
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
  } catch (error) {
    // A concurrent POST winning the gap between the existence check and this
    // insert surfaces as a primary-key violation — report it as a duplicate.
    if (/UNIQUE|PRIMARY KEY|duplicate key/i.test(String(error))) {
      throw new MigrationImportError(
        `Import ${jobId} already exists (concurrent init)`,
        409,
        "ALREADY_EXISTS",
      );
    }
    throw error;
  }

  log.info("Import staged", { importId: jobId, userId: destUserId, sourceInstanceUrl });
  return row;
}

// ─────────────────────────────────────────────────────────────────────────────
// File-chunk intake (stage 2). Chunks land as
// `<staging>/<archive>/chunk-00000.bin` — written to a .tmp then renamed
// (atomic), sha256-verified per chunk, idempotent on re-PUT.
// ─────────────────────────────────────────────────────────────────────────────

function chunkFileName(index: number): string {
  return `chunk-${String(index).padStart(5, "0")}.bin`;
}

/** Find the manifest archive entry for a (validated) archive name. */
function archiveEntry(
  manifest: BundleManifest | null,
  archiveName: string,
): ArchiveManifestEntry {
  const entry = manifest?.archives?.find((a) => a.name === archiveName);
  if (!entry) {
    throw new MigrationImportError(
      `Archive "${archiveName}" is not declared in the migration manifest`,
      400,
      "UNKNOWN_ARCHIVE",
    );
  }
  return entry;
}

export interface ReceiveChunkParams {
  archiveName: string;
  /** 0-based chunk index. */
  chunkIndex: number;
  /** sha256 (hex) of THIS chunk's bytes. */
  sha256: string;
  /** Per-archive chunk total the sender believes (validated vs manifest). */
  totalChunks: number;
  /** Raw chunk bytes — a Buffer or any async byte stream (web/node). */
  body: Buffer | AsyncIterable<Uint8Array>;
}

/** Chunk files present on disk, per archive (derived from the staging dir). */
export async function listReceivedChunks(
  row: MigrationImportRow,
): Promise<Record<string, number[]>> {
  const received: Record<string, number[]> = {};
  for (const name of ARCHIVE_NAMES) {
    const dir = join(row.stagingDir, name);
    if (!existsSync(dir)) continue;
    const indices: number[] = [];
    for (const file of await readdir(dir)) {
      const match = /^chunk-(\d{5})\.bin$/.exec(file);
      if (match) indices.push(Number.parseInt(match[1], 10));
    }
    if (indices.length > 0) received[name] = indices.sort((a, b) => a - b);
  }
  return received;
}

/**
 * Receive one archive chunk. Validates the archive/index against the staged
 * manifest, streams the body to a temp file while hashing, verifies the
 * per-chunk sha256 (409 + tmp delete on mismatch), renames into place
 * (atomic), and is idempotent when the same chunk arrives twice.
 */
export async function receiveChunk(
  destUserId: string,
  importId: string,
  params: ReceiveChunkParams,
): Promise<{ duplicate: boolean; chunksReceived: number }> {
  const row = await getImport(destUserId, importId);
  if (!row) throw new MigrationImportError("Import not found", 404, "NOT_FOUND");
  // "staged" is deliberately rejected: the DB bundle must import FIRST so the
  // bookkeeping chunks are extracted against (pathMap, profileIdRemaps, the
  // imported preference rows) exists. Chunks accepted before importDb would
  // finalize into nothing. Terminal/finalizing states reject for the same
  // reason finalize claims atomically — the file set must stop changing.
  if (row.status !== "importing" && row.status !== "receiving") {
    throw new MigrationImportError(
      `Import is not accepting chunks (status: ${row.status})`,
      409,
      "BAD_STATE",
    );
  }
  if (!(ARCHIVE_NAMES as readonly string[]).includes(params.archiveName)) {
    throw new MigrationImportError(
      `Unknown archive name "${params.archiveName}"`,
      400,
      "UNKNOWN_ARCHIVE",
    );
  }
  const entry = archiveEntry(parseManifest(row), params.archiveName);
  if (params.totalChunks !== entry.chunkCount) {
    throw new MigrationImportError(
      `Chunk total mismatch for ${params.archiveName}: sender says ${params.totalChunks}, manifest says ${entry.chunkCount}`,
      409,
      "CHUNK_TOTAL_MISMATCH",
    );
  }
  if (
    !Number.isInteger(params.chunkIndex) ||
    params.chunkIndex < 0 ||
    params.chunkIndex >= entry.chunkCount
  ) {
    throw new MigrationImportError(
      `Chunk index ${params.chunkIndex} out of range for ${params.archiveName} (0..${entry.chunkCount - 1})`,
      400,
      "CHUNK_INDEX_OUT_OF_RANGE",
    );
  }

  const archiveDir = join(row.stagingDir, params.archiveName);
  await mkdir(archiveDir, { recursive: true });
  const finalPath = join(archiveDir, chunkFileName(params.chunkIndex));
  const expectedSha = params.sha256.toLowerCase();

  // Idempotent re-PUT: an existing chunk with the same hash is a no-op.
  if (existsSync(finalPath)) {
    if ((await sha256File(finalPath)) === expectedSha) {
      const received = await listReceivedChunks(row);
      const chunksReceived = Object.values(received).reduce((n, a) => n + a.length, 0);
      return { duplicate: true, chunksReceived };
    }
    // Same index, different content: fall through and atomically replace.
  }

  // Stream to a temp file while hashing, then verify + rename into place.
  const tmpPath = `${finalPath}.tmp-${randomUUID().slice(0, 8)}`;
  const hash = createHash("sha256");
  try {
    const out = createWriteStream(tmpPath);
    const chunks: AsyncIterable<Uint8Array> | Buffer[] = Buffer.isBuffer(params.body)
      ? [params.body]
      : params.body;
    for await (const piece of chunks) {
      const buf = Buffer.isBuffer(piece) ? piece : Buffer.from(piece);
      hash.update(buf);
      if (!out.write(buf)) {
        await new Promise<void>((resolve, reject) => {
          out.once("drain", resolve);
          out.once("error", reject);
        });
      }
    }
    await new Promise<void>((resolve, reject) => {
      out.end(() => resolve());
      out.once("error", reject);
    });
  } catch (error) {
    await rm(tmpPath, { force: true });
    throw new MigrationImportError(
      `Failed to write chunk: ${String(error)}`,
      500,
      "CHUNK_WRITE_FAILED",
    );
  }

  const actualSha = hash.digest("hex");
  if (actualSha !== expectedSha) {
    await rm(tmpPath, { force: true });
    throw new MigrationImportError(
      `Chunk sha256 mismatch for ${params.archiveName}#${params.chunkIndex}`,
      409,
      "CHUNK_SHA_MISMATCH",
    );
  }
  await rename(tmpPath, finalPath);

  const received = await listReceivedChunks(row);
  const chunksReceived = Object.values(received).reduce((n, a) => n + a.length, 0);
  await db
    .update(migrationImports)
    .set({ status: "receiving", chunksReceived, updatedAt: new Date() })
    .where(eq(migrationImports.id, importId));

  log.debug("Chunk received", {
    importId,
    archive: params.archiveName,
    index: params.chunkIndex,
    chunksReceived,
  });
  return { duplicate: false, chunksReceived };
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
  if (!importRow) throw new MigrationImportError("Import not found", 404, "NOT_FOUND");
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
  // Options staged at initImport (gates e.g. the sshKeyPath rewrite below).
  const importOptions = parseBookkeeping(importRow).options;

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
        const newConfigDir = join(getProfilesDir(), newProfileId);
        await tx.insert(agentProfiles).values({
          id: newProfileId,
          userId: destUserId,
          name: profile.name,
          description: profile.description,
          provider: profile.provider as AgentProvider,
          // The directory itself is materialized by the file-phase finalize.
          configDir: newConfigDir,
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
          // sshKeyPath is a SOURCE-host path. When the key travels (it lived
          // inside the profile dir + includeSshKeys), rewrite it onto the new
          // configDir; otherwise drop it (a dangling path is worse than none).
          let sshKeyPath: string | null = null;
          const sourceKeyPath = profile.gitIdentity.sshKeyPath;
          if (sourceKeyPath) {
            const srcDir = profile.sourceConfigDir?.replace(/\/+$/, "");
            if (
              importOptions.includeSshKeys &&
              srcDir &&
              sourceKeyPath.startsWith(`${srcDir}/`)
            ) {
              sshKeyPath = join(newConfigDir, sourceKeyPath.slice(srcDir.length + 1));
            } else {
              conflicts.push({
                type: "ssh_key_path_dropped",
                message: `Profile "${profile.name}" git identity pointed at an SSH key that does not travel — cleared`,
                detail: sourceKeyPath,
              });
            }
          }
          await tx.insert(profileGitIdentities).values({
            profileId: newProfileId,
            userName: profile.gitIdentity.userName,
            userEmail: profile.gitIdentity.userEmail,
            sshKeyPath,
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

// ─────────────────────────────────────────────────────────────────────────────
// Finalize: assemble chunked archives, verify whole-archive hashes, extract.
// ─────────────────────────────────────────────────────────────────────────────

/** True when a directory exists and contains at least one entry. */
async function isNonEmptyDir(path: string): Promise<boolean> {
  if (!existsSync(path)) return false;
  try {
    return (await readdir(path)).length > 0;
  } catch {
    return false;
  }
}

/** Concatenate an archive's chunks (index order) into one file; verify sha. */
async function assembleArchive(
  row: MigrationImportRow,
  entry: ArchiveManifestEntry,
): Promise<string> {
  const archiveDir = join(row.stagingDir, entry.name);
  const outPath = join(row.stagingDir, `${entry.name}.tar.gz`);
  await rm(outPath, { force: true });

  // Check completeness up-front so a missing chunk never leaves a partial file.
  for (let index = 0; index < entry.chunkCount; index++) {
    if (!existsSync(join(archiveDir, chunkFileName(index)))) {
      throw new MigrationImportError(
        `Archive ${entry.name} is missing chunk ${index}/${entry.chunkCount}`,
        409,
        "CHUNKS_INCOMPLETE",
      );
    }
  }

  // STREAM each chunk into one append-order write stream — chunks are up to
  // 64 MiB, so buffering them (readFile + appendFile) would allocate 2× the
  // chunk per iteration and stall the event loop under concurrent finalizes.
  const out = createWriteStream(outPath);
  try {
    for (let index = 0; index < entry.chunkCount; index++) {
      await pipeline(createReadStream(join(archiveDir, chunkFileName(index))), out, {
        end: false,
      });
    }
  } finally {
    await new Promise<void>((resolve, reject) => {
      out.end(() => resolve());
      out.once("error", reject);
    });
  }

  const actual = await sha256File(outPath);
  if (actual !== entry.sha256.toLowerCase()) {
    throw new MigrationImportError(
      `Assembled archive ${entry.name} failed sha256 verification`,
      409,
      "ARCHIVE_SHA_MISMATCH",
    );
  }
  const { size } = await stat(outPath);
  if (size !== entry.sizeBytes) {
    throw new MigrationImportError(
      `Assembled archive ${entry.name} is ${size} bytes, manifest says ${entry.sizeBytes}`,
      409,
      "ARCHIVE_SIZE_MISMATCH",
    );
  }
  return outPath;
}

/** The destination working directory recorded by importDb's pref rewrite. */
async function importedWorkingDir(
  destUserId: string,
  importedProjectId: string,
): Promise<string | null> {
  const pref = await db.query.nodePreferences.findFirst({
    where: and(
      eq(nodePreferences.ownerId, importedProjectId),
      eq(nodePreferences.ownerType, "project"),
      eq(nodePreferences.userId, destUserId),
    ),
  });
  return pref?.defaultWorkingDirectory ?? null;
}

/**
 * Resolve + prepare the working-tree destination dir: parent created, and the
 * dir itself must be absent or empty — extracting over existing user files is
 * REFUSED (conflict + clean failure) rather than risked.
 */
async function prepareWorkingTreeDest(
  destUserId: string,
  importedProjectId: string,
  conflicts: ConflictReport[],
): Promise<string> {
  const destDir = await importedWorkingDir(destUserId, importedProjectId);
  if (!destDir) {
    throw new MigrationImportError(
      "No destination working directory was recorded for this import",
      409,
      "NO_WORKING_DIR",
    );
  }
  if (await isNonEmptyDir(destDir)) {
    conflicts.push({
      type: "dest_dir_not_empty",
      message: `Destination directory ${destDir} already exists and is not empty — refusing to extract over it`,
      detail: destDir,
    });
    throw new MigrationImportError(
      `Destination directory ${destDir} is not empty`,
      409,
      "DEST_DIR_NOT_EMPTY",
    );
  }
  await mkdir(destDir, { recursive: true });
  return destDir;
}

/** Extract the full working-tree archive into the mapped destination dir. */
async function extractWorkingTree(
  archivePath: string,
  destUserId: string,
  importedProjectId: string,
  conflicts: ConflictReport[],
): Promise<void> {
  const destDir = await prepareWorkingTreeDest(destUserId, importedProjectId, conflicts);
  await execFile("tar", ["-xzf", archivePath, "-C", destDir], {
    timeout: 10 * 60 * 1000,
  });
}

/**
 * git_essentials extraction: clone the recorded remote, check out the
 * recorded branch (best-effort), lay the essentials archive over the clone,
 * then apply the uncommitted diff (best-effort).
 */
async function extractEssentials(
  archivePath: string,
  destUserId: string,
  importedProjectId: string,
  manifest: BundleManifest,
  conflicts: ConflictReport[],
): Promise<void> {
  const remoteUrl = manifest.gitRemoteUrl;
  if (!remoteUrl) {
    conflicts.push({
      type: "clone_failed",
      message: "Manifest carries no git remote URL — cannot reconstruct the working tree",
    });
    throw new MigrationImportError(
      "git_essentials import requires manifest.gitRemoteUrl",
      409,
      "NO_GIT_REMOTE",
    );
  }
  const destDir = await prepareWorkingTreeDest(destUserId, importedProjectId, conflicts);

  const clone = await execFileNoThrow("git", ["clone", remoteUrl, destDir], {
    timeout: 10 * 60 * 1000,
  });
  if (clone.exitCode !== 0) {
    conflicts.push({
      type: "clone_failed",
      message: `git clone of ${remoteUrl} failed — check the destination's git credentials/network`,
      detail: clone.stderr.slice(0, 500),
    });
    throw new MigrationImportError(
      `git clone failed: ${clone.stderr.slice(0, 200)}`,
      502,
      "CLONE_FAILED",
    );
  }

  if (manifest.gitBranch && manifest.gitBranch !== "HEAD") {
    const checkout = await execFileNoThrow(
      "git",
      ["-C", destDir, "checkout", manifest.gitBranch],
      { timeout: 60_000 },
    );
    if (checkout.exitCode !== 0) {
      conflicts.push({
        type: "branch_checkout_failed",
        message: `Could not check out branch "${manifest.gitBranch}" after clone — left on the default branch`,
        detail: checkout.stderr.slice(0, 300),
      });
    }
  }

  // Lay the shipped essentials (beads, env files, untracked) over the clone.
  await execFile("tar", ["-xzf", archivePath, "-C", destDir], { timeout: 5 * 60 * 1000 });

  // Re-apply uncommitted changes to tracked files; a conflict is survivable.
  const diffPath = join(destDir, "migration.diff");
  if (existsSync(diffPath)) {
    const apply = await execFileNoThrow(
      "git",
      ["-C", destDir, "apply", "--whitespace=nowarn", "migration.diff"],
      { timeout: 60_000 },
    );
    if (apply.exitCode !== 0) {
      conflicts.push({
        type: "diff_apply_failed",
        message:
          "Uncommitted changes could not be re-applied to the fresh clone — review migration.diff manually",
        detail: apply.stderr.slice(0, 300),
      });
    } else {
      await rm(diffPath, { force: true });
    }
  }
}

/** Materialize each shipped profile dir at its REMAPPED destination id. */
async function extractProfiles(
  archivePath: string,
  row: MigrationImportRow,
  profileIdRemaps: Record<string, string>,
  conflicts: ConflictReport[],
): Promise<void> {
  const extractRoot = join(row.stagingDir, "profiles-extract");
  await rm(extractRoot, { recursive: true, force: true });
  await mkdir(extractRoot, { recursive: true });
  await execFile("tar", ["-xzf", archivePath, "-C", extractRoot], { timeout: 5 * 60 * 1000 });

  for (const [sourceId, newId] of Object.entries(profileIdRemaps)) {
    const from = join(extractRoot, "profiles", sourceId);
    if (!existsSync(from)) {
      conflicts.push({
        type: "profile_files_missing",
        message: `Profiles archive carries no files for source profile ${sourceId}`,
      });
      continue;
    }
    await copyTree(from, join(getProfilesDir(), newId));
  }
  await rm(extractRoot, { recursive: true, force: true });
}

/** Map an agent-settings provider segment to its destination base dir. */
function agentSettingsDest(provider: string): string | null {
  const dirs = agentSettingsDirs();
  return (dirs as Record<string, string>)[provider] ?? null;
}

const OVERWRITE_LIST_CAP = 100;

/**
 * Copy curated agent settings into the real HOME equivalents, overwriting and
 * RECORDING every overwritten path (capped list + total count).
 */
async function extractAgentSettings(
  archivePath: string,
  row: MigrationImportRow,
  conflicts: ConflictReport[],
): Promise<void> {
  const extractRoot = join(row.stagingDir, "agent-settings-extract");
  await rm(extractRoot, { recursive: true, force: true });
  await mkdir(extractRoot, { recursive: true });
  await execFile("tar", ["-xzf", archivePath, "-C", extractRoot], { timeout: 5 * 60 * 1000 });

  const settingsRoot = join(extractRoot, "agent-settings");
  if (!existsSync(settingsRoot)) {
    await rm(extractRoot, { recursive: true, force: true });
    return;
  }

  const overwritten: string[] = [];
  let overwrittenTotal = 0;
  for (const provider of await readdir(settingsRoot)) {
    const destBase = agentSettingsDest(provider);
    const providerRoot = join(settingsRoot, provider);
    if (!destBase || !(await isNonEmptyDir(providerRoot))) continue;
    for (const rel of await walkFiles(providerRoot)) {
      const destPath = join(destBase, rel);
      if (existsSync(destPath)) {
        overwrittenTotal++;
        if (overwritten.length < OVERWRITE_LIST_CAP) overwritten.push(destPath);
      }
      await mkdir(dirname(destPath), { recursive: true });
      await copyFile(join(providerRoot, rel), destPath);
    }
  }
  for (const path of overwritten) {
    conflicts.push({
      type: "file_overwritten",
      message: `Agent settings overwrote ${path}`,
      detail: path,
    });
  }
  if (overwrittenTotal > overwritten.length) {
    conflicts.push({
      type: "file_overwritten",
      message: `Agent settings overwrote ${overwrittenTotal} files in total (${overwrittenTotal - overwritten.length} not listed)`,
    });
  }
  await rm(extractRoot, { recursive: true, force: true });
}

/**
 * Finalize an import. DB-only migrations (no archives in the manifest) just
 * flip importing → completed. File migrations require EVERY chunk, then per
 * archive: concatenate → verify the whole-archive sha256 → extract
 * (working-tree/essentials → the mapped working dir, profiles → the remapped
 * configDirs, agent-settings → curated HOME paths with overwrite recording).
 * Returns the updated row + the file-phase conflicts (also persisted in the
 * bookkeeping for later inspection).
 */
export async function finalizeImport(
  destUserId: string,
  importId: string,
): Promise<{ import: MigrationImportRow; conflicts: ConflictReport[] }> {
  const row = await getImport(destUserId, importId);
  if (!row) throw new MigrationImportError("Import not found", 404, "NOT_FOUND");
  const manifest = parseManifest(row);
  const archives = manifest?.archives ?? [];

  if (!row.importedProjectId || (row.status !== "importing" && row.status !== "receiving")) {
    throw new MigrationImportError(
      `Import cannot be finalized (status: ${row.status}, project: ${row.importedProjectId ?? "none"})`,
      409,
      "FINALIZE_REJECTED",
    );
  }

  // ATOMIC claim: exactly one finalize may run. Two concurrent calls would
  // otherwise both delete/append the same assembled-archive path and race the
  // extraction; the conditional update lets one win and 409s the other.
  const [claimed] = await db
    .update(migrationImports)
    .set({ status: "finalizing", updatedAt: new Date() })
    .where(
      and(
        eq(migrationImports.id, importId),
        eq(migrationImports.userId, destUserId),
        inArray(migrationImports.status, ["importing", "receiving"]),
      ),
    )
    .returning();
  if (!claimed) {
    throw new MigrationImportError(
      `Import ${importId} is already finalizing/finalized`,
      409,
      "BAD_STATE",
    );
  }

  const conflicts: ConflictReport[] = [];
  const bookkeeping = parseBookkeeping(row);

  try {
    for (const entry of archives) {
      const archivePath = await assembleArchive(row, entry);
      if (entry.name === "working-tree") {
        await extractWorkingTree(archivePath, destUserId, row.importedProjectId, conflicts);
      } else if (entry.name === "essentials") {
        if (!manifest) {
          throw new MigrationImportError("Import has no manifest", 409, "NO_MANIFEST");
        }
        await extractEssentials(
          archivePath,
          destUserId,
          row.importedProjectId,
          manifest,
          conflicts,
        );
      } else if (entry.name === "profiles") {
        await extractProfiles(archivePath, row, bookkeeping.profileIdRemaps ?? {}, conflicts);
      } else if (entry.name === "agent-settings") {
        await extractAgentSettings(archivePath, row, conflicts);
      }
      await rm(archivePath, { force: true });
    }
  } catch (error) {
    // Persist whatever conflicts were gathered before the failure.
    bookkeeping.finalizeConflicts = conflicts;
    await db
      .update(migrationImports)
      .set({
        status: "failed",
        errorMessage: String(error instanceof Error ? error.message : error),
        optionsJson: JSON.stringify(bookkeeping),
        updatedAt: new Date(),
      })
      .where(eq(migrationImports.id, importId));
    log.error("Import finalize failed", { importId, error: String(error) });
    throw error;
  }

  bookkeeping.finalizeConflicts = conflicts;
  const [updated] = await db
    .update(migrationImports)
    .set({
      status: "completed",
      optionsJson: JSON.stringify(bookkeeping),
      updatedAt: new Date(),
    })
    // Conditional on the claim this call holds — a rollback that raced the
    // extraction (marking the row failed) must not be flipped to completed.
    .where(and(eq(migrationImports.id, importId), eq(migrationImports.status, "finalizing")))
    .returning();
  if (!updated) {
    throw new MigrationImportError(
      `Import ${importId} lost its finalize claim (rolled back concurrently?)`,
      409,
      "BAD_STATE",
    );
  }
  log.info("Import finalized", {
    importId,
    projectId: row.importedProjectId,
    archives: archives.length,
    conflicts: conflicts.length,
  });
  return { import: updated, conflicts };
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
 * Recount the imported project's rows against the counts recorded by importDb
 * AND run filesystem checks: the imported working tree, its `.beads/` dir
 * (when the manifest shipped one), and each remapped profile dir. Any path
 * that is promised but absent on disk is reported in `missingPaths` (and
 * fails the verify).
 */
export async function verifyImport(
  destUserId: string,
  importId: string,
): Promise<VerifyResult> {
  const row = await getImport(destUserId, importId);
  if (!row) throw new MigrationImportError("Import not found", 404, "NOT_FOUND");
  if (!row.importedProjectId) {
    return { ok: false, rowCounts: {}, missingPaths: [] };
  }

  const bookkeeping = parseBookkeeping(row);
  const expected = bookkeeping.expectedRowCounts ?? {};
  const profileIds = Object.values(bookkeeping.profileIdRemaps ?? {});
  const actual = await countImportedRows(destUserId, row.importedProjectId, profileIds);

  // A failed import NEVER verifies ok — a pre-existing directory at the
  // destination path must not masquerade as a successful extraction.
  if (row.status === "failed") {
    return { ok: false, rowCounts: actual, missingPaths: [] };
  }

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

  // Filesystem checks: every path the file phase promised must exist.
  const missingPaths: string[] = [];
  const manifest = parseManifest(row);
  const archives = manifest?.archives ?? [];
  const hasTree = archives.some((a) => a.name === "working-tree" || a.name === "essentials");
  if (hasTree) {
    const workingDir = await importedWorkingDir(destUserId, row.importedProjectId);
    if (!workingDir || !existsSync(workingDir)) {
      missingPaths.push(workingDir ?? "(no working directory recorded)");
    } else if (manifest?.beadsIncluded && !existsSync(join(workingDir, ".beads"))) {
      missingPaths.push(join(workingDir, ".beads"));
    }
  }
  if (archives.some((a) => a.name === "profiles")) {
    for (const newId of profileIds) {
      const dir = join(getProfilesDir(), newId);
      if (!existsSync(dir)) missingPaths.push(dir);
    }
  }
  if (missingPaths.length > 0) ok = false;

  return { ok, rowCounts: actual, missingPaths };
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
  if (!row) throw new MigrationImportError("Import not found", 404, "NOT_FOUND");

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

/** Non-terminal DESTINATION import states (mirror of the source-job set). */
const NON_TERMINAL_IMPORT_STATUSES: MigrationImportStatus[] = [
  "staged",
  "receiving",
  "importing",
  "finalizing",
];

/** Imports stuck non-terminal longer than this are presumed dead (2h). */
const STALE_IMPORT_MAX_AGE_MS = 2 * 60 * 60 * 1000;

/**
 * Startup hygiene for the DESTINATION side: an inbound migration whose source
 * died mid-push leaves an import row stuck non-terminal (and a staging dir on
 * disk). Mark any such row older than 2h failed and best-effort remove its
 * staging directory. Mirrors pruneStaleMigrations on the source side. Returns
 * the number of imports failed.
 */
export async function pruneStaleImports(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - STALE_IMPORT_MAX_AGE_MS);
  const stale = await db
    .select()
    .from(migrationImports)
    .where(
      and(
        inArray(migrationImports.status, NON_TERMINAL_IMPORT_STATUSES),
        lt(migrationImports.updatedAt, cutoff),
      ),
    );

  const stagingRoot = getMigrationStagingDir();
  for (const row of stale) {
    // Safety: never rm anything outside the migration-staging root, even if a
    // row somehow carried a tampered stagingDir.
    if (row.stagingDir.startsWith(`${stagingRoot}/`) || row.stagingDir === stagingRoot) {
      try {
        await rm(row.stagingDir, { recursive: true, force: true });
      } catch (error) {
        log.warn("Failed to remove staging dir for stale import", {
          importId: row.id,
          stagingDir: row.stagingDir,
          error: String(error),
        });
      }
    } else {
      log.warn("Refusing to remove out-of-root staging dir for stale import", {
        importId: row.id,
        stagingDir: row.stagingDir,
      });
    }
    await markFailed(row.id, "Marked failed by startup hygiene (no progress for 2h)");
  }

  if (stale.length > 0) {
    log.warn("Pruned stale destination imports", { count: stale.length });
  }
  return stale.length;
}
