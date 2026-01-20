import { defineConfig } from "drizzle-kit";
import { homedir } from "os";
import { join } from "path";

// Centralized database path - matches src/lib/paths.ts
// Priority: DATABASE_URL > RDV_DATA_DIR/sqlite.db > ~/.remote-dev/sqlite.db
function getDatabasePath(): string {
  const dbUrl = process.env.DATABASE_URL;
  if (dbUrl) {
    return dbUrl.startsWith("file:") ? dbUrl.slice(5) : dbUrl;
  }
  const dataDir = process.env.RDV_DATA_DIR || join(homedir(), ".remote-dev");
  return join(dataDir, "sqlite.db");
}

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url: getDatabasePath(),
  },
});
