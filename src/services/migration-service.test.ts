// @vitest-environment node
/**
 * MigrationService orchestrator tests — the source-side state machine driven
 * through injected deps (no DB, no HTTP, no disk): happy-path transition
 * order + destination call sequence, the stage-2 chunk upload (headers,
 * resume skip, per-chunk retry, abort-between-chunks), failure handling with
 * best-effort destination rollback, and removeSourceAfterVerify gating.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "node:crypto";

vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/db/schema", () => ({ migrationJobs: {}, projects: {} }));
vi.mock("@/lib/logger", () => ({
  createLogger: () => ({
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
  }),
}));
vi.mock("@/lib/peer-fetch", () => ({ peerFetch: vi.fn() }));
vi.mock("./migration-export-service", () => ({ buildDbBundle: vi.fn() }));
vi.mock("./migration-file-service", () => ({
  buildArchives: vi.fn(),
  readArchiveChunk: vi.fn(),
}));
vi.mock("./peer-instance-service", () => ({ getPeerRow: vi.fn() }));
vi.mock("./project-service", () => ({ ProjectService: { delete: vi.fn() } }));

import { startJob, type MigrationJobRow, type MigrationServiceDeps } from "./migration-service";
import type { BuiltArchives } from "./migration-file-service";
import type { DbBundle, ImportResult, VerifyResult } from "@/lib/migration-bundle";

const NOW = new Date(1750000000000);

function makeJob(overrides: Partial<MigrationJobRow> = {}): MigrationJobRow {
  return {
    id: "job-1",
    userId: "user-1",
    projectId: "proj-1",
    peerInstanceId: "peer-1",
    status: "pending",
    workingTreeMode: "full_tar",
    includeDotEnv: true,
    includeAgentCreds: true,
    includeSshKeys: false,
    includeAgentSettings: true,
    includeChannelHistory: false,
    removeSourceAfterVerify: false,
    sizeEstimateBytes: null,
    bytesTransferred: 0,
    destProjectId: null,
    bundleManifestJson: null,
    conflictReportJson: null,
    errorMessage: null,
    startedAt: null,
    completedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  } as MigrationJobRow;
}

const BUNDLE = {
  version: 1,
  project: { name: "My App" },
  nodePreferences: [{ defaultWorkingDirectory: "/Users/src/dev/myapp" }],
  profiles: [{ id: "p1", sourceConfigDir: "/src/profiles/p1" }],
} as unknown as DbBundle;

const IMPORT_RESULT: ImportResult = {
  importedProjectId: "proj-1",
  idRemaps: {},
  conflicts: [{ type: "schedule_disabled", message: "x" }],
  rowCounts: { project: 1 },
};

const VERIFY_OK: VerifyResult = { ok: true, rowCounts: { project: 1 }, missingPaths: [] };

const NO_ARCHIVES: BuiltArchives = {
  stagingDir: "/tmp/export-job-1",
  archives: [],
  archivePaths: {},
  gitRemoteUrl: null,
  gitBranch: null,
  beadsIncluded: false,
  info: [],
  warnings: [],
};

/** Two chunks: 100 bytes (sizeBytes makes the 2nd chunk the remainder). */
const TWO_CHUNK_ARCHIVES: BuiltArchives = {
  stagingDir: "/tmp/export-job-1",
  archives: [
    {
      name: "working-tree",
      sizeBytes: 64 * 1024 * 1024 + 100,
      sha256: "a".repeat(64),
      chunkCount: 2,
    },
  ],
  archivePaths: { "working-tree": "/tmp/export-job-1/working-tree.tar.gz" },
  gitRemoteUrl: null,
  gitBranch: null,
  beadsIncluded: true,
  info: ["agent-settings: claude/settings.json"],
  warnings: ["w-arch"],
};

interface PeerCall {
  path: string;
  method: string | undefined;
  headers?: Record<string, string>;
}

interface Harness {
  deps: MigrationServiceDeps;
  transitions: Array<{ expect: string[]; patch: Record<string, unknown> }>;
  peerCalls: PeerCall[];
  deleteProject: ReturnType<typeof vi.fn>;
  removeDir: ReturnType<typeof vi.fn>;
}

function makeHarness(opts: {
  job: MigrationJobRow;
  verify?: VerifyResult;
  built?: BuiltArchives;
  receivedChunks?: Record<string, number[]>;
  failTransitionAt?: string; // status whose transition should report a lost race
  failProgressAfter?: number; // Nth status-less progress update returns null
  peerResponses?: (path: string, init?: RequestInit) => Response;
}): Harness {
  const transitions: Harness["transitions"] = [];
  const peerCalls: PeerCall[] = [];
  const deleteProject = vi.fn(async () => {});
  const removeDir = vi.fn(async () => {});
  let status = opts.job.status as string;
  let progressUpdates = 0;

  const deps: MigrationServiceDeps = {
    getJob: async () => opts.job,
    transition: async (_id, expect, patch) => {
      transitions.push({ expect: expect as string[], patch });
      if (!patch.status) {
        progressUpdates++;
        if (opts.failProgressAfter && progressUpdates >= opts.failProgressAfter) {
          return null;
        }
        if (!expect.includes(status as never)) return null;
        return { ...opts.job, ...patch, status } as MigrationJobRow;
      }
      if (patch.status === opts.failTransitionAt) return null;
      if (!expect.includes(status as never)) return null;
      status = patch.status as string;
      return { ...opts.job, ...patch, status } as MigrationJobRow;
    },
    getPeer: async () =>
      ({ id: "peer-1", baseUrl: "https://dest", encryptedApiKey: "x" }) as never,
    buildBundle: async () => ({ bundle: BUNDLE, warnings: ["w1"] }),
    buildArchives: async () => opts.built ?? NO_ARCHIVES,
    readChunk: async (_path, index) => Buffer.from(`chunk-${index}-data`),
    removeDir,
    peerFetch: async (_peer, path, init) => {
      const headers = Object.fromEntries(
        new Headers(init?.headers).entries(),
      ) as Record<string, string>;
      peerCalls.push({ path, method: init?.method, headers });
      if (opts.peerResponses) return opts.peerResponses(path, init);
      if (path === "/api/migration/imports" && init?.method === "POST") {
        return Response.json(
          { importId: "job-1", status: "importing", result: IMPORT_RESULT },
          { status: 201 },
        );
      }
      if (path === "/api/migration/imports/job-1" && init?.method === "GET") {
        return Response.json({
          import: { id: "job-1" },
          receivedChunks: opts.receivedChunks ?? {},
        });
      }
      if (path.endsWith("/chunks")) return Response.json({ ok: true });
      if (path.endsWith("/finalize")) {
        return Response.json({ ok: true, conflicts: [{ type: "file_overwritten", message: "y" }] });
      }
      if (path.endsWith("/verify")) return Response.json(opts.verify ?? VERIFY_OK);
      return Response.json({ ok: true });
    },
    deleteProject,
    now: () => NOW,
  };
  return { deps, transitions, peerCalls, deleteProject, removeDir };
}

describe("MigrationService.startJob", () => {
  beforeEach(() => vi.clearAllMocks());

  it("walks pending → running → db_done → verifying → completed with the right peer calls (DB-only)", async () => {
    const h = makeHarness({ job: makeJob() });
    await startJob("job-1", h.deps);

    expect(h.transitions.map((t) => t.patch.status)).toEqual([
      "running",
      "db_done",
      "verifying",
      "completed",
    ]);
    expect(h.peerCalls.map((c) => ({ path: c.path, method: c.method }))).toEqual([
      { path: "/api/migration/imports", method: "POST" },
      { path: "/api/migration/imports/job-1/finalize", method: "POST" },
      { path: "/api/migration/imports/job-1/verify", method: "GET" },
    ]);

    const dbDone = h.transitions.find((t) => t.patch.status === "db_done")!;
    expect(dbDone.patch.destProjectId).toBe("proj-1");
    expect(typeof dbDone.patch.bundleManifestJson).toBe("string");
    const manifest = JSON.parse(dbDone.patch.bundleManifestJson as string);
    expect(manifest).toMatchObject({
      version: 1,
      sourceProjectId: "proj-1",
      sourceProjectName: "My App",
      totalChunks: 0,
      warnings: ["w1"],
      profileIds: ["p1"],
      archives: [],
    });

    const completed = h.transitions.find((t) => t.patch.status === "completed")!;
    const report = JSON.parse(completed.patch.conflictReportJson as string);
    // Import conflicts + finalize conflicts both land in the report.
    expect(report.conflicts.map((c: { type: string }) => c.type)).toEqual([
      "schedule_disabled",
      "file_overwritten",
    ]);
    expect(report.verify.ok).toBe(true);
    expect(h.deleteProject).not.toHaveBeenCalled();
    // Source staging is always reclaimed.
    expect(h.removeDir).toHaveBeenCalledWith("/tmp/export-job-1");
  });

  it("uploads archive chunks with addressed headers, then files_done → completed", async () => {
    const h = makeHarness({ job: makeJob(), built: TWO_CHUNK_ARCHIVES });
    await startJob("job-1", h.deps);

    const puts = h.peerCalls.filter((c) => c.method === "PUT");
    expect(puts).toHaveLength(2);
    expect(puts[0].path).toBe("/api/migration/imports/job-1/chunks");
    expect(puts[0].headers).toMatchObject({
      "x-archive-name": "working-tree",
      "x-chunk-index": "0",
      "x-total-chunks": "2",
      "x-chunk-sha256": createHash("sha256").update("chunk-0-data").digest("hex"),
    });
    expect(puts[1].headers?.["x-chunk-index"]).toBe("1");

    // GET resume probe happened before the first PUT.
    const methods = h.peerCalls.map((c) => `${c.method} ${c.path}`);
    expect(methods.indexOf("GET /api/migration/imports/job-1")).toBeLessThan(
      methods.indexOf("PUT /api/migration/imports/job-1/chunks"),
    );

    expect(h.transitions.map((t) => t.patch.status).filter(Boolean)).toEqual([
      "running",
      "db_done",
      "files_done",
      "verifying",
      "completed",
    ]);
    // The db_done patch carried the size estimate from the built archives.
    const dbDone = h.transitions.find((t) => t.patch.status === "db_done")!;
    expect(dbDone.patch.sizeEstimateBytes).toBe(TWO_CHUNK_ARCHIVES.archives[0].sizeBytes);
    // Manifest declares the archives + git/beads metadata.
    const manifest = JSON.parse(dbDone.patch.bundleManifestJson as string);
    expect(manifest.archives).toHaveLength(1);
    expect(manifest.totalChunks).toBe(2);
    expect(manifest.beadsIncluded).toBe(true);
    expect(manifest.warnings).toEqual(["w1", "w-arch"]);
  });

  it("skips chunks the destination already holds (resume)", async () => {
    const h = makeHarness({
      job: makeJob(),
      built: TWO_CHUNK_ARCHIVES,
      receivedChunks: { "working-tree": [0] },
    });
    await startJob("job-1", h.deps);

    const puts = h.peerCalls.filter((c) => c.method === "PUT");
    expect(puts).toHaveLength(1);
    expect(puts[0].headers?.["x-chunk-index"]).toBe("1");
    expect(h.transitions.at(-1)?.patch.status).toBe("completed");
  });

  it("stops between chunks and rolls back the destination when an abort lands mid-upload", async () => {
    const h = makeHarness({
      job: makeJob(),
      built: TWO_CHUNK_ARCHIVES,
      failProgressAfter: 1, // the progress update after the FIRST chunk loses
    });
    await startJob("job-1", h.deps);

    const puts = h.peerCalls.filter((c) => c.method === "PUT");
    expect(puts).toHaveLength(1); // never reached chunk 1
    expect(h.peerCalls.at(-1)).toMatchObject({
      path: "/api/migration/imports/job-1",
      method: "DELETE",
    });
    // No files_done / finalize / verify after the abort.
    expect(h.transitions.map((t) => t.patch.status).filter(Boolean)).toEqual([
      "running",
      "db_done",
    ]);
    expect(h.removeDir).toHaveBeenCalled();
  });

  it("retries a failing chunk 3 times, then fails the job with destination rollback", async () => {
    const h = makeHarness({
      job: makeJob(),
      built: TWO_CHUNK_ARCHIVES,
      peerResponses: (path, init) => {
        if (path === "/api/migration/imports" && init?.method === "POST") {
          return Response.json(
            { importId: "job-1", status: "importing", result: IMPORT_RESULT },
            { status: 201 },
          );
        }
        if (init?.method === "PUT") return new Response("boom", { status: 500 });
        return Response.json({ import: { id: "job-1" }, receivedChunks: {} });
      },
    });
    await startJob("job-1", h.deps);

    expect(h.peerCalls.filter((c) => c.method === "PUT")).toHaveLength(3);
    const last = h.transitions.at(-1)!;
    expect(last.patch.status).toBe("failed");
    expect(String(last.patch.errorMessage)).toContain("HTTP 500");
    expect(h.peerCalls.at(-1)).toMatchObject({
      path: "/api/migration/imports/job-1",
      method: "DELETE",
    });
    expect(h.removeDir).toHaveBeenCalled();
  });

  it("deletes the source project only with removeSourceAfterVerify + clean verify", async () => {
    const h = makeHarness({ job: makeJob({ removeSourceAfterVerify: true }) });
    await startJob("job-1", h.deps);
    expect(h.deleteProject).toHaveBeenCalledWith("proj-1");
    expect(h.transitions.at(-1)?.patch.status).toBe("completed");
  });

  it("fails the job and rolls back the destination when the import POST errors", async () => {
    const h = makeHarness({
      job: makeJob(),
      peerResponses: (path) =>
        path === "/api/migration/imports"
          ? new Response("boom", { status: 422 })
          : Response.json({ ok: true }),
    });
    await startJob("job-1", h.deps); // must not throw

    const last = h.transitions.at(-1)!;
    expect(last.patch.status).toBe("failed");
    expect(String(last.patch.errorMessage)).toContain("422");
    // Best-effort destination rollback.
    expect(h.peerCalls.at(-1)).toEqual(
      expect.objectContaining({
        path: "/api/migration/imports/job-1",
        method: "DELETE",
      }),
    );
    expect(h.deleteProject).not.toHaveBeenCalled();
  });

  it("fails (and keeps the report) when destination verification flags drift", async () => {
    const h = makeHarness({
      job: makeJob({ removeSourceAfterVerify: true }),
      verify: { ok: false, rowCounts: { tasks: 1 }, missingPaths: ["/x"] },
    });
    await startJob("job-1", h.deps);

    const reportSave = h.transitions.find(
      (t) => !t.patch.status && t.patch.conflictReportJson,
    );
    expect(reportSave).toBeDefined();
    expect(h.transitions.at(-1)?.patch.status).toBe("failed");
    // NEVER deletes the source on a dirty verify.
    expect(h.deleteProject).not.toHaveBeenCalled();
  });

  it("stops quietly when an abort wins the running→db_done race", async () => {
    const h = makeHarness({ job: makeJob(), failTransitionAt: "db_done" });
    await startJob("job-1", h.deps);

    // The runner pushed the bundle, lost the db_done transition, and stopped:
    // no finalize/verify calls, no failed/completed transition afterwards.
    expect(h.peerCalls.map((c) => c.path)).toEqual(["/api/migration/imports"]);
    expect(h.transitions.map((t) => t.patch.status)).toEqual(["running", "db_done"]);
  });

  it("does nothing when the job is not pending", async () => {
    const h = makeHarness({ job: makeJob({ status: "completed" }) });
    await startJob("job-1", h.deps);
    expect(h.peerCalls).toEqual([]);
    // Only the (refused) running transition was attempted.
    expect(h.transitions.map((t) => t.patch.status)).toEqual(["running"]);
  });
});
