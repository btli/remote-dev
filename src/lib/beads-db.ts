import { createPool, type Pool, type RowDataPacket } from "mysql2/promise";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createLogger } from "@/lib/logger";

const log = createLogger("BeadsDB");

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

const _pools = new Map<string, Pool>();

export function getBeadsPool(projectPath: string): Pool {
  const existing = _pools.get(projectPath);
  if (existing) return existing;

  const port = getDoltPort(projectPath);
  const database = getDatabaseName(projectPath);
  log.info("Creating Dolt connection pool", { port, database, projectPath });
  const pool = createPool({
    host: "127.0.0.1",
    port,
    database,
    user: "root",
    password: "",
    connectionLimit: 5,
    waitForConnections: true,
    connectTimeout: 5000,
  });
  _pools.set(projectPath, pool);
  return pool;
}

export async function beadsQuery<T extends RowDataPacket>(
  projectPath: string,
  sql: string,
  params: (string | number | null)[] = []
): Promise<T[]> {
  const pool = getBeadsPool(projectPath);
  const [rows] = await pool.execute<T[]>(sql, params);
  return rows;
}

export async function isBeadsAvailable(projectPath: string): Promise<boolean> {
  try {
    const pool = getBeadsPool(projectPath);
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}
