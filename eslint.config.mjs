import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Allow intentionally unused args/vars when prefixed with `_`
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
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
