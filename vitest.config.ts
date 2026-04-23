import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "happy-dom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "tests/**/*.test.ts", "tests/**/*.test.tsx"],
    exclude: [
      "node_modules",
      "dist",
      ".next",
      // Stale tests inside claude-agent worktrees are duplicates of real tests
      // already covered by src/** and tests/** — exclude so vitest doesn't
      // double-count them (and doesn't break when a worktree is unlocked
      // mid-run).
      ".claude/worktrees/**",
      ".worktrees/**",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      reportsDirectory: "./coverage",
      thresholds: {
        statements: 80,
        branches: 80,
        functions: 80,
        lines: 80,
      },
      exclude: [
        "node_modules/**",
        "tests/**",
        "**/*.test.ts",
        "**/*.test.tsx",
        "**/*.d.ts",
        "**/*.config.*",
        "**/types/**",
        "src/app/**", // Exclude Next.js app routes for now
        "src/components/**", // Exclude React components for now
        "src/contexts/**", // Exclude React contexts for now
        "src/db/schema.ts", // Exclude Drizzle schema (declarative, no logic)
        "electron/**",
        "scripts/**",
      ],
    },
    testTimeout: 10000,
    hookTimeout: 10000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@tests": path.resolve(__dirname, "./tests"),
    },
  },
});
