import { defineConfig } from "drizzle-kit";
import { homedir } from "node:os";
import { join } from "node:path";

// The Supervisor keeps its own SQLite database, independent of any instance.
// Path resolution mirrors src/db/index.ts:
//   DATABASE_URL > SUPERVISOR_DATA_DIR/supervisor.db > ~/.remote-dev-supervisor/supervisor.db
function getDatabasePath(): string {
  const dbUrl = process.env.DATABASE_URL;
  if (dbUrl) {
    return dbUrl.startsWith("file:") ? dbUrl.slice(5) : dbUrl;
  }
  const dataDir =
    process.env.SUPERVISOR_DATA_DIR || join(homedir(), ".remote-dev-supervisor");
  return join(dataDir, "supervisor.db");
}

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url: getDatabasePath(),
  },
});
