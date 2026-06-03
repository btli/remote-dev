import { defineConfig } from "drizzle-kit";

// Postgres dialect config for the Supervisor's dual-backend path.
// The sqlite config stays in `drizzle.config.ts`; this file is read only by the
// drizzle-kit CLI for the Postgres path (`db:generate:pg` / `db:push:pg`).
export default defineConfig({
  schema: "./src/db/schema.pg.ts",
  out: "./drizzle/pg",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
});
