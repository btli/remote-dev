import { createConnection, type Connection, type RowDataPacket } from "mysql2/promise";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createLogger } from "@/lib/logger";

const log = createLogger("BeadsDB");

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

// Legacy export — kept for backward compatibility but no longer pool-backed
export function getBeadsPool(_projectPath: string): never {
  throw new Error("getBeadsPool is removed — use beadsQuery directly");
}

export async function isBeadsAvailable(projectPath: string): Promise<boolean> {
  try {
    await beadsQuery(projectPath, "SELECT 1");
    return true;
  } catch {
    return false;
  }
}
