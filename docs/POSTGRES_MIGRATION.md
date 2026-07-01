# Migrating SQLite → PostgreSQL

Operational runbook for moving an existing SQLite install of Remote Dev onto the
optional PostgreSQL backend. The data move is done **offline** by a one-shot CLI
that reads the SQLite database and writes into a Postgres database.

If you are setting up Postgres from scratch (no data to carry over), you do not
need this guide — just point `DATABASE_URL` at a Postgres URL and the schema is
applied on boot. See the "PostgreSQL backend (optional)" section in
[`docs/SETUP.md`](./SETUP.md).

> **PostgreSQL is a supported, shipped backend — not experimental.** It runs on
> the real `pg` driver, applies its schema through migrate-on-boot
> (`src/db/migrate.ts`), and has a production deployment path: a
> database-per-instance model on a shared CloudNativePG cluster (see the
> "CloudNativePG" section of [`MULTI_INSTANCE.md`](./MULTI_INSTANCE.md)). One
> honesty footnote: the Postgres **integration/testcontainers suites run locally
> only — they are not part of CI** (in fact CI runs no Vitest suite at all), so
> rehearse any cutover against a staging copy of your data before doing it for
> real.

## Prerequisites

- A reachable PostgreSQL **14+** server and an empty (or dedicated) target
  database + login role.
- The existing SQLite database (default `~/.remote-dev/sqlite.db`, or whatever
  `RDV_DATA_DIR` points at). Optionally the `logs.db` / `analytics.db` sidecars
  under the same data dir.
- A checkout of this repo with dependencies installed (`bun install`) so the CLI
  (`bun run db:migrate-to-postgres`) is available.

## The migration CLI

```bash
bun run db:migrate-to-postgres \
  --from <sqlite|default> \
  --to postgresql://user:pass@host:5432/dbname \
  [--verify] [--truncate] [--resume] \
  [--include-logs] [--include-analytics] \
  [--batch-size <n>] [--dry-run]
```

| Flag | Meaning |
|------|---------|
| `--from <url>` | Source: a SQLite file path, a `file:` URL, a libsql URL, or `default` (resolves `RDV_DATA_DIR/sqlite.db` via `src/lib/paths`). Default: `default`. |
| `--to <url>` | Target `postgresql://` (or `postgres://`) connection string. **Required.** |
| `--verify` | After copy, compare source/target row counts per table; exit non-zero on any mismatch. |
| `--truncate` | `TRUNCATE … CASCADE` each target table before copying. |
| `--resume` | Skip tables already marked complete (watermark files under `.migrate-watermarks/`). |
| `--include-logs` | Also copy the `logs.db` sidecar into the `logs` schema. |
| `--include-analytics` | Also copy the `analytics.db` sidecar into the `analytics` schema. |
| `--batch-size <n>` | Insert batch size (default `500`). |
| `--dry-run` | Plan only — touch nothing. |

Additional knobs (rarely needed): `--tables <csv>` (limit to specific SQL table
names), `--concurrency <n>` (parallel copies within a dependency tier, default
`4`), `--watermark-dir <dir>`, `--log-level <error|warn|info|debug>`. Run with
`-h` / `--help` for the full list.

Tables are copied in **foreign-key dependency order**, so referential integrity
holds throughout the copy.

## Recommended sequence

1. **Stop the app** (both the Next.js and terminal servers) so the SQLite
   database is quiescent — no writes during the copy.
2. **Ensure the Postgres schema exists.** Either start the app once against the
   Postgres URL so migrate-on-boot applies it, or apply it directly:
   ```bash
   DATABASE_URL=postgresql://user:pass@host:5432/dbname bun run db:push:pg
   ```
3. **Run the migration with verification:**
   ```bash
   bun run db:migrate-to-postgres \
     --from default \
     --to postgresql://user:pass@host:5432/dbname \
     --verify --include-logs --include-analytics
   ```
   (A first `--dry-run` is a good sanity check of the plan.)
4. **Point the app at Postgres:** set `DATABASE_URL=postgresql://…` in the
   environment (`.env.local` for local, the per-instance secret in k8s).
5. **Restart the app.** Migrate-on-boot is a no-op against an already-migrated
   database, and the app now reads/writes Postgres.

## Idempotency, resumability & timestamps

- **Idempotent.** Inserts use `onConflictDoNothing`, so re-running the CLI over a
  partially-copied target does not duplicate rows. Combine with `--resume` to
  skip whole tables that already completed.
- **Resumable.** Each completed table writes a watermark; `--resume` skips those
  on a re-run, so an interrupted migration can pick up where it left off.
- **Timestamps normalized automatically.** SQLite historically stored some
  timestamp columns as epoch **seconds** and others as epoch **milliseconds**;
  Postgres uses `timestamptz`. The CLI reads through Drizzle bound to the
  concrete SQLite schema and writes through Drizzle bound to the concrete
  Postgres schema, so the column **modes** (`timestamp` vs `timestamp_ms` →
  `timestamptz`) convert each value on the round-trip — no hand-rolled per-column
  math. Verified to land with **0 ms drift**.

## Rollback

The backend is **environment-gated**: it is chosen at boot purely from the
`DATABASE_URL` scheme. To roll back to SQLite, **unset (or revert)
`DATABASE_URL`** and restart the app — it falls straight back to the SQLite
database, which the migration left untouched (the copy only reads it).
