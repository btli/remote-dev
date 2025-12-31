import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "happy-dom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "tests/**/*.test.ts"],
    exclude: ["node_modules", "dist", ".next"],
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
