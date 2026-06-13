/**
 * MigrationService — SOURCE-side orchestrator for server-to-server project
 * migration (stage 1: DB rows).
 *
 * State machine: pending → running → db_done → verifying → completed, with
 * failed/aborted terminal escapes. `files_done` is reserved for the stage-2
 * file phases (tar/chunk upload), which slot in between db_done and
 * verifying.
 *
 * Every transition is a CONDITIONAL update (`WHERE status IN (…)`), so an
 * abort that lands mid-run wins the race: the runner's next transition
 * matches 0 rows and it stops quietly.
 *
 * Testability: DB ops, bundle building, peer HTTP, and project deletion are
 * injected via {@link MigrationServiceDeps} (defaulting to the real
 * implementations), mirroring agent-run-service.
 */
import { and, eq, inArray, lt } from "drizzle-orm";
import { db } from "@/db";
import { migrationJobs, projects } from "@/db/schema";
import { createLogger } from "@/lib/logger";
import { peerFetch } from "@/lib/peer-fetch";
import {
  BUNDLE_VERSION,
  type BundleManifest,
  type DbBundle,
  type ImportResult,
  type MigrationOptions,
  type VerifyResult,
} from "@/lib/migration-bundle";
import type { MigrationJobStatus } from "@/types/migration";
import * as MigrationExportService from "./migration-export-service";
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
  deleteProject(projectId: string): Promise<void>;
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
    // The existing project deletion path: kills owned tmux sessions, then
    // deletes the row (FK cascade). It does NOT touch working-tree files.
    deleteProject: (projectId) => ProjectService.delete(projectId),
    now: () => new Date(),
  };
}

/**
 * This instance's public URL, for the manifest + import provenance.
 * Informational only — falls back to "unknown".
 */
export function getSourceInstanceUrl(): string {
  return process.env.AUTH_URL || process.env.NEXTAUTH_URL || "unknown";
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
  if (!project) throw new Error("Project not found");

  const peer = await PeerInstanceService.getPeerRow(userId, input.peerInstanceId);
  if (!peer) throw new Error("Peer instance not found");

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

/** Throw a descriptive error for a non-2xx peer response. */
async function expectOk(response: Response, step: string): Promise<Response> {
  if (response.ok) return response;
  let detail = "";
  try {
    detail = (await response.text()).slice(0, 500);
  } catch {
    // Body unavailable — status alone will have to do.
  }
  throw new Error(`${step} failed: HTTP ${response.status}${detail ? ` — ${detail}` : ""}`);
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

    const manifest: BundleManifest = {
      version: BUNDLE_VERSION,
      sourceInstanceUrl: getSourceInstanceUrl(),
      sourceProjectId: job.projectId,
      sourceProjectName: bundle.project.name,
      exportedAt: deps.now().toISOString(),
      workingTreeMode: options.workingTreeMode,
      // Stage 1 ships no file chunks; stage 2 fills these in.
      totalChunks: 0,
      totalBytes: 0,
      agentSettingsIncluded: options.includeAgentSettings,
      profileIds: bundle.profiles.map((p) => p.id),
      warnings,
    };

    // ── DB phase: push the bundle (init + import happen destination-side) ──
    const importResponse = await expectOk(
      await deps.peerFetch(peer, "/api/migration/imports", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jobId,
          sourceInstanceUrl: manifest.sourceInstanceUrl,
          manifest,
          options,
          dbBundle: bundle,
        }),
      }),
      "DB bundle import",
    );
    const importBody = (await importResponse.json()) as {
      importId: string;
      status: string;
      result: ImportResult;
    };

    const dbDone = await deps.transition(jobId, ["running"], {
      status: "db_done",
      destProjectId: importBody.result?.importedProjectId ?? null,
      bundleManifestJson: JSON.stringify(manifest),
      bytesTransferred: Buffer.byteLength(JSON.stringify(bundle), "utf8"),
    });
    if (!dbDone) return; // aborted mid-flight

    // ── File phase: stage 2. The chunk upload + files_done transition will
    // slot in here; for now record that it was intentionally skipped. ──
    if (options.workingTreeMode !== "none") {
      log.info("File transfer is stage 2 — skipping working-tree upload", {
        jobId,
        workingTreeMode: options.workingTreeMode,
      });
    }

    // ── Finalize + verify on the destination ──
    await expectOk(
      await deps.peerFetch(peer, `/api/migration/imports/${jobId}/finalize`, {
        method: "POST",
      }),
      "Import finalize",
    );

    const verifying = await deps.transition(jobId, ["db_done", "files_done"], {
      status: "verifying",
    });
    if (!verifying) return; // aborted mid-flight

    const verifyResponse = await expectOk(
      await deps.peerFetch(peer, `/api/migration/imports/${jobId}/verify`, {
        method: "GET",
      }),
      "Import verify",
    );
    const verify = (await verifyResponse.json()) as VerifyResult;

    const conflictReport = {
      conflicts: importBody.result?.conflicts ?? [],
      rowCounts: importBody.result?.rowCounts ?? {},
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

    // ── Optional source removal (existing deletion path; never rm -rf) ──
    if (job.removeSourceAfterVerify) {
      log.info("Removing source project after verified migration", {
        jobId,
        projectId: job.projectId,
      });
      await deps.deleteProject(job.projectId);
    }

    await deps.transition(jobId, ["verifying"], {
      status: "completed",
      conflictReportJson: JSON.stringify(conflictReport),
      completedAt: deps.now(),
    });
    log.info("Migration job completed", {
      jobId,
      destProjectId: importBody.result?.importedProjectId,
    });
  } catch (error) {
    await fail(error, peer ?? undefined);
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
