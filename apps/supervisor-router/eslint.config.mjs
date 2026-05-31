import { defineConfig, globalIgnores } from "eslint/config";
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

// Standalone flat config for the @remote-dev/supervisor-router workspace.
//
// This is a pure Bun HTTP/WebSocket server (no React, no Next.js), so it uses
// the typescript-eslint recommended set directly rather than eslint-config-next.
// It is scoped to apps/supervisor-router; the root `eslint` run globally-ignores
// `apps/**`, so the two trees never lint each other.
const eslintConfig = defineConfig([
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: {
        // Bun provides the Web platform globals (fetch, Request, Response,
        // WebSocket, URL, …) plus Node-style process/console.
        ...globals.node,
        Bun: "readonly",
      },
    },
    rules: {
      // Allow intentionally unused args/vars when prefixed with `_`.
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
  globalIgnores(["dist/**", "coverage/**", "node_modules/**"]),
]);

export default eslintConfig;
