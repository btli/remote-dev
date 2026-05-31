// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { join } from "node:path";

// The status route reads its data files synchronously via fs.existsSync /
// fs.readFileSync. Mirror readyz's mocking style: mock `fs` before importing
// the route, back it with an in-memory file map, and use vi.resetModules() +
// dynamic import() so each test gets a fresh module that closes over the
// current mock state. We key the in-memory FS by absolute path; the route
// builds its paths from RDV_DATA_DIR (set per-test below).
const fsFiles = new Map<string, string>();

vi.mock("fs", () => ({
  existsSync: (p: string) => fsFiles.has(p),
  readFileSync: (p: string) => {
    const v = fsFiles.get(p);
    if (v === undefined) throw new Error(`ENOENT: ${p}`);
    return v;
  },
}));

const DATA_DIR = "/tmp/rdv-deploy-status-test";
const RESULT_FILE = join(DATA_DIR, "deploy", "last-deploy.json");
const STATE_FILE = join(DATA_DIR, "deploy", "state.json");
const LOCK_FILE = join(DATA_DIR, "deploy", "deploy.lock");

const SECRET = "test-deploy-secret";
const COMMIT = "a".repeat(40);

const ORIGINAL_SECRET = process.env.DEPLOY_WEBHOOK_SECRET;
const ORIGINAL_DATA_DIR = process.env.RDV_DATA_DIR;

/** Compute the valid HMAC-SHA256 signature header over the commit string. */
function sign(commit: string, secret = SECRET): string {
  return "sha256=" + createHmac("sha256", secret).update(Buffer.from(commit)).digest("hex");
}

function makeRequest(commit: string | null, signature?: string): Request {
  const url = commit === null
    ? "http://localhost/api/deploy/status"
    : `http://localhost/api/deploy/status?commit=${commit}`;
  const headers = new Headers();
  if (signature !== undefined) headers.set("x-hub-signature-256", signature);
  return new Request(url, { method: "GET", headers });
}

/** Import a fresh copy of the route after env + fs mock are configured. */
async function loadRoute() {
  vi.resetModules();
  return import("../route");
}

beforeEach(() => {
  fsFiles.clear();
  process.env.DEPLOY_WEBHOOK_SECRET = SECRET;
  process.env.RDV_DATA_DIR = DATA_DIR;
});

afterEach(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.DEPLOY_WEBHOOK_SECRET;
  else process.env.DEPLOY_WEBHOOK_SECRET = ORIGINAL_SECRET;
  if (ORIGINAL_DATA_DIR === undefined) delete process.env.RDV_DATA_DIR;
  else process.env.RDV_DATA_DIR = ORIGINAL_DATA_DIR;
});

describe("GET /api/deploy/status", () => {
  it("returns 503 when DEPLOY_WEBHOOK_SECRET is not configured", async () => {
    delete process.env.DEPLOY_WEBHOOK_SECRET;
    const { GET } = await loadRoute();

    const response = await GET(makeRequest(COMMIT, sign(COMMIT)));
    expect(response.status).toBe(503);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain("not configured");
  });

  it("returns 400 when the commit query param is missing", async () => {
    const { GET } = await loadRoute();

    const response = await GET(makeRequest(null, sign("")));
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain("Missing commit");
  });

  it("returns 401 on an invalid signature", async () => {
    const { GET } = await loadRoute();

    const response = await GET(makeRequest(COMMIT, "sha256=deadbeef"));
    expect(response.status).toBe(401);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain("Invalid signature");
  });

  it("returns the matching attempt record verbatim plus lockHeld", async () => {
    fsFiles.set(
      RESULT_FILE,
      JSON.stringify({
        status: "failed",
        requestedCommit: COMMIT,
        activeCommit: "b".repeat(40),
        stage: "build",
        error: "Build failed",
        startedAt: "2026-01-01T00:00:00.000Z",
        finishedAt: "2026-01-01T00:05:00.000Z",
      }),
    );
    // lockHeld now means "lock held by a LIVE pid" (isDeployLockAlive does
    // process.kill(pid, 0)); use the test process's own pid so it registers
    // as held rather than a dead/stale pid.
    fsFiles.set(LOCK_FILE, String(process.pid));
    const { GET } = await loadRoute();

    const response = await GET(makeRequest(COMMIT, sign(COMMIT)));
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      status: string;
      requestedCommit: string;
      activeCommit: string;
      stage: string;
      error: string;
      lockHeld: boolean;
      source?: string;
    };
    expect(body.status).toBe("failed");
    expect(body.requestedCommit).toBe(COMMIT);
    expect(body.activeCommit).toBe("b".repeat(40));
    expect(body.stage).toBe("build");
    expect(body.error).toBe("Build failed");
    expect(body.lockHeld).toBe(true);
    // A verbatim attempt record carries no `source` marker.
    expect(body.source).toBeUndefined();
  });

  it("falls back to state.json when the live commit matches and there is no attempt record", async () => {
    // No last-deploy.json; state.json says this commit is live → genuine success.
    fsFiles.set(
      STATE_FILE,
      JSON.stringify({ activeCommit: COMMIT, deployedAt: "2026-02-02T00:00:00.000Z" }),
    );
    const { GET } = await loadRoute();

    const response = await GET(makeRequest(COMMIT, sign(COMMIT)));
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      status: string;
      activeCommit: string;
      stage: string;
      source: string;
      lockHeld: boolean;
    };
    expect(body.status).toBe("success");
    expect(body.activeCommit).toBe(COMMIT);
    expect(body.stage).toBe("done");
    expect(body.source).toBe("state-fallback");
    expect(body.lockHeld).toBe(false);
  });

  it("falls back to state.json when the attempt record is for a different commit", async () => {
    // A stale record for a prior commit must not satisfy the requested one;
    // the live-commit fallback should kick in instead.
    fsFiles.set(
      RESULT_FILE,
      JSON.stringify({
        status: "failed",
        requestedCommit: "c".repeat(40),
        activeCommit: COMMIT,
        stage: "build",
        error: "Build failed",
        startedAt: "2026-02-02T00:00:00.000Z",
      }),
    );
    fsFiles.set(
      STATE_FILE,
      JSON.stringify({ activeCommit: COMMIT, deployedAt: "2026-02-02T00:00:00.000Z" }),
    );
    const { GET } = await loadRoute();

    const response = await GET(makeRequest(COMMIT, sign(COMMIT)));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { status: string; source: string };
    expect(body.status).toBe("success");
    expect(body.source).toBe("state-fallback");
  });

  it("does NOT short-circuit to success when the live commit matches but a deploy is in flight", async () => {
    // Re-deploy of an already-live SHA whose in_progress record write was lost:
    // state.json says this commit is live, but a deploy lock is held by a LIVE
    // pid. Using the test process's own pid guarantees process.kill(pid, 0)
    // succeeds, so the state-fallback guard must report in_progress, not success.
    fsFiles.set(
      STATE_FILE,
      JSON.stringify({ activeCommit: COMMIT, deployedAt: "2026-04-04T00:00:00.000Z" }),
    );
    fsFiles.set(LOCK_FILE, String(process.pid));
    const { GET } = await loadRoute();

    const response = await GET(makeRequest(COMMIT, sign(COMMIT)));
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      status: string;
      source: string;
      lockHeld: boolean;
    };
    expect(body.status).toBe("in_progress");
    expect(body.lockHeld).toBe(true);
    expect(body.source).toBe("no-record");
  });

  it("reports in_progress when there is no record and the live commit does not match", async () => {
    fsFiles.set(
      STATE_FILE,
      JSON.stringify({ activeCommit: "d".repeat(40), deployedAt: "2026-03-03T00:00:00.000Z" }),
    );
    const { GET } = await loadRoute();

    const response = await GET(makeRequest(COMMIT, sign(COMMIT)));
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      status: string;
      requestedCommit: string;
      activeCommit: string | null;
      source: string;
    };
    expect(body.status).toBe("in_progress");
    expect(body.requestedCommit).toBe(COMMIT);
    expect(body.activeCommit).toBe("d".repeat(40));
    expect(body.source).toBe("no-record");
  });
});
