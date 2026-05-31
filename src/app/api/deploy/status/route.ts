/**
 * Deploy Status Endpoint
 *
 * GET /api/deploy/status?commit=<full-sha>
 * Header: X-Hub-Signature-256: sha256=<hmac of the commit string, keyed by DEPLOY_WEBHOOK_SECRET>
 *
 * Lets the CI workflow (and operators) observe the outcome of the async,
 * fire-and-forget deploy triggered via POST /api/deploy, closing the gap where
 * CI went green regardless of whether the server-side deploy actually landed
 * (remote-dev-6pbo). Read-only; authenticated with the same HMAC secret as the
 * deploy webhook (signature is over the `commit` query value since GET has no body).
 */
import { NextResponse } from "next/server";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { createLogger } from "@/lib/logger";
import { verifySignature } from "@/lib/deploy-webhook-auth";

const log = createLogger("DeployStatus");

const DATA_DIR = process.env.RDV_DATA_DIR || join(homedir(), ".remote-dev");
const RESULT_FILE = join(DATA_DIR, "deploy", "last-deploy.json");
const STATE_FILE = join(DATA_DIR, "deploy", "state.json");
const LOCK_FILE = join(DATA_DIR, "deploy", "deploy.lock");

function readJson<T>(file: string): T | null {
  try {
    if (existsSync(file)) return JSON.parse(readFileSync(file, "utf-8")) as T;
  } catch {
    // ignore
  }
  return null;
}

function isDeployLockAlive(): boolean {
  if (!existsSync(LOCK_FILE)) return false;
  try {
    const pid = parseInt(readFileSync(LOCK_FILE, "utf-8").trim(), 10);
    if (Number.isNaN(pid)) return false;
    process.kill(pid, 0);
    return true; // process alive
  } catch {
    return false; // dead/stale lock or unreadable → treat as not held
  }
}

interface DeployResultRecord {
  status: string;
  requestedCommit: string;
  activeCommit: string | null;
  stage: string;
  error?: string;
  startedAt: string;
  finishedAt?: string;
}
interface DeployStateRecord {
  activeCommit: string;
  deployedAt: string;
}

export async function GET(request: Request) {
  const secret = process.env.DEPLOY_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "Deploy not configured" }, { status: 503 });
  }

  const commit = new URL(request.url).searchParams.get("commit") ?? "";
  if (!commit) {
    return NextResponse.json({ error: "Missing commit query param" }, { status: 400 });
  }

  const signature = request.headers.get("x-hub-signature-256") ?? "";
  if (!verifySignature(secret, Buffer.from(commit), signature)) {
    log.warn("Invalid deploy-status signature", {
      ip: request.headers.get("x-forwarded-for") ?? "unknown",
    });
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const record = readJson<DeployResultRecord>(RESULT_FILE);
  const state = readJson<DeployStateRecord>(STATE_FILE);
  const lockHeld = isDeployLockAlive();

  // Authoritative: an attempt record for exactly this commit.
  if (record && record.requestedCommit === commit) {
    return NextResponse.json({ ...record, lockHeld });
  }
  // Fallback: no attempt record for this commit. state.json only advances on
  // success, so if this commit is live it genuinely succeeded — UNLESS a deploy
  // is currently running (a re-deploy of an already-live SHA whose in_progress
  // record write was lost); then we must not short-circuit to success.
  if (state && state.activeCommit === commit && !lockHeld) {
    return NextResponse.json({
      status: "success",
      requestedCommit: commit,
      activeCommit: state.activeCommit,
      stage: "done",
      startedAt: state.deployedAt,
      finishedAt: state.deployedAt,
      source: "state-fallback",
      lockHeld,
    });
  }
  // Not live and no record yet → still starting/running (or never started).
  return NextResponse.json({
    status: "in_progress",
    requestedCommit: commit,
    activeCommit: state?.activeCommit ?? null,
    stage: "unknown",
    source: "no-record",
    lockHeld,
  });
}
