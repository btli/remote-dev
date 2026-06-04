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
 */

import { NextResponse } from "next/server";
import { existsSync, readFileSync } from "fs";
import { runtimeJoin as join } from "@/lib/dynamic-fs";
import { homedir } from "os";
import { spawn } from "child_process";
import { createLogger } from "@/lib/logger";
import { verifySignature } from "@/lib/deploy-webhook-auth";

const log = createLogger("Deploy");

const DATA_DIR = process.env.RDV_DATA_DIR || join(homedir(), ".remote-dev");
const LOCK_FILE = join(DATA_DIR, "deploy", "deploy.lock");

function isLockHeld(): boolean {
  if (!existsSync(LOCK_FILE)) return false;
  try {
    const lockPid = parseInt(readFileSync(LOCK_FILE, "utf-8").trim());
    if (isNaN(lockPid)) return false;
    process.kill(lockPid, 0);
    return true; // Process is alive
  } catch {
    return false; // Process dead or can't read file
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

  // Check for concurrent deploy
  if (isLockHeld()) {
    log.info("Deploy already in progress, rejecting");
    return NextResponse.json(
      { error: "Deploy already in progress" },
      { status: 409 }
    );
  }

  // Spawn deploy script as detached background process.
  //
  // ORCHESTRATOR-LAG FIX (remote-dev-6lf3). PROJECT_ROOT is the live dev/agent
  // working tree and is intentionally NEVER synced to origin/master, so its
  // scripts/deploy.ts can lag master by arbitrary commits. The #338 deploy
  // created the user_email table (db:push ran from the origin/master deploy-src)
  // but never ran the backfill, because PROJECT_ROOT's deploy.ts predated the
  // backfill wiring — the step didn't exist in the orchestrator that executed.
  //
  // Prefer the ORIGIN/MASTER copy of deploy.ts from the deploy-src worktree
  // (DATA_DIR/deploy-src), which a prior deploy already pinned to origin/master.
  // That makes the orchestration logic itself track master, not the stale dev
  // tree. Chicken-and-egg: deploy-src is created BY deploy.ts, so on the very
  // first deploy (or right after deploy-src is wiped) it won't exist yet — fall
  // back to PROJECT_ROOT's copy, which will (re)materialize deploy-src so the
  // NEXT deploy uses the fresh origin/master orchestrator. The post-condition
  // guard (db:verify-backfills) is the belt-and-suspenders backstop for the
  // window where the fallback orchestrator is itself stale.
  const projectRoot =
    process.env.DEPLOY_PROJECT_ROOT ||
    join(homedir(), "Projects", "btli", "remote-dev");
  const projectRootScript = join(projectRoot, "scripts", "deploy.ts");
  const deploySrcScript = join(DATA_DIR, "deploy-src", "scripts", "deploy.ts");

  const useDeploySrc = existsSync(deploySrcScript);
  const scriptPath = useDeploySrc ? deploySrcScript : projectRootScript;
  // The script reads PROJECT_ROOT via import.meta.dir ("<scriptDir>/.."), so when
  // running the deploy-src copy, cwd is its own worktree root; PROJECT_ROOT (the
  // live serving dir restored by restoreSlotToLive) is resolved by deploy.ts from
  // DEPLOY_PROJECT_ROOT below, not from cwd.
  const scriptCwd = useDeploySrc
    ? join(DATA_DIR, "deploy-src")
    : projectRoot;

  log.info("Triggering deploy", {
    commit: body.after?.slice(0, 7) ?? "unknown",
    pusher: body.pusher?.name ?? "unknown",
    script: scriptPath,
    orchestratorSource: useDeploySrc ? "deploy-src (origin/master)" : "project-root (fallback)",
  });

  try {
    // Use a clean environment for the deploy script. The Next.js server
    // process has internal __NEXT_* vars and NODE_ENV=production that
    // interfere with `next build` (causes "generate is not a function").
    // Omit NODE_ENV — next build controls this internally.
    // Pre-setting it to "development" or "production" breaks the build.
    const cleanEnv: Record<string, string> = {
      HOME: process.env.HOME ?? "",
      PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
      SHELL: process.env.SHELL ?? "/bin/zsh",
      USER: process.env.USER ?? "",
      LANG: process.env.LANG ?? "en_US.UTF-8",
      TERM: process.env.TERM ?? "xterm-256color",
      // App-specific
      DEPLOY_EXTERNAL_URL:
        process.env.DEPLOY_EXTERNAL_URL || "https://dev.bryanli.net",
      DEPLOY_WEBHOOK_SECRET: process.env.DEPLOY_WEBHOOK_SECRET ?? "",
      DEPLOY_REQUESTED_COMMIT: body.after ?? "",
      // Pin deploy.ts's notion of the LIVE serving dir explicitly. When we run
      // the deploy-src copy of deploy.ts, its import.meta.dir-derived
      // PROJECT_ROOT would point at the deploy-src worktree, NOT the live tree —
      // so restoreSlotToLive / the rdv.ts restart would target the wrong dir.
      // Passing DEPLOY_PROJECT_ROOT makes deploy.ts resolve PROJECT_ROOT to the
      // real live serving dir regardless of which copy of the script runs.
      DEPLOY_PROJECT_ROOT: projectRoot,
    };
    // Forward the DB-TARGETING env so the spawned migration/backfill resolves
    // the SAME database the live server serves (remote-dev-6lf3). The DB path is
    // chosen purely from env (DATABASE_URL > RDV_DATA_DIR/sqlite.db >
    // ~/.remote-dev/sqlite.db; see src/lib/paths.ts) — never cwd-relative — so
    // forwarding these is what guarantees the backfill hits the live DB rather
    // than a stray default. DATABASE_URL is the highest-priority selector and was
    // previously NOT forwarded: a server configured with DATABASE_URL would have
    // had its deploy backfill silently fall back to ~/.remote-dev/sqlite.db (a
    // DIFFERENT DB). Forward both, only when set.
    if (process.env.RDV_DATA_DIR) {
      cleanEnv.RDV_DATA_DIR = process.env.RDV_DATA_DIR;
    }
    if (process.env.DATABASE_URL) {
      cleanEnv.DATABASE_URL = process.env.DATABASE_URL;
    }

    const child = spawn("bun", ["run", scriptPath], {
      cwd: scriptCwd,
      detached: true,
      stdio: "ignore",
      env: cleanEnv as unknown as NodeJS.ProcessEnv,
    });
    child.unref();

    return NextResponse.json(
      {
        message: "Deploy triggered",
        commit: body.after?.slice(0, 7) ?? "unknown",
        pid: child.pid,
      },
      { status: 202 }
    );
  } catch (err) {
    log.error("Failed to spawn deploy script", { error: String(err) });
    return NextResponse.json(
      { error: "Failed to trigger deploy" },
      { status: 500 }
    );
  }
}
