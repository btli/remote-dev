/**
 * E2E smoke seed (spec §11 M8 / bd remote-dev-jvcx.11).
 *
 * Seeds the Supervisor's own SQLite DB with one owner + N `ready` instance rows
 * so the router's allowlist endpoint (`GET /api/internal/routes`) lights up
 * WITHOUT a real Kubernetes cluster. The smoke harness boots the Supervisor with
 * no k8s; provisioning never runs, so the `instance` table is otherwise empty.
 * This insert is the single bridge that makes the router resolve `/<slug>/*` to
 * the compose instance containers (which carry the cluster-DNS network aliases
 * `rdv.rdv-<slug>.svc.cluster.local`).
 *
 * Runtime: invoked with `bun` INSIDE the Supervisor image (its controller
 * process already runs `bun src/controller/index.ts` against `@libsql/client`,
 * so bun + the native libsql binding is proven in that image). It talks to the
 * SAME `supervisor.db` the running web server uses, over a shared compose volume;
 * WAL + busy_timeout=10s make the concurrent write safe.
 *
 * It is purely additive and idempotent (INSERT OR IGNORE keyed on the unique
 * `slug` / `email` columns), so re-running it — e.g. a harness retry — is a
 * no-op. It writes NOTHING the running Supervisor wouldn't have written itself
 * via the real provisioning path; it just shortcuts the k8s round-trip.
 *
 * NOTE: raw SQL (not the Drizzle schema) on purpose — keeps this a dependency-
 * light standalone script that can't drift with a bundler and mirrors the
 * instance image's own `scripts/instance-bootstrap-db.mjs` @libsql-raw-SQL style.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createClient, type Client } from "@libsql/client/node";

/** Resolve the Supervisor SQLite URL exactly like apps/supervisor/src/db/dialect-sqlite.ts. */
function databaseUrl(): string {
  const dbUrl = process.env.DATABASE_URL;
  if (dbUrl) return dbUrl.startsWith("file:") ? dbUrl : `file:${dbUrl}`;
  const dir =
    process.env.SUPERVISOR_DATA_DIR || join(homedir(), ".remote-dev-supervisor");
  return `file:${join(dir, "supervisor.db")}`;
}

/** Slugs to seed. Override with E2E_SLUGS="alpha,beta" (comma-separated). */
function targetSlugs(): string[] {
  const raw = process.env.E2E_SLUGS ?? "alpha,beta";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Owner email for the seeded instances. Matches the harness admin by default. */
function ownerEmail(): string {
  return process.env.SUPERVISOR_ADMIN_EMAIL ?? "smoke@example.com";
}

const NOW = Date.now();

/**
 * Ensure the owner `supervisor_user` row exists and return its id. The
 * Supervisor's migrate-on-boot + admin seed may have already created this row
 * (when SUPERVISOR_ADMIN_EMAIL is set), so we look it up first and only insert
 * when missing.
 */
async function ensureOwner(db: Client, email: string): Promise<string> {
  const existing = await db.execute({
    sql: "SELECT id FROM supervisor_user WHERE email = ? LIMIT 1",
    args: [email],
  });
  if (existing.rows.length > 0) {
    return String(existing.rows[0].id);
  }
  const id = randomUUID();
  await db.execute({
    sql: `INSERT INTO supervisor_user (id, email, role, created_at, updated_at)
          VALUES (?, ?, 'admin', ?, ?)`,
    args: [id, email, NOW, NOW],
  });
  return id;
}

/**
 * Insert (idempotently) a `ready` instance for `slug` owned by `ownerId`. The
 * namespace MUST be `rdv-<slug>` — the router's allowlist validator
 * (apps/supervisor-router/src/lib/allowlist.ts) enforces that exact grammar
 * before it will resolve the upstream, and `GET /api/internal/routes` echoes
 * `instance.namespace` straight through.
 */
async function ensureReadyInstance(
  db: Client,
  slug: string,
  ownerId: string,
): Promise<void> {
  const id = randomUUID();
  await db.execute({
    sql: `INSERT OR IGNORE INTO instance
            (id, slug, display_name, owner_id, status, namespace,
             provisioned_at, last_reconciled_at, created_at, updated_at)
          VALUES (?, ?, ?, ?, 'ready', ?, ?, ?, ?, ?)`,
    args: [
      id,
      slug,
      `Smoke ${slug}`,
      ownerId,
      `rdv-${slug}`,
      NOW,
      NOW,
      NOW,
      NOW,
    ],
  });
  // If the row already existed (e.g. from a prior run) make sure it is `ready`
  // so the allowlist will publish it.
  await db.execute({
    sql: "UPDATE instance SET status = 'ready' WHERE slug = ?",
    args: [slug],
  });
}

async function main(): Promise<void> {
  const url = databaseUrl();
  const slugs = targetSlugs();
  const email = ownerEmail();

  const db = createClient({ url });
  // Match the app's PRAGMAs so this concurrent writer cooperates with the
  // running server's WAL connection instead of tripping SQLITE_BUSY.
  await db.execute("PRAGMA journal_mode = WAL").catch(() => {});
  await db.execute("PRAGMA busy_timeout = 10000").catch(() => {});

  const ownerId = await ensureOwner(db, email);
  for (const slug of slugs) {
    await ensureReadyInstance(db, slug, ownerId);
  }

  const check = await db.execute(
    "SELECT slug, namespace, status FROM instance ORDER BY slug",
  );
  // This script is a TEST harness utility (not server code), so plain stdout is
  // the right channel for its progress — there is no structured logger here.
  console.log(
    `[seed] ${url}: owner=${email} -> ${check.rows
      .map((r) => `${r.slug}(${r.namespace},${r.status})`)
      .join(", ")}`,
  );
}

main().catch((err) => {
  console.error("[seed] FATAL:", err);
  process.exit(1);
});
