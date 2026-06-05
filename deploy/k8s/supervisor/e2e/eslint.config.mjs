import { defineConfig, globalIgnores } from "eslint/config";
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

// Standalone flat config for the supervisor-router E2E smoke harness.
//
// These are pure Bun scripts (fetch + WebSocket + node:crypto + @libsql/client),
// no React / Next.js — so they use the typescript-eslint recommended set
// directly, mirroring apps/supervisor-router/eslint.config.mjs. The ROOT eslint
// run globally-ignores `deploy/k8s/supervisor/e2e/**`, so the two trees never
// lint each other.
const eslintConfig = defineConfig([
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: {
        // Bun provides the Web platform globals (fetch, Request, Response,
        // WebSocket, MessageEvent, CloseEvent, URL, …) plus Node-style
        // process/console, and the `Bun` namespace.
        ...globals.node,
        ...globals.browser,
        Bun: "readonly",
      },
    },
    rules: {
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
  globalIgnores(["node_modules/**", "coverage/**"]),
]);

export default eslintConfig;
