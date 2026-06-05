/**
 * Deploy Webhook Endpoint
 *
 * Receives GitHub webhook-style POST requests to trigger a blue-green deploy.
 * Authentication is via HMAC-SHA256 signature (not session/API key auth).
 *
 * POST /api/deploy
 * Headers:
 *   X-Hub-Signature-256: sha256=<hmac>
 *   X-GitHub-Event: push
 * Body:
 *   { ref: "refs/heads/main", after: "<commit-sha>", ... }
 *
 * ── Concurrency model (remote-dev-v7gi flock redesign) ──────────────────────
 * This route does NOT acquire the deploy mutex. The authoritative mutex is now an
 * OS `flock(2)` lock owned entirely by scripts/deploy.ts (via scripts/deploy-flock.ts,
 * a bun:ffi module that MUST NOT be imported here — Turbopack can't bundle bun:ffi).
 * The route only:
 *   1. authenticates + parses the push,
 *   2. does a BEST-EFFORT read of deploy.lock's PID and 409s if that PID is live
 *      (a cheap early reject; not load-bearing),
 *   3. spawns PROJECT_ROOT/scripts/deploy.ts detached and returns 202.
 * Two webhooks that both race past the best-effort check may both 202, but only
 * ONE deploy proceeds: deploy.ts's flock serializes them (the loser's
 * flock(LOCK_EX|LOCK_NB) fails with EWOULDBLOCK and it exits cleanly).
 *
 * The route imports ONLY the pure `parseLockContent` codec from
 * scripts/deploy-lock.ts (no fs/process/bun:ffi), so it stays bundle-safe.
 */

import { NextResponse } from "next/server";
import { existsSync, readFileSync } from "fs";
import { runtimeJoin as join } from "@/lib/dynamic-fs";
import { homedir } from "os";
import { spawn } from "child_process";
import { createLogger } from "@/lib/logger";
import { verifySignature } from "@/lib/deploy-webhook-auth";
import { parseLockContent } from "../../../../scripts/deploy-lock";

const log = createLogger("Deploy");

const DATA_DIR = process.env.RDV_DATA_DIR || join(homedir(), ".remote-dev");
const LOCK_FILE = join(DATA_DIR, "deploy", "deploy.lock");

/**
 * Best-effort: is a deploy already running? Reads deploy.lock's PID (parsing both
 * the steady-state plain-PID form and the legacy JSON form) and reports whether
 * that PID is alive. EPERM ⇒ the process EXISTS but is owned by another user →
 * alive (err toward "in progress" so we don't double-trigger). This is a cheap
 * early reject ONLY — the authoritative serialization is deploy.ts's flock, so a
 * false "free" here is harmless (the loser's flock fails and it exits cleanly).
 */
function isDeployRunning(): boolean {
  try {
    if (!existsSync(LOCK_FILE)) return false;
    const pid = parseLockContent(readFileSync(LOCK_FILE, "utf-8")).pid;
    if (pid === null) return false;
    try {
      process.kill(pid, 0);
      return true;
    } catch (err) {
      return (err as NodeJS.ErrnoException | undefined)?.code === "EPERM";
    }
  } catch {
    // Unreadable lock → don't block a deploy on a best-effort check.
    return false;
  }
}

export async function POST(request: Request) {
  // Deprecation gate: when auto-update is enabled, the webhook deploy path
  // is disabled in favor of poll-based auto-updates from GitHub Releases.
  if (process.env.AUTO_UPDATE_ENABLED === "true") {
    log.warn("Webhook deploy rejected: auto-update is enabled");
    return NextResponse.json(
      {
        error: "Webhook deploy is deprecated when auto-update is enabled. Each server polls GitHub Releases for updates.",
        code: "WEBHOOK_DEPRECATED",
      },
      { status: 410 }
    );
  }

  const webhookSecret = process.env.DEPLOY_WEBHOOK_SECRET;
  if (!webhookSecret) {
    log.error("DEPLOY_WEBHOOK_SECRET not configured");
    return NextResponse.json(
      { error: "Deploy not configured" },
      { status: 503 }
    );
  }

  // Read raw body for HMAC verification (must be before JSON parse)
  const rawBody = Buffer.from(await request.arrayBuffer());

  // Verify HMAC signature
  const signature = request.headers.get("x-hub-signature-256") ?? "";
  if (!verifySignature(webhookSecret, rawBody, signature)) {
    log.warn("Invalid webhook signature", {
      ip: request.headers.get("x-forwarded-for") ?? "unknown",
    });
    return NextResponse.json(
      { error: "Invalid signature" },
      { status: 401 }
    );
  }

  // Parse body
  let body: { ref?: string; after?: string; pusher?: { name?: string } };
  try {
    body = JSON.parse(rawBody.toString("utf-8"));
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  // Only deploy pushes to main
  const event = request.headers.get("x-github-event") ?? "push";
  if (event !== "push") {
    return NextResponse.json({ message: "Ignored non-push event" });
  }

  if (body.ref && body.ref !== "refs/heads/master") {
    return NextResponse.json({
      message: `Ignored push to ${body.ref}`,
    });
  }

  // Best-effort early reject: a live deploy is in progress. NOT authoritative —
  // deploy.ts's flock is the real mutex — so a race past this check is harmless
  // (only one deploy wins the flock; the loser exits cleanly).
  if (isDeployRunning()) {
    log.info("Deploy already in progress (best-effort PID check), rejecting");
    return NextResponse.json(
      { error: "Deploy already in progress" },
      { status: 409 }
    );
  }

  // Spawn the STABLE PROJECT_ROOT entry point detached. It owns the OS flock and
  // (under the flock) bootstraps deploy-src to origin/master and re-execs the
  // fresh origin/master orchestrator with --skip-lock + the locked fd — so the
  // orchestrator-lag window (a stale PROJECT_ROOT deploy.ts) is closed inside
  // deploy.ts itself, NOT here. The route always spawns the same stable entry.
  const projectRoot =
    process.env.DEPLOY_PROJECT_ROOT ||
    join(homedir(), "Projects", "btli", "remote-dev");
  const scriptPath = join(projectRoot, "scripts", "deploy.ts");

  log.info("Triggering deploy", {
    commit: body.after?.slice(0, 7) ?? "unknown",
    pusher: body.pusher?.name ?? "unknown",
    script: scriptPath,
  });

  // Use a clean environment for the deploy script. The Next.js server process has
  // internal __NEXT_* vars and NODE_ENV=production that interfere with
  // `next build`. Omit NODE_ENV — next build controls this internally.
  const cleanEnv: Record<string, string> = {
    HOME: process.env.HOME ?? "",
    PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
    SHELL: process.env.SHELL ?? "/bin/zsh",
    USER: process.env.USER ?? "",
    LANG: process.env.LANG ?? "en_US.UTF-8",
    TERM: process.env.TERM ?? "xterm-256color",
    DEPLOY_EXTERNAL_URL:
      process.env.DEPLOY_EXTERNAL_URL || "https://dev.bryanli.net",
    DEPLOY_WEBHOOK_SECRET: process.env.DEPLOY_WEBHOOK_SECRET ?? "",
    DEPLOY_REQUESTED_COMMIT: body.after ?? "",
    // Pin deploy.ts's notion of the LIVE serving dir explicitly (the deploy-src
    // copy's import.meta.dir would otherwise resolve PROJECT_ROOT to deploy-src).
    DEPLOY_PROJECT_ROOT: projectRoot,
  };
  // Forward the DB-targeting env so the spawned migration/backfill resolves the
  // SAME database the live server serves (remote-dev-6lf3). The DB path is chosen
  // purely from env (DATABASE_URL > RDV_DATA_DIR/sqlite.db > ~/.remote-dev/sqlite.db),
  // never cwd-relative — forward both, only when set.
  if (process.env.RDV_DATA_DIR) {
    cleanEnv.RDV_DATA_DIR = process.env.RDV_DATA_DIR;
  }
  if (process.env.DATABASE_URL) {
    cleanEnv.DATABASE_URL = process.env.DATABASE_URL;
  }

  let child: ReturnType<typeof spawn>;
  try {
    child = spawn("bun", ["run", scriptPath], {
      cwd: projectRoot,
      detached: true,
      stdio: "ignore",
      env: cleanEnv as unknown as NodeJS.ProcessEnv,
    });
  } catch (spawnErr) {
    log.error("Failed to spawn deploy script", { error: String(spawnErr) });
    return NextResponse.json(
      { error: "Failed to trigger deploy" },
      { status: 500 }
    );
  }
  child.unref();

  return NextResponse.json(
    {
      message: "Deploy triggered",
      commit: body.after?.slice(0, 7) ?? "unknown",
      pid: child.pid,
    },
    { status: 202 }
  );
}
