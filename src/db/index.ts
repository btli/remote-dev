import { createClient } from "@libsql/client/node";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema";
import { getDatabaseUrl, ensureDataDirectories } from "@/lib/paths";

// Ensure data directories exist before connecting to database
ensureDataDirectories();

// Use centralized path configuration
// Priority: DATABASE_URL env var > RDV_DATA_DIR/sqlite.db > ~/.remote-dev/sqlite.db
const databaseUrl = getDatabaseUrl();

const client = createClient({
  url: databaseUrl,
});

export const db = drizzle(client, { schema });
