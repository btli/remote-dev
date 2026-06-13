/**
 * MigrationService — SOURCE-side orchestrator for server-to-server project
 * migration (stages 1+2: DB rows + chunked file transfer).
 *
 * State machine: pending → running → db_done → files_done → verifying →
 * completed, with failed/aborted terminal escapes. DB-only migrations (no
 * archives) skip files_done.
 *
 * Every transition is a CONDITIONAL update (`WHERE status IN (…)`), so an
 * abort that lands mid-run wins the race: the runner's next transition (the
 * per-chunk progress update during uploads) matches 0 rows and it stops
 * quietly with a best-effort destination rollback.
 *
 * Testability: DB ops, bundle/archive building, chunk reads, peer HTTP, and
 * project deletion are injected via {@link MigrationServiceDeps} (defaulting
 * to the real implementations), mirroring agent-run-service.
 */
import { createHash } from "node:crypto";
import { rm } from "node:fs/promises";
import { and, eq, gte, inArray, lt } from "drizzle-orm";
import { db } from "@/db";
import { migrationJobs, projects } from "@/db/schema";
import { createLogger } from "@/lib/logger";
import { peerFetch, readPeerJson } from "@/lib/peer-fetch";
import { GZIP_CONTENT_ENCODING, gzipJson } from "@/lib/migration-gzip";
import {
  BUNDLE_VERSION,
  CHUNK_SIZE_BYTES,
  type BundleManifest,
  type ConflictReport,
  type DbBundle,
  type ImportResult,
  type MigrationOptions,
  type VerifyResult,
} from "@/lib/migration-bundle";
import type { MigrationImportStatus, MigrationJobStatus } from "@/types/migration";
import { MigrationServiceError } from "./migration-errors";
import * as MigrationExportService from "./migration-export-service";
import * as MigrationFileService from "./migration-file-service";
import type { BuildArchivesInput, BuiltArchives } from "./migration-file-service";
import * as PeerInstanceService from "./peer-instance-service";
import { ProjectService } from "./project-service";

const log = createLogger("MigrationService");

/** Row type for a `migration_job` record. */
export type MigrationJobRow = typeof migrationJobs.$inferSelect;
type MigrationJobInsert = typeof migrationJobs.$inferInsert;

const NON_TERMINAL_STATUSES: MigrationJobStatus[] = [
  "pending",
  "running",
  "db_done",
  "files_done",
  "verifying",
];

/** Hours after which a stuck non-terminal job is declared dead. */
const STALE_JOB_MAX_AGE_MS = 2 * 60 * 60 * 1000;

export interface CreateMigrationJobInput {
  projectId: string;
  peerInstanceId: string;
  options?: Partial<MigrationOptions>;
}

/**
 * Injectable dependencies. Defaults wire to the real DB + export service +
 * peerFetch + ProjectService; tests pass fakes.
 */
export interface MigrationServiceDeps {
  getJob(jobId: string): Promise<MigrationJobRow | null>;
  /**
   * Conditionally transition a job: applies `patch` only when the current
   * status is in `expect`. Returns the updated row, or null when the guard
   * matched nothing (e.g. an abort won the race).
   */
  transition(
    jobId: string,
    expect: MigrationJobStatus[],
    patch: Partial<MigrationJobRow>,
  ): Promise<MigrationJobRow | null>;
  getPeer(
    userId: string,
    peerId: string,
  ): Promise<PeerInstanceService.PeerInstanceRow | null>;
  buildBundle(
    userId: string,
    projectId: string,
    options: MigrationOptions,
  ): Promise<{ bundle: DbBundle; warnings: string[] }>;
  peerFetch(
    peer: PeerInstanceService.PeerInstanceRow,
    path: string,
    init?: RequestInit,
  ): Promise<Response>;
  /** Build the file archives (working tree/essentials, profiles, settings). */
  buildArchives(input: BuildArchivesInput): Promise<BuiltArchives>;
  /** Read one CHUNK_SIZE_BYTES piece of a built archive. */
  readChunk(archivePath: string, index: number): Promise<Buffer>;
  /** Remove the source-side staging dir when the job ends (best-effort). */
  removeDir(path: string): Promise<void>;
  deleteProject(projectId: string): Promise<void>;
  /** Gzip a value's JSON serialization (DB-bundle POST compression). */
  gzipJson(value: unknown): Promise<Buffer>;
  now(): Date;
}

function defaultDeps(): MigrationServiceDeps {
  return {
    getJob: async (jobId) => {
      const row = await db.query.migrationJobs.findFirst({
        where: eq(migrationJobs.id, jobId),
      });
      return row ?? null;
    },
    transition: async (jobId, expect, patch) => {
      const [row] = await db
        .update(migrationJobs)
        .set({ ...patch, updatedAt: new Date() })
        .where(and(eq(migrationJobs.id, jobId), inArray(migrationJobs.status, expect)))
        .returning();
      return row ?? null;
    },
    getPeer: (userId, peerId) => PeerInstanceService.getPeerRow(userId, peerId),
    buildBundle: (userId, projectId, options) =>
      MigrationExportService.buildDbBundle(userId, projectId, options),
    peerFetch: (peer, path, init) => peerFetch(peer, path, init),
    buildArchives: (input) => MigrationFileService.buildArchives(input),
    readChunk: (archivePath, index) =>
      MigrationFileService.readArchiveChunk(archivePath, index),
    removeDir: (path) => rm(path, { recursive: true, force: true }),
    // The existing project deletion path: kills owned tmux sessions, then
    // deletes the row (FK cascade). It does NOT touch working-tree files.
    deleteProject: (projectId) => ProjectService.delete(projectId),
    gzipJson: (value) => gzipJson(value),
    now: () => new Date(),
  };
}

/**
 * Build the body for the DB-bundle POST. When the destination peer advertised
 * `acceptsGzipBundle` (cached capabilities), gzip the JSON so the single POST
 * stays well under the wire path's ~100 MB on-wire request cap — a DbBundle is
 * repetitive JSON and shrinks 5–15×. Older destinations (no/false flag) get the
 * raw JSON document they understand. Returns the body + the headers to send.
 */
async function buildImportPostBody(
  deps: MigrationServiceDeps,
  peer: PeerInstanceService.PeerInstanceRow,
  payload: unknown,
): Promise<{ body: BodyInit; headers: Record<string, string> }> {
  const caps = PeerInstanceService.parseCapabilities(peer.capabilities);
  if (caps?.acceptsGzipBundle) {
    try {
      const compressed = await deps.gzipJson(payload);
      return {
        body: new Uint8Array(compressed),
        headers: {
          "content-type": "application/json",
          "content-encoding": GZIP_CONTENT_ENCODING,
        },
      };
    } catch (error) {
      // Compression is an optimization — never fail the migration over it.
      log.warn("DB-bundle gzip failed — falling back to plain JSON", {
        error: String(error),
      });
    }
  }
  return {
    body: JSON.stringify(payload),
    headers: { "content-type": "application/json" },
  };
}

/**
 * This instance's public URL, for the manifest + import provenance.
 * Informational only — falls back to "unknown". Prefer an explicit public
 * URL over a localhost AUTH_URL so the recorded provenance isn't
 * "http://localhost:6001" on a deployed instance.
 */
export function getSourceInstanceUrl(): string {
  const authUrl = process.env.AUTH_URL || process.env.NEXTAUTH_URL || "";
  const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)\b/i.test(authUrl);
  if (isLocal && process.env.RDV_PUBLIC_URL) return process.env.RDV_PUBLIC_URL;
  return authUrl || process.env.RDV_PUBLIC_URL || "unknown";
}

const DEFAULT_OPTIONS: MigrationOptions = {
  workingTreeMode: "full_tar",
  includeDotEnv: true,
  includeAgentCreds: true,
  includeSshKeys: false,
  includeAgentSettings: true,
  includeChannelHistory: false,
  removeSourceAfterVerify: false,
};

/** The options a job row was created with. */
export function jobOptions(job: MigrationJobRow): MigrationOptions {
  return {
    workingTreeMode: job.workingTreeMode,
    includeDotEnv: job.includeDotEnv,
    includeAgentCreds: job.includeAgentCreds,
    includeSshKeys: job.includeSshKeys,
    includeAgentSettings: job.includeAgentSettings,
    includeChannelHistory: job.includeChannelHistory,
    removeSourceAfterVerify: job.removeSourceAfterVerify,
  };
}

/**
 * Create a pending migration job after validating project ownership and the
 * peer registration. Does NOT start it — call {@link startJob}.
 */
export async function createJob(
  userId: string,
  input: CreateMigrationJobInput,
): Promise<MigrationJobRow> {
  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, input.projectId), eq(projects.userId, userId)),
  });
  if (!project) {
    throw new MigrationServiceError("Project not found", 404, "PROJECT_NOT_FOUND");
  }

  const peer = await PeerInstanceService.getPeerRow(userId, input.peerInstanceId);
  if (!peer) {
    throw new MigrationServiceError("Peer instance not found", 404, "PEER_NOT_FOUND");
  }

  const options: MigrationOptions = { ...DEFAULT_OPTIONS, ...input.options };
  const values: MigrationJobInsert = {
    userId,
    projectId: input.projectId,
    peerInstanceId: input.peerInstanceId,
    status: "pending",
    workingTreeMode: options.workingTreeMode,
    includeDotEnv: options.includeDotEnv,
    includeAgentCreds: options.includeAgentCreds,
    includeSshKeys: options.includeSshKeys,
    includeAgentSettings: options.includeAgentSettings,
    includeChannelHistory: options.includeChannelHistory,
    removeSourceAfterVerify: options.removeSourceAfterVerify,
  };
  const [row] = await db.insert(migrationJobs).values(values).returning();
  log.info("Migration job created", {
    jobId: row.id,
    projectId: input.projectId,
    peerInstanceId: input.peerInstanceId,
  });
  return row;
}

/** Retried per-chunk PUT (3 attempts, linear backoff). Throws after the last. */
async function putChunkWithRetry(
  deps: MigrationServiceDeps,
  peer: PeerInstanceService.PeerInstanceRow,
  jobId: string,
  archiveName: string,
  chunkIndex: number,
  totalChunks: number,
  sha256: string,
  data: Buffer,
  attempts = 3,
): Promise<void> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await deps.peerFetch(
        peer,
        `/api/migration/imports/${jobId}/chunks`,
        {
          method: "PUT",
          headers: {
            "content-type": "application/octet-stream",
            "x-archive-name": archiveName,
            "x-chunk-index": String(chunkIndex),
            "x-chunk-sha256": sha256,
            "x-total-chunks": String(totalChunks),
          },
          body: new Uint8Array(data),
        },
      );
      if (response.ok) return;
      lastError = new Error(
        `Chunk ${archiveName}#${chunkIndex} rejected: HTTP ${response.status}`,
      );
    } catch (error) {
      lastError = error;
    }
    if (attempt < attempts) {
      log.warn("Chunk upload attempt failed — retrying", {
        jobId,
        archive: archiveName,
        index: chunkIndex,
        attempt,
        error: String(lastError),
      });
      await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/**
 * Upload an archive's chunks, skipping any the destination already holds, with
 * a between-chunks abort check (a status no longer `db_done` matches nothing →
 * roll the destination back and stop). Returns the running `bytesTransferred`
 * total, or `null` when the job was aborted mid-upload (the caller must stop).
 *
 * Shared by the fresh-push (`startJob`) and the source-restart resume
 * (`resumeJob`) paths — both stream from the SAME rebuilt archives and rely on
 * the destination's idempotent, sha-checked chunk intake.
 */
async function uploadArchiveChunks(
  deps: MigrationServiceDeps,
  peer: PeerInstanceService.PeerInstanceRow,
  jobId: string,
  built: BuiltArchives,
  received: Record<string, number[]>,
  startBytes: number,
): Promise<number | null> {
  let bytesTransferred = startBytes;
  for (const entry of built.archives) {
    const archivePath = built.archivePaths[entry.name];
    if (!archivePath) {
      throw new Error(`Built archive path missing for ${entry.name}`);
    }
    const have = new Set(received[entry.name] ?? []);
    // Byte size of chunk `index` (the last chunk is short); clamped to 0.
    const chunkBytes = (index: number): number =>
      Math.max(0, Math.min(CHUNK_SIZE_BYTES, entry.sizeBytes - index * CHUNK_SIZE_BYTES));
    // Count chunks the destination ALREADY holds once, up front — they are part
    // of the transferred total but are never re-uploaded.
    for (const index of have) {
      if (index >= 0 && index < entry.chunkCount) {
        bytesTransferred += chunkBytes(index);
      }
    }
    for (let index = 0; index < entry.chunkCount; index++) {
      const chunkSize = chunkBytes(index);
      if (!have.has(index)) {
        const data = await deps.readChunk(archivePath, index);
        const sha = createHash("sha256").update(data).digest("hex");
        await putChunkWithRetry(deps, peer, jobId, entry.name, index, entry.chunkCount, sha, data);
        // Only newly-uploaded chunks add to the total here (already-held chunks
        // were counted above) — so a resumed push can't overshoot.
        bytesTransferred += chunkSize;
      }
      // The progress update runs EVERY iteration and doubles as the
      // between-chunks abort check: a status no longer db_done (the job was
      // aborted) matches nothing → stop and roll the destination back.
      const progressed = await deps.transition(jobId, ["db_done"], {
        bytesTransferred,
      });
      if (!progressed) {
        log.warn("Upload interrupted (job left db_done) — stopping", { jobId });
        try {
          await deps.peerFetch(peer, `/api/migration/imports/${jobId}`, {
            method: "DELETE",
          });
        } catch {
          // Best-effort.
        }
        return null;
      }
    }
  }
  return bytesTransferred;
}

/** Read the destination's per-archive `receivedChunks` (best-effort, {} on error). */
async function fetchReceivedChunks(
  deps: MigrationServiceDeps,
  peer: PeerInstanceService.PeerInstanceRow,
  jobId: string,
): Promise<Record<string, number[]>> {
  try {
    const statusResponse = await deps.peerFetch(peer, `/api/migration/imports/${jobId}`, {
      method: "GET",
    });
    if (statusResponse.ok) {
      const body = (await statusResponse.json()) as {
        receivedChunks?: Record<string, number[]>;
      };
      return body.receivedChunks ?? {};
    }
  } catch {
    // Fresh upload — resume info is an optimization only.
  }
  return {};
}

/**
 * Finalize + verify on the destination, then complete the source job (and,
 * when opted in, delete the source project — completion is recorded FIRST so a
 * crash can never destroy the source while the job still looks unfinished).
 *
 * `baseConflicts`/`baseRowCounts` carry the DB-phase import result so the
 * persisted report is complete. Shared by `startJob` and `resumeJob`. Every
 * destination call here is idempotent (finalize is claim-guarded, verify is a
 * read), so re-driving after a restart is safe.
 */
async function finalizeVerifyAndComplete(
  deps: MigrationServiceDeps,
  peer: PeerInstanceService.PeerInstanceRow,
  job: MigrationJobRow,
  baseConflicts: ConflictReport[],
  baseRowCounts: Record<string, number>,
): Promise<void> {
  const jobId = job.id;

  const finalizeBody = await readPeerJson<{ conflicts?: ConflictReport[] }>(
    await deps.peerFetch(peer, `/api/migration/imports/${jobId}/finalize`, {
      method: "POST",
    }),
    "Import finalize",
  );
  const finalizeConflicts: ConflictReport[] = finalizeBody.conflicts ?? [];

  const verifying = await deps.transition(jobId, ["db_done", "files_done"], {
    status: "verifying",
  });
  if (!verifying) return; // aborted mid-flight

  const verify = await readPeerJson<VerifyResult>(
    await deps.peerFetch(peer, `/api/migration/imports/${jobId}/verify`, {
      method: "GET",
    }),
    "Import verify",
  );

  const conflictReport = {
    conflicts: [...baseConflicts, ...finalizeConflicts],
    rowCounts: baseRowCounts,
    verify,
  };

  if (!verify.ok) {
    // Keep the report visible on the failed row before bailing out.
    await deps.transition(jobId, ["verifying"], {
      conflictReportJson: JSON.stringify(conflictReport),
    });
    throw new Error(
      `Destination verification failed: ${JSON.stringify(verify.rowCounts)}`,
    );
  }

  // ── Complete FIRST, then (optionally) remove the source project ──
  // The job row must record success (report + destProjectId) before any
  // destructive step: a crash between "delete" and "mark completed" would
  // otherwise destroy the user's project while the job looks unfinished.
  const completed = await deps.transition(jobId, ["verifying"], {
    status: "completed",
    conflictReportJson: JSON.stringify(conflictReport),
    completedAt: deps.now(),
  });
  if (!completed) return; // aborted mid-flight

  if (job.removeSourceAfterVerify) {
    log.info("Removing source project after verified migration", {
      jobId,
      projectId: job.projectId,
    });
    try {
      // Existing deletion path (kills tmux, cascades rows); never rm -rf.
      await deps.deleteProject(job.projectId);
    } catch (deleteError) {
      // Fail-safe: the migration stays completed (the copy is verified on the
      // destination) and the source copy survives; record the miss in the
      // already-persisted report so the UI can surface it.
      log.error("Source project deletion failed after completed migration", {
        jobId,
        projectId: job.projectId,
        error: String(deleteError),
      });
      conflictReport.conflicts.push({
        type: "source_delete_failed",
        message:
          "Migration completed but the source project could not be deleted — remove it manually",
        detail: String(deleteError),
      });
      await deps.transition(jobId, ["completed"], {
        conflictReportJson: JSON.stringify(conflictReport),
      });
    }
  }

  log.info("Migration job completed", { jobId, destProjectId: job.destProjectId });
}

/**
 * Run a pending migration job to completion. NEVER throws to the caller —
 * all failures land on the job row (status failed + errorMessage), with a
 * best-effort destination-side rollback.
 */
export async function startJob(
  jobId: string,
  injectedDeps?: MigrationServiceDeps,
): Promise<void> {
  const deps = injectedDeps ?? defaultDeps();

  const job = await deps.getJob(jobId);
  if (!job) {
    log.error("startJob: job not found", { jobId });
    return;
  }

  const fail = async (error: unknown, peerForCleanup?: PeerInstanceService.PeerInstanceRow) => {
    log.error("Migration job failed", { jobId, error: String(error) });
    await deps.transition(jobId, NON_TERMINAL_STATUSES, {
      status: "failed",
      errorMessage: String(error),
      completedAt: deps.now(),
    });
    if (peerForCleanup) {
      try {
        await deps.peerFetch(peerForCleanup, `/api/migration/imports/${jobId}`, {
          method: "DELETE",
        });
      } catch (cleanupError) {
        log.warn("Best-effort destination rollback failed", {
          jobId,
          error: String(cleanupError),
        });
      }
    }
  };

  let peer: PeerInstanceService.PeerInstanceRow | null = null;
  let built: BuiltArchives | null = null;
  try {
    const running = await deps.transition(jobId, ["pending"], {
      status: "running",
      startedAt: deps.now(),
    });
    if (!running) {
      log.warn("startJob: job not in pending state, skipping", { jobId });
      return;
    }

    if (!job.peerInstanceId) {
      throw new Error("Job has no peer instance");
    }
    peer = await deps.getPeer(job.userId, job.peerInstanceId);
    if (!peer) throw new Error("Peer instance not found");

    const options = jobOptions(job);
    const { bundle, warnings } = await deps.buildBundle(
      job.userId,
      job.projectId,
      options,
    );

    // ── Build the file archives BEFORE the import init so the manifest the
    // destination stages already declares every archive + chunk count. ──
    built = await deps.buildArchives({
      jobId,
      workingDir: bundle.nodePreferences[0]?.defaultWorkingDirectory ?? null,
      options,
      profiles: bundle.profiles
        .filter((p) => !!p.sourceConfigDir)
        .map((p) => ({ id: p.id, configDir: p.sourceConfigDir as string })),
    });
    const totalBytes = built.archives.reduce((n, a) => n + a.sizeBytes, 0);
    const totalChunks = built.archives.reduce((n, a) => n + a.chunkCount, 0);

    const manifest: BundleManifest = {
      version: BUNDLE_VERSION,
      sourceInstanceUrl: getSourceInstanceUrl(),
      sourceProjectId: job.projectId,
      sourceProjectName: bundle.project.name,
      exportedAt: deps.now().toISOString(),
      workingTreeMode: options.workingTreeMode,
      totalChunks,
      totalBytes,
      agentSettingsIncluded: options.includeAgentSettings,
      profileIds: bundle.profiles.map((p) => p.id),
      warnings: [...warnings, ...built.warnings],
      archives: built.archives,
      gitRemoteUrl: built.gitRemoteUrl,
      gitBranch: built.gitBranch,
      beadsIncluded: built.beadsIncluded,
      info: built.info,
    };

    // ── DB phase: push the bundle (init + import happen destination-side) ──
    // gzip the body when the destination advertised support — the bundle is one
    // POST and the wire path caps the on-wire request size at ~100 MB.
    const { body: importPostBody, headers: importPostHeaders } =
      await buildImportPostBody(deps, peer, {
        jobId,
        sourceInstanceUrl: manifest.sourceInstanceUrl,
        manifest,
        options,
        dbBundle: bundle,
      });
    const importResponse = await deps.peerFetch(peer, "/api/migration/imports", {
      method: "POST",
      headers: importPostHeaders,
      body: importPostBody,
    });
    const importBody = await readPeerJson<{
      importId: string;
      status: string;
      result: ImportResult;
    }>(importResponse, "DB bundle import");

    // `bytesTransferred` tracks ARCHIVE bytes confirmed on the destination,
    // measured against `sizeEstimateBytes` (= totalBytes, archive bytes only),
    // so it converges to 100% exactly. Starts at 0 for a fresh push.
    let bytesTransferred = 0;
    const dbDone = await deps.transition(jobId, ["running"], {
      status: "db_done",
      destProjectId: importBody.result?.importedProjectId ?? null,
      bundleManifestJson: JSON.stringify(manifest),
      sizeEstimateBytes: totalBytes,
      bytesTransferred,
    });
    if (!dbDone) return; // aborted mid-flight

    // ── File phase: chunked archive upload (resume-aware, abort-aware) ──
    if (built.archives.length > 0) {
      // Resume: skip chunks the destination already holds.
      const received = await fetchReceivedChunks(deps, peer, jobId);
      const total = await uploadArchiveChunks(deps, peer, jobId, built, received, bytesTransferred);
      if (total === null) return; // aborted mid-upload (destination rolled back)
      bytesTransferred = total;

      const filesDone = await deps.transition(jobId, ["db_done"], {
        status: "files_done",
      });
      if (!filesDone) return; // aborted mid-flight
    } else if (options.workingTreeMode !== "none") {
      log.info("No file archives produced (missing working dir?) — DB-only migration", {
        jobId,
        workingTreeMode: options.workingTreeMode,
      });
    }

    await finalizeVerifyAndComplete(
      deps,
      peer,
      { ...job, destProjectId: importBody.result?.importedProjectId ?? null },
      importBody.result?.conflicts ?? [],
      importBody.result?.rowCounts ?? {},
    );
  } catch (error) {
    await fail(error, peer ?? undefined);
  } finally {
    // The built tars are job-scoped scratch — always reclaim the disk.
    if (built) {
      try {
        await deps.removeDir(built.stagingDir);
      } catch (cleanupError) {
        log.warn("Failed to remove source staging dir", {
          jobId,
          stagingDir: built.stagingDir,
          error: String(cleanupError),
        });
      }
    }
  }
}

/** Fetch a single job (owner-scoped). */
export async function getJob(
  userId: string,
  jobId: string,
): Promise<MigrationJobRow | null> {
  const row = await db.query.migrationJobs.findFirst({
    where: and(eq(migrationJobs.id, jobId), eq(migrationJobs.userId, userId)),
  });
  return row ?? null;
}

/** List the caller's jobs, optionally filtered. */
export async function listJobs(
  userId: string,
  filters: { projectId?: string; status?: MigrationJobStatus } = {},
): Promise<MigrationJobRow[]> {
  const conds = [eq(migrationJobs.userId, userId)];
  if (filters.projectId) conds.push(eq(migrationJobs.projectId, filters.projectId));
  if (filters.status) conds.push(eq(migrationJobs.status, filters.status));
  return db
    .select()
    .from(migrationJobs)
    .where(and(...conds))
    .orderBy(migrationJobs.createdAt);
}

/**
 * Abort a non-terminal job. The runner's conditional transitions observe the
 * status change and stop at their next step; a best-effort destination
 * rollback removes anything already imported.
 */
export async function abortJob(
  userId: string,
  jobId: string,
  injectedDeps?: MigrationServiceDeps,
): Promise<MigrationJobRow | null> {
  const deps = injectedDeps ?? defaultDeps();
  const job = await getJob(userId, jobId);
  if (!job) return null;

  const aborted = await deps.transition(jobId, NON_TERMINAL_STATUSES, {
    status: "aborted",
    completedAt: deps.now(),
  });
  if (!aborted) return job; // already terminal

  if (job.peerInstanceId) {
    const peer = await deps.getPeer(userId, job.peerInstanceId);
    if (peer) {
      try {
        await deps.peerFetch(peer, `/api/migration/imports/${jobId}`, {
          method: "DELETE",
        });
      } catch (error) {
        log.warn("Best-effort destination rollback on abort failed", {
          jobId,
          error: String(error),
        });
      }
    }
  }

  log.info("Migration job aborted", { jobId, userId });
  return aborted;
}

/** The in-flight source statuses a restart can resume (vs. pending/terminal). */
const RESUMABLE_STATUSES: MigrationJobStatus[] = ["running", "db_done", "files_done"];

/**
 * What the destination knows about an import (subset of its row we consume).
 * `null` means the destination has no record of this import (404).
 */
interface DestImportState {
  status: MigrationImportStatus;
  importedProjectId: string | null;
  receivedChunks: Record<string, number[]>;
}

/** Fetch the destination's view of an import (null on 404 / unreadable). */
async function fetchDestImportState(
  deps: MigrationServiceDeps,
  peer: PeerInstanceService.PeerInstanceRow,
  jobId: string,
): Promise<DestImportState | null> {
  let response: Response;
  try {
    response = await deps.peerFetch(peer, `/api/migration/imports/${jobId}`, {
      method: "GET",
    });
  } catch {
    return null;
  }
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`Destination import status check failed: HTTP ${response.status}`);
  }
  const body = (await response.json()) as {
    import?: { status?: MigrationImportStatus; importedProjectId?: string | null };
    receivedChunks?: Record<string, number[]>;
  };
  if (!body.import?.status) return null;
  return {
    status: body.import.status,
    importedProjectId: body.import.importedProjectId ?? null,
    receivedChunks: body.receivedChunks ?? {},
  };
}

/**
 * Resume a migration job whose SOURCE process restarted mid-run (status was
 * left at running/db_done/files_done). NEVER throws — failures land on the row.
 *
 * The destination's endpoints are all idempotent (chunk intake is sha-checked
 * and skips duplicates, finalize is claim-guarded, verify is a read), so the
 * re-drive is driven by the DESTINATION's current import state:
 *   - no record (404)  → the DB push never landed: reset to pending + restart.
 *   - failed           → destination gave up: fail the source job to match.
 *   - completed        → already done: verify + complete the source job.
 *   - in-flight        → rebuild the archives, push any missing chunks from the
 *                        destination's receivedChunks, then finalize + verify.
 */
export async function resumeJob(
  jobId: string,
  injectedDeps?: MigrationServiceDeps,
): Promise<void> {
  const deps = injectedDeps ?? defaultDeps();
  const job = await deps.getJob(jobId);
  if (!job) {
    log.warn("resumeJob: job not found", { jobId });
    return;
  }
  if (!RESUMABLE_STATUSES.includes(job.status)) {
    log.debug("resumeJob: job not in a resumable state, skipping", {
      jobId,
      status: job.status,
    });
    return;
  }

  let peer: PeerInstanceService.PeerInstanceRow | null = null;
  let built: BuiltArchives | null = null;
  const fail = async (error: unknown) => {
    log.error("Migration resume failed", { jobId, error: String(error) });
    await deps.transition(jobId, NON_TERMINAL_STATUSES, {
      status: "failed",
      errorMessage: String(error),
      completedAt: deps.now(),
    });
  };

  try {
    if (!job.peerInstanceId) throw new Error("Job has no peer instance");
    peer = await deps.getPeer(job.userId, job.peerInstanceId);
    if (!peer) throw new Error("Peer instance not found");

    const dest = await fetchDestImportState(deps, peer, jobId);

    // (a) Destination never received the DB push (404), or the DB bundle never
    // finished importing (still `staged`): restart cleanly from scratch. A
    // `staged` row would reject chunks (importDb must run first) and a fresh
    // init would 409, so roll the partial destination back to a clean slate
    // first — the source then re-POSTs the whole bundle.
    if (!dest || dest.status === "staged") {
      log.info("Resuming migration: destination has no usable import — restarting", {
        jobId,
        destStatus: dest?.status ?? "none",
      });
      if (dest) {
        try {
          await deps.peerFetch(peer, `/api/migration/imports/${jobId}`, { method: "DELETE" });
        } catch {
          // Best-effort: a leftover staged row is retried by initImport anyway.
        }
      }
      const reset = await deps.transition(jobId, RESUMABLE_STATUSES, {
        status: "pending",
        startedAt: null,
        bytesTransferred: 0,
      });
      if (!reset) return; // raced (aborted/completed concurrently)
      await startJob(jobId, deps);
      return;
    }

    // (b) Destination gave up — mirror the failure on the source row.
    if (dest.status === "failed") {
      throw new Error("Destination import is in a failed state — re-initiate the migration");
    }

    const options = jobOptions(job);

    // (c) Destination already completed the import: skip straight to verify +
    // complete (finalize would 409 — it is already finalized).
    if (dest.status === "completed") {
      log.info("Resuming migration: destination already completed — verifying", { jobId });
      await deps.transition(jobId, RESUMABLE_STATUSES, {
        status: "db_done",
        destProjectId: dest.importedProjectId,
      });
      const verify = await readPeerJson<VerifyResult>(
        await deps.peerFetch(peer, `/api/migration/imports/${jobId}/verify`, {
          method: "GET",
        }),
        "Import verify",
      );
      const report = { conflicts: [], rowCounts: verify.rowCounts, verify };
      if (!verify.ok) {
        await deps.transition(jobId, RESUMABLE_STATUSES, {
          conflictReportJson: JSON.stringify(report),
        });
        throw new Error(`Destination verification failed: ${JSON.stringify(verify.rowCounts)}`);
      }
      const completed = await deps.transition(jobId, RESUMABLE_STATUSES, {
        status: "completed",
        conflictReportJson: JSON.stringify(report),
        completedAt: deps.now(),
      });
      if (completed && job.removeSourceAfterVerify) {
        try {
          await deps.deleteProject(job.projectId);
        } catch (deleteError) {
          log.error("Source project deletion failed after resumed migration", {
            jobId,
            error: String(deleteError),
          });
        }
      }
      log.info("Migration job completed (resumed)", { jobId });
      return;
    }

    // (d) Destination is mid-flight (staged/importing/receiving/finalizing):
    // rebuild the source archives and push any chunks it is still missing, then
    // finalize + verify. Normalize the source row to db_done so the upload
    // abort-guard and the files_done/verifying transitions all match.
    //
    // buildArchives needs the working dir + profiles, which live on the DB
    // bundle — rebuild the bundle to read them (cheap relative to the file
    // transfer). The DB bundle itself is NOT re-pushed: the destination already
    // imported it (status is past `staged`), and re-POSTing would 409.
    const { bundle } = await deps.buildBundle(job.userId, job.projectId, options);
    built = await deps.buildArchives({
      jobId,
      workingDir: bundle.nodePreferences[0]?.defaultWorkingDirectory ?? null,
      options,
      profiles: bundle.profiles
        .filter((p) => !!p.sourceConfigDir)
        .map((p) => ({ id: p.id, configDir: p.sourceConfigDir as string })),
    });
    const totalBytes = built.archives.reduce((n, a) => n + a.sizeBytes, 0);

    const normalized = await deps.transition(jobId, RESUMABLE_STATUSES, {
      status: "db_done",
      destProjectId: dest.importedProjectId,
      sizeEstimateBytes: totalBytes,
      bytesTransferred: 0,
    });
    if (!normalized) return; // raced (aborted concurrently)

    if (built.archives.length > 0) {
      const total = await uploadArchiveChunks(
        deps,
        peer,
        jobId,
        built,
        dest.receivedChunks,
        0,
      );
      if (total === null) return; // aborted mid-upload (destination rolled back)
      const filesDone = await deps.transition(jobId, ["db_done"], { status: "files_done" });
      if (!filesDone) return;
    }

    await finalizeVerifyAndComplete(
      deps,
      peer,
      { ...job, destProjectId: dest.importedProjectId },
      [],
      {},
    );
  } catch (error) {
    await fail(error);
  } finally {
    if (built) {
      try {
        await deps.removeDir(built.stagingDir);
      } catch (cleanupError) {
        log.warn("Failed to remove source staging dir (resume)", {
          jobId,
          error: String(cleanupError),
        });
      }
    }
  }
}

/**
 * Startup pass: re-drive migration jobs left in-flight by a SOURCE-process
 * restart (running/db_done/files_done) instead of waiting for the 2h stale
 * prune to fail them. Only jobs younger than the stale cutoff are re-driven —
 * older ones are presumed genuinely dead (peer gone) and left to
 * {@link pruneStaleMigrations}. Each re-drive is fire-and-forget and idempotent
 * (resumeJob never throws). Returns the number of jobs scheduled for re-drive.
 */
export async function resumeInterruptedMigrations(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - STALE_JOB_MAX_AGE_MS);
  const rows = await db
    .select({ id: migrationJobs.id })
    .from(migrationJobs)
    .where(
      and(
        inArray(migrationJobs.status, RESUMABLE_STATUSES),
        // Younger than the stale cutoff — older jobs are handled by the prune.
        gte(migrationJobs.updatedAt, cutoff),
      ),
    );
  for (const row of rows) {
    // Fire-and-forget: resumeJob lands all outcomes on the row itself.
    void resumeJob(row.id);
  }
  if (rows.length > 0) {
    log.info("Re-driving interrupted migration jobs on startup", { count: rows.length });
  }
  return rows.length;
}

/**
 * Startup hygiene: mark non-terminal jobs that have not progressed in 2h as
 * failed (the runner died with them in flight). Mirrors the
 * pruneExpiredClaims pattern wired in the DI container. Returns the number
 * of jobs failed.
 */
export async function pruneStaleMigrations(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - STALE_JOB_MAX_AGE_MS);
  const updated = await db
    .update(migrationJobs)
    .set({
      status: "failed",
      errorMessage: "Marked failed by startup hygiene (no progress for 2h)",
      completedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        inArray(migrationJobs.status, NON_TERMINAL_STATUSES),
        lt(migrationJobs.updatedAt, cutoff),
      ),
    )
    .returning({ id: migrationJobs.id });
  if (updated.length > 0) {
    log.warn("Pruned stale migration jobs", { count: updated.length });
  }
  return updated.length;
}
