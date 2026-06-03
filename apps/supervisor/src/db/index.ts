/**
 * Supervisor database entry point. Independent of any instance database.
 *
 * Dual-backend: the active dialect (SQLite via libsql, or PostgreSQL via
 * node-postgres) is chosen once at boot from `DATABASE_URL` (see is-postgres.ts
 * and dialect.ts). Consumers keep importing `{ db } from "@/db"` unchanged; the
 * `db` type is stable across both backends.
 *
 * Path resolution (SQLite, mirrors the root app's src/db + src/lib/paths.ts):
 *   DATABASE_URL > SUPERVISOR_DATA_DIR/supervisor.db > ~/.remote-dev-supervisor/supervisor.db
 */
import { getDialect } from "./dialect";

const dialect = getDialect();

export const db = dialect.db;
