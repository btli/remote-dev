/**
 * CNPG database-per-instance bootstrap (Unit 8, Postgres dual-backend).
 *
 * When the supervisor runs on Postgres, each provisioned instance gets its OWN
 * database + login role on the SHARED CloudNativePG (CNPG) cluster, rather than
 * a per-PVC SQLite file. This module owns the idempotent DDL that creates that
 * role + database, run by the provisioner (the single k8s writer) just before
 * the StatefulSet is created.
 *
 * Connection model (spec § CNPG):
 *   - DDL (CREATE ROLE/DATABASE) MUST hit the CNPG RW Service (CNPG_RW_HOST),
 *     NOT the PgBouncer Pooler: the Pooler's transaction-pooling mode blocks
 *     session-level DDL like CREATE DATABASE. We connect a plain `pg.Client`
 *     (NOT a Pool — DDL is a one-shot session) to CNPG_RW_HOST:5432, db
 *     `postgres`, user `postgres`, using the superuser password read from the
 *     CNPG-generated k8s Secret.
 *   - The instance APP connects through the Pooler (CNPG_POOLER_HOST) via the
 *     DATABASE_URL we bake into the per-instance `rdv-<slug>-db` Secret
 *     (buildDbSecret in provisioner-builders.ts) — that wiring is NOT here.
 *
 * SQLite path: when CNPG_CLUSTER_NAME is unset there is no CNPG cluster, so
 * {@link bootstrapInstanceDatabase} is a no-op returning null and the instance
 * falls back to its per-PVC SQLite DB (unchanged behavior).
 *
 * SECURITY: the superuser password and the generated per-instance role password
 * are NEVER logged. Identifiers are escaped with `client.escapeIdentifier()`;
 * the role password is only ever passed as a parameterized / `format(%L)`
 * literal, never as an identifier or string-interpolated into DDL.
 */

import crypto from "node:crypto";
import type { CoreV1Api } from "@kubernetes/client-node";
import { createLogger } from "@/lib/logger";

const log = createLogger("InstanceDb");

/** The CNPG RW Service speaks the standard Postgres wire port. */
const PG_PORT = 5432;

/** The k8s clients the bootstrap needs (a subset of the provisioner's set). */
interface BootstrapClients {
  core: CoreV1Api;
}

/** Resolved CNPG env config (present only when CNPG_CLUSTER_NAME is set). */
interface CnpgConfig {
  rwHost: string;
  superuserSecretName: string;
  superuserSecretNamespace: string;
  /** Allow disabling TLS for intra-cluster connections (default: off/no-ssl). */
  ssl: boolean;
}

/**
 * Read the CNPG config from env. Returns null when CNPG_CLUSTER_NAME is unset
 * (the SQLite path) so callers can short-circuit to a no-op. The RW host and the
 * superuser Secret name/namespace are REQUIRED when CNPG is enabled — a missing
 * one throws loudly (a misconfigured Postgres deployment must surface as a
 * provisioning error, never a silently SQLite-fallback instance).
 */
function readCnpgConfig(): CnpgConfig | null {
  if (!process.env.CNPG_CLUSTER_NAME) return null;

  const rwHost = process.env.CNPG_RW_HOST;
  const superuserSecretName = process.env.CNPG_SUPERUSER_SECRET_NAME;
  const superuserSecretNamespace = process.env.CNPG_SUPERUSER_SECRET_NAMESPACE;
  if (!rwHost) throw new Error("CNPG_RW_HOST is not set (required for instance DB DDL)");
  if (!superuserSecretName) {
    throw new Error("CNPG_SUPERUSER_SECRET_NAME is not set (required for instance DB DDL)");
  }
  if (!superuserSecretNamespace) {
    throw new Error(
      "CNPG_SUPERUSER_SECRET_NAMESPACE is not set (required for instance DB DDL)",
    );
  }

  // Intra-cluster traffic to the CNPG RW Service is on the pod network; CNPG
  // does not require TLS for it, so SSL is OFF by default. An operator can opt
  // in by setting CNPG_DDL_SSL=true.
  const ssl = (process.env.CNPG_DDL_SSL ?? "").toLowerCase() === "true";

  return { rwHost, superuserSecretName, superuserSecretNamespace, ssl };
}

/**
 * Derive the per-instance database + role name from a slug. Postgres identifiers
 * cannot contain dashes unquoted, so we normalize `-` to `_` and prefix `rdv_`.
 * (The slug is validated to /[a-z0-9-]/ upstream, so the result is a safe
 * identifier; we STILL escape it at every DDL site as defence in depth.)
 */
export function instanceDbName(slug: string): string {
  return `rdv_${slug.replace(/-/g, "_")}`;
}

/** Read the superuser `password` (base64 `password` key) from the CNPG Secret. */
async function readSuperuserPassword(
  clients: BootstrapClients,
  cfg: CnpgConfig,
): Promise<string> {
  const secret = await clients.core.readNamespacedSecret({
    name: cfg.superuserSecretName,
    namespace: cfg.superuserSecretNamespace,
  });
  const encoded = secret.data?.password;
  if (!encoded) {
    throw new Error(
      `CNPG superuser Secret "${cfg.superuserSecretName}" has no "password" key`,
    );
  }
  // k8s Secret `data` values are base64-encoded.
  return Buffer.from(encoded, "base64").toString("utf8");
}

/**
 * Idempotently create the instance's role + database via a connected `pg.Client`.
 *
 * - CREATE ROLE: guarded by a `DO` block that checks `pg_roles` first, then runs
 *   `CREATE ROLE <role> WITH LOGIN PASSWORD <pw>` via `EXECUTE format(...)` so
 *   the identifier is `%I`-escaped and the password is a `%L` literal. A `DO`
 *   statement CANNOT take bind parameters, so the role name + password are
 *   embedded into the block body as `escapeLiteral()`-escaped string literals
 *   (the password is escaped, never raw, and never logged) which `format()`
 *   re-escapes as `%I`/`%L`.
 * - CREATE DATABASE: cannot run inside a transaction or `DO` block, so it is
 *   guarded by a `SELECT` against `pg_database` (parameterized) followed by a
 *   CONDITIONAL `CREATE DATABASE <db> OWNER <role>` issued from the client only
 *   when absent, using escaped identifiers.
 * - GRANT CONNECT: granted to the role on its database (idempotent).
 */
async function applyInstanceDdl(
  client: import("pg").Client,
  dbName: string,
  roleName: string,
  rolePassword: string,
): Promise<void> {
  const dbIdent = client.escapeIdentifier(dbName);
  const roleIdent = client.escapeIdentifier(roleName);
  // `DO` takes NO bind parameters, so escape the role name + password as SQL
  // string literals embedded in the block body. format(%I, %L) inside the block
  // then re-escapes them as a safe identifier + literal. The password is only
  // ever an escaped literal — never an identifier, never logged.
  const roleLit = client.escapeLiteral(roleName);
  const pwLit = client.escapeLiteral(rolePassword);

  // 1. CREATE ROLE IF NOT EXISTS (idempotent via a pg_roles guard inside a DO
  //    block).
  await client.query(
    `DO $do$
       BEGIN
         IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = ${roleLit}) THEN
           EXECUTE format('CREATE ROLE %I WITH LOGIN PASSWORD %L', ${roleLit}, ${pwLit});
         END IF;
       END
     $do$;`,
  );

  // 2. CREATE DATABASE only when absent (CREATE DATABASE forbids a txn/DO block,
  //    so guard with a parameterized SELECT then a conditional CREATE using
  //    escaped identifiers).
  const exists = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [
    dbName,
  ]);
  if (exists.rowCount === 0) {
    await client.query(`CREATE DATABASE ${dbIdent} OWNER ${roleIdent}`);
  }

  // 3. GRANT CONNECT on the database to the role (idempotent).
  await client.query(`GRANT CONNECT ON DATABASE ${dbIdent} TO ${roleIdent}`);
}

/**
 * Bootstrap the per-instance Postgres database on the shared CNPG cluster.
 *
 * @returns the generated role password when CNPG is enabled (so the caller can
 *   bake it into the per-instance DATABASE_URL Secret), or `null` when CNPG is
 *   not configured (SQLite path — no-op).
 *
 * The DDL is fully idempotent: re-running for an existing role/database is a
 * no-op and never throws. The `pg.Client` is always closed in `finally`.
 *
 * SECURITY: never logs the superuser password or the generated role password.
 */
export async function bootstrapInstanceDatabase(
  slug: string,
  clients: BootstrapClients,
): Promise<string | null> {
  const cfg = readCnpgConfig();
  if (!cfg) {
    // SQLite path (or CNPG not configured) — nothing to do.
    return null;
  }

  const dbName = instanceDbName(slug);
  const roleName = dbName;
  // Strong random password (base64url, no padding) for the instance login role.
  const rolePassword = crypto.randomBytes(32).toString("base64url");

  log.info("bootstrapping instance database on CNPG", {
    slug,
    dbName,
    roleName,
    rwHost: cfg.rwHost,
    // NEVER log the passwords.
  });

  const superuserPassword = await readSuperuserPassword(clients, cfg);

  // Dynamic import keeps `pg` out of the cold path for SQLite-only deployments.
  const { Client } = await import("pg");
  const client = new Client({
    host: cfg.rwHost,
    port: PG_PORT,
    database: "postgres",
    user: "postgres",
    password: superuserPassword,
    ssl: cfg.ssl ? { rejectUnauthorized: false } : false,
  });

  try {
    await client.connect();
    await applyInstanceDdl(client, dbName, roleName, rolePassword);
    log.info("instance database ready", { slug, dbName, roleName });
    return rolePassword;
  } catch (err) {
    log.error("instance database bootstrap failed", {
      slug,
      dbName,
      roleName,
      error: String(err),
    });
    throw err;
  } finally {
    await client.end();
  }
}
