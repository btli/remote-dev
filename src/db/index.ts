import { createClient } from "@libsql/client/node";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema";

// Use DATABASE_URL env var, defaulting to sqlite.db in current directory
// For prod, set DATABASE_URL to absolute path so both Next.js and terminal server use same DB
const databaseUrl = process.env.DATABASE_URL || "file:sqlite.db";

const client = createClient({
  url: databaseUrl,
});

export const db = drizzle(client, { schema });
