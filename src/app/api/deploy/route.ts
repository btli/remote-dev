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
import { createHmac, timingSafeEqual } from "crypto";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { spawn } from "child_process";
import { createLogger } from "@/lib/logger";

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

function verifySignature(
  secret: string,
  rawBody: Buffer,
  signatureHeader: string
): boolean {
  const expected =
    "sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex");

  // Always run constant-time comparison to prevent timing oracle.
  // Pad to expected length so timingSafeEqual never throws on length mismatch.
  const expectedBuf = Buffer.from(expected);
  const sigBuf = Buffer.alloc(expectedBuf.length);
  Buffer.from(signatureHeader).copy(sigBuf);
  const match = timingSafeEqual(sigBuf, expectedBuf);
  return match && signatureHeader.length === expected.length;
}

export async function POST(request: Request) {
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

  // Spawn deploy script as detached background process
  // Use the project root (where scripts/ lives), not standalone dir
  const projectRoot =
    process.env.DEPLOY_PROJECT_ROOT ||
    join(homedir(), "Projects", "btli", "remote-dev");
  const scriptPath = join(projectRoot, "scripts", "deploy.ts");

  log.info("Triggering deploy", {
    commit: body.after?.slice(0, 7) ?? "unknown",
    pusher: body.pusher?.name ?? "unknown",
    script: scriptPath,
  });

  try {
    const child = spawn("bun", ["run", scriptPath], {
      cwd: projectRoot,
      detached: true,
      stdio: "ignore",
      env: {
        ...process.env,
        // Ensure the deploy script knows the project root
        DEPLOY_EXTERNAL_URL:
          process.env.DEPLOY_EXTERNAL_URL || "https://dev.bryanli.net",
      },
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
