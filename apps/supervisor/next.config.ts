import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// The Supervisor UI runs on its OWN hostname (e.g. sup.example.com) per the
// k3s supervisor spec §15 M3 — it is NOT slug-pathed like provisioned
// instances. basePath is therefore always "" (root). Do not wire RDV_BASE_PATH
// here; that is an instance (data-plane) concern, not a control-plane one.

// Turbopack root = the monorepo root. In this bun workspace the app's deps
// (incl. `next`) are symlinks into the repo-root `node_modules/.bun` store, so
// Turbopack must be allowed to resolve from the monorepo root — pointing it at
// the app dir makes Next fail to locate `next` and re-infer the root. Because
// the root is shared with the main app, this app provides its OWN convention
// files (`src/proxy.ts`, `src/instrumentation.ts`) so Turbopack uses them
// rather than walking up to the sibling root app's `src/`.
const monorepoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const nextConfig: NextConfig = {
  // `output: "standalone"` produces a self-contained server bundle suitable
  // for the Supervisor's own container image (built in a later task).
  output: "standalone",
  // libsql ships native bindings that must not be bundled by the Next compiler.
  serverExternalPackages: ["@libsql/client"],
  turbopack: {
    root: monorepoRoot,
  },
};

export default nextConfig;
