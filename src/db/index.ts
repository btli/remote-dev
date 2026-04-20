import { createClient } from "@libsql/client/node";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema";
import { getDatabaseUrl, ensureDataDirectories } from "@/lib/paths";

// Ensure data directories exist before connecting to database
ensureDataDirectories();

// Use centralized path configuration
// Priority: DATABASE_URL env var > RDV_DATA_DIR/sqlite.db > ~/.remote-dev/sqlite.db
const databaseUrl = getDatabaseUrl();

export const client = createClient({
  url: databaseUrl,
});

// Enable WAL mode and busy_timeout to prevent SQLITE_BUSY under concurrent writes
client.execute("PRAGMA journal_mode = WAL").catch(() => {});
client.execute("PRAGMA synchronous = NORMAL").catch(() => {});
client.execute("PRAGMA busy_timeout = 5000").catch(() => {});

export const db = drizzle(client, { schema });
