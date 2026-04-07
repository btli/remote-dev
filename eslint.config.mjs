import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Worktree trash
    ".trash/**",
    // Test coverage reports
    "coverage/**",
    // Standalone Node.js scripts (CJS)
    "scripts/**",
    // Mobile app (separate React Native project)
    "packages/**",
    // Git worktrees (separate checkouts with their own lint)
    ".worktrees/**",
    // Claude Code plugin skills (external JS scripts)
    ".claude/skills/**",
  ]),
]);

export default eslintConfig;
