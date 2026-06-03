import { defineConfig } from "vitest/config";
import path from "path";

/**
 * PostgreSQL integration test config (dual-backend feature, Unit 11 B/C).
 *
 * This config runs ONLY the docker-gated `*.pg.test.ts` suites. A real
 * PostgreSQL container is started once in `globalSetup` (tests/db-harness/
 * pg-setup.ts) and torn down after the run; the connection URI is exposed via
 * `process.env.TEST_PG_URL`. The fast suite (vitest.config.ts) excludes
 * `**\/*.pg.test.ts`, so these never run there.
 *
 * `environment: "node"` (not happy-dom) because these are pure server-side DB
 * tests with no DOM. No `setupFiles` — the fast suite's tests/setup.ts mocks
 * React hooks we don't want here.
 */
export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["**/*.pg.test.ts"],
    exclude: ["node_modules", "dist", ".next", ".claude/worktrees/**", ".worktrees/**"],
    globalSetup: ["./tests/db-harness/pg-setup.ts"],
    // Container startup + per-file migrations need generous timeouts.
    testTimeout: 60000,
    hookTimeout: 120000,
    // globalSetup teardown stops+removes the container; give it room.
    teardownTimeout: 60000,
    // A single shared container; run files serially to keep schema creation and
    // teardown deterministic and avoid connection-pool contention.
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@tests": path.resolve(__dirname, "./tests"),
    },
  },
});
