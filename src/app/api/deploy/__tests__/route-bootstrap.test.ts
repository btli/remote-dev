// @vitest-environment node
//
// Tests for the deploy webhook route AFTER the flock redesign (remote-dev-v7gi).
//
// The route is now intentionally THIN: it no longer acquires any lock, bootstraps
// deploy-src, mints handoff tokens, or selects between PROJECT_ROOT and deploy-src.
// The authoritative mutex is an OS flock(2) owned entirely by scripts/deploy.ts
// (via the bun:ffi module scripts/deploy-flock.ts, which the route MUST NOT
// import — Turbopack can't bundle bun:ffi). The route only:
//   1. authenticates + parses the push,
//   2. does a BEST-EFFORT PID-liveness read of deploy.lock → 409 if a deploy is
//      live (a cheap early reject; NOT the real serialization),
//   3. spawns the STABLE PROJECT_ROOT/scripts/deploy.ts detached → 202.
//
// We mock `fs` (backing deploy.lock reads) + `child_process` (the detached spawn)
// and assert: it ALWAYS spawns the project-root entry with NO handoff env, 409s on
// a live-PID lock (both shapes), proceeds when the lock is stale/absent, and never
// transitively imports bun:ffi.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { join } from "node:path";

// In-memory FS: path → contents. Backs existsSync/readFileSync for the route's
// best-effort deploy.lock PID read.
const fsFiles = new Map<string, string>();

vi.mock("fs", () => ({
  existsSync: (p: string) => fsFiles.has(p),
  readFileSync: (p: string) => {
    const v = fsFiles.get(p);
    if (v === undefined) throw new Error(`ENOENT: ${p}`);
    return v;
  },
}));

// Scriptable behavior for the mocked child_process detached spawn.
const cp = {
  spawnThrows: false,
  spawnPid: 4242 as number | null,
  spawnCalls: [] as Array<{ bin: string; args: string[]; cwd?: string; env?: Record<string, string> }>,
};

vi.mock("child_process", () => ({
  spawn: (bin: string, args: string[], opts?: { cwd?: string; env?: Record<string, string> }) => {
    if (cp.spawnThrows) throw new Error("boom: spawn failed");
    cp.spawnCalls.push({ bin, args, cwd: opts?.cwd, env: opts?.env });
    return { pid: cp.spawnPid, unref: () => {} };
  },
}));

const DATA_DIR = "/tmp/rdv-deploy-flock-route-test";
const DEPLOY_PROJECT_ROOT = "/srv/live-tree";
const PROJECT_ROOT_SCRIPT = join(DEPLOY_PROJECT_ROOT, "scripts", "deploy.ts");
const DEPLOY_LOCK_FILE = join(DATA_DIR, "deploy", "deploy.lock");

const SECRET = "test-deploy-secret";
const COMMIT = "a".repeat(40);

const ORIG = {
  secret: process.env.DEPLOY_WEBHOOK_SECRET,
  dataDir: process.env.RDV_DATA_DIR,
  projectRoot: process.env.DEPLOY_PROJECT_ROOT,
  autoUpdate: process.env.AUTO_UPDATE_ENABLED,
};

function sign(body: string, secret = SECRET): string {
  return "sha256=" + createHmac("sha256", secret).update(Buffer.from(body)).digest("hex");
}

function pushRequest(after: string, ref = "refs/heads/master"): Request {
  const body = JSON.stringify({ ref, after, pusher: { name: "tester" } });
  const headers = new Headers();
  headers.set("x-hub-signature-256", sign(body));
  headers.set("x-github-event", "push");
  return new Request("http://localhost/api/deploy", { method: "POST", body, headers });
}

async function loadRoute() {
  vi.resetModules();
  return import("../route");
}

describe("POST /api/deploy — flock-redesign thin webhook", () => {
  beforeEach(() => {
    fsFiles.clear();
    cp.spawnThrows = false;
    cp.spawnPid = 4242;
    cp.spawnCalls = [];
    process.env.DEPLOY_WEBHOOK_SECRET = SECRET;
    process.env.RDV_DATA_DIR = DATA_DIR;
    process.env.DEPLOY_PROJECT_ROOT = DEPLOY_PROJECT_ROOT;
    delete process.env.AUTO_UPDATE_ENABLED;
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(ORIG)) {
      const key =
        k === "secret" ? "DEPLOY_WEBHOOK_SECRET"
          : k === "dataDir" ? "RDV_DATA_DIR"
            : k === "projectRoot" ? "DEPLOY_PROJECT_ROOT"
              : "AUTO_UPDATE_ENABLED";
      if (v === undefined) delete process.env[key];
      else process.env[key] = v;
    }
  });

  it("HAPPY PATH: no lock present → spawns the STABLE PROJECT_ROOT entry detached, 202, NO handoff env", async () => {
    const { POST } = await loadRoute();
    const res = await POST(pushRequest(COMMIT));
    expect(res.status).toBe(202);
    expect(cp.spawnCalls).toHaveLength(1);
    // Always the project-root stable entry — NEVER a deploy-src copy (the route no
    // longer selects; deploy.ts re-execs the fresh orchestrator under the flock).
    expect(cp.spawnCalls[0].bin).toBe("bun");
    expect(cp.spawnCalls[0].args).toEqual(["run", PROJECT_ROOT_SCRIPT]);
    expect(cp.spawnCalls[0].cwd).toBe(DEPLOY_PROJECT_ROOT);
    // The route does not hand off a lock (no flock token / handoff env at all).
    expect(cp.spawnCalls[0].env?.DEPLOY_LOCK_HANDOFF).toBeUndefined();
    expect(cp.spawnCalls[0].env?.DEPLOY_LOCK_FD).toBeUndefined();
    // It DOES forward the live-dir + commit + DB env for the deploy.
    expect(cp.spawnCalls[0].env?.DEPLOY_PROJECT_ROOT).toBe(DEPLOY_PROJECT_ROOT);
    expect(cp.spawnCalls[0].env?.DEPLOY_REQUESTED_COMMIT).toBe(COMMIT);
    expect(cp.spawnCalls[0].env?.RDV_DATA_DIR).toBe(DATA_DIR);
  });

  it("BEST-EFFORT 409: a deploy.lock naming a LIVE pid (plain form) → 409, no spawn", async () => {
    fsFiles.set(DEPLOY_LOCK_FILE, String(process.pid)); // our own pid → alive
    const { POST } = await loadRoute();
    const res = await POST(pushRequest(COMMIT));
    expect(res.status).toBe(409);
    expect(cp.spawnCalls).toHaveLength(0);
  });

  it("BEST-EFFORT 409: a deploy.lock naming a LIVE pid (legacy JSON form) → 409, no spawn", async () => {
    fsFiles.set(DEPLOY_LOCK_FILE, JSON.stringify({ pid: process.pid, token: "in-flight" }));
    const { POST } = await loadRoute();
    const res = await POST(pushRequest(COMMIT));
    expect(res.status).toBe(409);
    expect(cp.spawnCalls).toHaveLength(0);
  });

  it("STALE lock (DEAD pid) → NOT a 409; the deploy proceeds (flock will serialize for real)", async () => {
    // process.kill(deadPid, 0) rejects with ESRCH → not alive → proceed. The OS
    // flock in deploy.ts is the real mutex, so a stale PID file never blocks.
    fsFiles.set(DEPLOY_LOCK_FILE, "2147480000");
    const { POST } = await loadRoute();
    const res = await POST(pushRequest(COMMIT));
    expect(res.status).toBe(202);
    expect(cp.spawnCalls).toHaveLength(1);
    expect(cp.spawnCalls[0].args).toEqual(["run", PROJECT_ROOT_SCRIPT]);
  });

  it("a MALFORMED lock is not treated as a live deploy → proceeds (202)", async () => {
    fsFiles.set(DEPLOY_LOCK_FILE, "garbage-not-a-pid");
    const { POST } = await loadRoute();
    const res = await POST(pushRequest(COMMIT));
    expect(res.status).toBe(202);
    expect(cp.spawnCalls).toHaveLength(1);
  });

  it("SPAWN FAILS → 500, no stranded state (route holds no lock to leak)", async () => {
    cp.spawnThrows = true;
    const { POST } = await loadRoute();
    const res = await POST(pushRequest(COMMIT));
    expect(res.status).toBe(500);
    expect(cp.spawnCalls).toHaveLength(0);
  });

  // ── Auth / routing gates (unchanged) ────────────────────────────────────────
  it("a non-master push is ignored (no spawn)", async () => {
    const { POST } = await loadRoute();
    const res = await POST(pushRequest(COMMIT, "refs/heads/feature"));
    const json = await res.json();
    expect(json.message).toMatch(/Ignored push/);
    expect(cp.spawnCalls).toHaveLength(0);
  });

  it("an invalid signature is rejected (401, no spawn)", async () => {
    const body = JSON.stringify({ ref: "refs/heads/master", after: COMMIT });
    const headers = new Headers();
    headers.set("x-hub-signature-256", "sha256=" + "0".repeat(64));
    headers.set("x-github-event", "push");
    const { POST } = await loadRoute();
    const res = await POST(new Request("http://localhost/api/deploy", { method: "POST", body, headers }));
    expect(res.status).toBe(401);
    expect(cp.spawnCalls).toHaveLength(0);
  });

  it("auto-update enabled → 410, no spawn", async () => {
    process.env.AUTO_UPDATE_ENABLED = "true";
    const { POST } = await loadRoute();
    const res = await POST(pushRequest(COMMIT));
    expect(res.status).toBe(410);
    expect(cp.spawnCalls).toHaveLength(0);
  });

  // ── The route must NOT transitively import the bun:ffi flock module ──────────
  it("route.ts does NOT import scripts/deploy-flock.ts (bun:ffi) — kept out of the Next bundle", async () => {
    // `fs` is mocked above, so read the route source via the REAL node:fs.
    const realFs = await vi.importActual<typeof import("node:fs")>("node:fs");
    const src = realFs.readFileSync(join(__dirname, "..", "route.ts"), "utf-8");
    // Assert on actual IMPORT statements, not mere mentions in comments (the
    // header comment legitimately explains WHY deploy-flock/bun:ffi are excluded).
    const importLines = src
      .split("\n")
      .filter((l) => /^\s*import\b/.test(l) || /\bfrom\s+["']/.test(l));
    expect(importLines.some((l) => l.includes("deploy-flock"))).toBe(false);
    expect(importLines.some((l) => l.includes("bun:ffi"))).toBe(false);
    // It imports ONLY the pure codec from deploy-lock (parseLockContent).
    expect(src).toMatch(/from "\.\.\/\.\.\/\.\.\/\.\.\/scripts\/deploy-lock"/);
  });
});
