import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// AST selectors that forbid bare `fetch("/...")` and `fetch(`/...\`)` in
// client modules. Bare fetch with a root-relative URL bypasses the runtime
// basePath prefix (Next.js's basePath does NOT auto-prefix `fetch` calls),
// so every such call 404s under multi-instance hosting (RDV_BASE_PATH=/alpha).
// Use `apiFetch` from `@/lib/api-fetch` instead — it reads
// `window.__RDV_BASE_PATH__` at runtime and prepends the prefix.
const NO_BARE_FETCH_RULES = [
  {
    selector:
      "CallExpression[callee.type='Identifier'][callee.name='fetch'][arguments.0.type='Literal'][arguments.0.value=/^\\//]",
    message:
      "Use apiFetch from @/lib/api-fetch instead — bare fetch with a root-relative URL bypasses the RDV_BASE_PATH prefix.",
  },
  {
    selector:
      "CallExpression[callee.type='Identifier'][callee.name='fetch'][arguments.0.type='TemplateLiteral'][arguments.0.quasis.0.value.raw=/^\\//]",
    message:
      "Use apiFetch from @/lib/api-fetch instead — bare fetch with a root-relative template URL bypasses the RDV_BASE_PATH prefix.",
  },
];

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
  // basePath guard: ban bare `fetch("/...")` in client modules. Scoped to
  // contexts, components, hooks, and client-side lib utilities. Server
  // route handlers (`src/app/api/**`) and tests are excluded below.
  {
    files: [
      "src/contexts/**/*.{ts,tsx}",
      "src/components/**/*.{ts,tsx}",
      "src/hooks/**/*.{ts,tsx}",
      "src/lib/**/*.{ts,tsx}",
    ],
    rules: {
      "no-restricted-syntax": ["error", ...NO_BARE_FETCH_RULES],
    },
  },
  // Disable the bare-fetch ban in tests and server route handlers — tests
  // mock fetch directly, and route handlers run server-side where there
  // is no basePath prefix to apply.
  {
    files: [
      "src/app/api/**/*.{ts,tsx}",
      "**/__tests__/**/*.{ts,tsx}",
      "**/*.test.{ts,tsx}",
    ],
    rules: {
      "no-restricted-syntax": "off",
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
    // Agent worktrees (stale isolated checkouts inside .claude/)
    ".claude/worktrees/**",
    // Claude Code plugin skills (external JS scripts)
    ".claude/skills/**",
  ]),
]);

export default eslintConfig;
