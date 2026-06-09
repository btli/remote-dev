import { createConnection, type Connection, type RowDataPacket } from "mysql2/promise";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
const QUERY_TIMEOUT_MS = 8000;

/** Read the Dolt server port for a project from its .beads/dolt-server.port file. */
function getDoltPort(projectPath: string): number {
  const envPort = process.env.BEADS_DOLT_PORT;
  if (envPort) {
    const parsed = parseInt(envPort, 10);
    if (!isNaN(parsed)) return parsed;
  }
  try {
    const portFile = join(projectPath, ".beads", "dolt-server.port");
    if (existsSync(portFile)) {
      const parsed = parseInt(readFileSync(portFile, "utf-8").trim(), 10);
      if (!isNaN(parsed)) return parsed;
    }
  } catch {
    /* fall through */
  }
  return 58794;
}

/** Read the Dolt database name for a project. */
function getDatabaseName(projectPath: string): string {
  if (process.env.BEADS_DATABASE) return process.env.BEADS_DATABASE;
  // Derive from project directory name (same logic bd uses)
  const basename = projectPath.split("/").pop() ?? "beads";
  return basename.toLowerCase().replace(/[^a-z0-9]/g, "_");
}

/** Create a short-lived connection, execute a query, and close it immediately.
 *  Avoids idle persistent connections that trigger dolt CPU spin bugs. */
async function connectAndExecute<T extends RowDataPacket>(
  projectPath: string,
  sql: string,
  params: (string | number | null)[]
): Promise<T[]> {
  const port = getDoltPort(projectPath);
  const database = getDatabaseName(projectPath);

  let conn: Connection | null = null;
  try {
    conn = await createConnection({
      host: "127.0.0.1",
      port,
      database,
      user: "root",
      password: "",
      connectTimeout: 5000,
    });
    const [rows] = await conn.query<T[]>(sql, params);
    return rows;
  } finally {
    if (conn) {
      conn.end().catch(() => {});
    }
  }
}

class QueryTimeoutError extends Error {
  code = "QUERY_TIMEOUT";
  constructor() {
    super(`Dolt query timed out after ${QUERY_TIMEOUT_MS}ms`);
    this.name = "QueryTimeoutError";
  }
}

export async function beadsQuery<T extends RowDataPacket>(
  projectPath: string,
  sql: string,
  params: (string | number | null)[] = []
): Promise<T[]> {
  return Promise.race([
    connectAndExecute<T>(projectPath, sql, params),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new QueryTimeoutError()), QUERY_TIMEOUT_MS)
    ),
  ]);
}

export async function isBeadsAvailable(projectPath: string): Promise<boolean> {
  try {
    await beadsQuery(projectPath, "SELECT 1");
    return true;
  } catch {
    return false;
  }
}

/** Error codes that mean the dolt server itself is unreachable. */
const UNAVAILABLE_CODES: ReadonlySet<string> = new Set([
  "ECONNREFUSED",
  "ETIMEDOUT",
  "ENOTFOUND",
]);

/**
 * True when an error indicates bd's dolt server is unreachable (not running /
 * connection refused / DNS failure) rather than a genuine query failure.
 * Walks `code`, the `cause` chain, and `AggregateError.errors`, with a
 * message-text fallback for errors that don't carry a code.
 */
export function isDoltUnavailable(err: unknown): boolean {
  const seen = new Set<unknown>();
  const stack: unknown[] = [err];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === null || typeof current !== "object" || seen.has(current)) {
      continue;
    }
    seen.add(current);
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string" && UNAVAILABLE_CODES.has(code)) return true;
    const cause = (current as { cause?: unknown }).cause;
    if (cause) stack.push(cause);
    if (current instanceof AggregateError) stack.push(...current.errors);
  }
  // Fallback: match the message text for errors that don't expose a code.
  const msg = String(err);
  for (const code of UNAVAILABLE_CODES) {
    if (msg.includes(code)) return true;
  }
  return false;
}
