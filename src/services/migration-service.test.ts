// @vitest-environment node
/**
 * MigrationService orchestrator tests — the source-side state machine driven
 * through injected deps (no DB, no HTTP): happy-path transition order +
 * destination call sequence, failure handling with best-effort destination
 * rollback, the abort race (conditional transition returns null → the runner
 * stops), and removeSourceAfterVerify gating.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

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
vi.mock("./peer-instance-service", () => ({ getPeerRow: vi.fn() }));
vi.mock("./project-service", () => ({ ProjectService: { delete: vi.fn() } }));

import { startJob, type MigrationJobRow, type MigrationServiceDeps } from "./migration-service";
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
  profiles: [{ id: "p1" }],
} as unknown as DbBundle;

const IMPORT_RESULT: ImportResult = {
  importedProjectId: "proj-1",
  idRemaps: {},
  conflicts: [{ type: "schedule_disabled", message: "x" }],
  rowCounts: { project: 1 },
};

const VERIFY_OK: VerifyResult = { ok: true, rowCounts: { project: 1 }, missingPaths: [] };

interface Harness {
  deps: MigrationServiceDeps;
  transitions: Array<{ expect: string[]; patch: Record<string, unknown> }>;
  peerCalls: Array<{ path: string; method: string | undefined }>;
  deleteProject: ReturnType<typeof vi.fn>;
}

function makeHarness(opts: {
  job: MigrationJobRow;
  verify?: VerifyResult;
  failTransitionAt?: string; // status whose transition should report a lost race
  peerResponses?: (path: string, init?: RequestInit) => Response;
}): Harness {
  const transitions: Harness["transitions"] = [];
  const peerCalls: Harness["peerCalls"] = [];
  const deleteProject = vi.fn(async () => {});
  let status = opts.job.status as string;

  const deps: MigrationServiceDeps = {
    getJob: async () => opts.job,
    transition: async (_id, expect, patch) => {
      transitions.push({ expect: expect as string[], patch });
      const target = patch.status ?? status;
      if (patch.status && patch.status === opts.failTransitionAt) return null;
      if (!expect.includes(status as never)) return null;
      status = target as string;
      return { ...opts.job, ...patch, status } as MigrationJobRow;
    },
    getPeer: async () =>
      ({ id: "peer-1", baseUrl: "https://dest", encryptedApiKey: "x" }) as never,
    buildBundle: async () => ({ bundle: BUNDLE, warnings: ["w1"] }),
    peerFetch: async (_peer, path, init) => {
      peerCalls.push({ path, method: init?.method });
      if (opts.peerResponses) return opts.peerResponses(path, init);
      if (path === "/api/migration/imports") {
        return Response.json(
          { importId: "job-1", status: "importing", result: IMPORT_RESULT },
          { status: 201 },
        );
      }
      if (path.endsWith("/finalize")) return Response.json({ ok: true });
      if (path.endsWith("/verify")) return Response.json(opts.verify ?? VERIFY_OK);
      return Response.json({ ok: true });
    },
    deleteProject,
    now: () => NOW,
  };
  return { deps, transitions, peerCalls, deleteProject };
}

describe("MigrationService.startJob", () => {
  beforeEach(() => vi.clearAllMocks());

  it("walks pending → running → db_done → verifying → completed with the right peer calls", async () => {
    const h = makeHarness({ job: makeJob() });
    await startJob("job-1", h.deps);

    expect(h.transitions.map((t) => t.patch.status)).toEqual([
      "running",
      "db_done",
      "verifying",
      "completed",
    ]);
    expect(h.peerCalls).toEqual([
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
    });

    const completed = h.transitions.find((t) => t.patch.status === "completed")!;
    const report = JSON.parse(completed.patch.conflictReportJson as string);
    expect(report.conflicts).toHaveLength(1);
    expect(report.verify.ok).toBe(true);
    expect(h.deleteProject).not.toHaveBeenCalled();
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
    expect(h.peerCalls.at(-1)).toEqual({
      path: "/api/migration/imports/job-1",
      method: "DELETE",
    });
    expect(h.deleteProject).not.toHaveBeenCalled();
  });

  it("fails (and keeps the report) when destination verification flags drift", async () => {
    const h = makeHarness({
      job: makeJob({ removeSourceAfterVerify: true }),
      verify: { ok: false, rowCounts: { tasks: 1 }, missingPaths: [] },
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
