import type { NextConfig } from "next";

// Read RDV_BASE_PATH directly here — next.config.ts runs before any other
// module is loaded, so importing from `src/lib/base-path` would introduce a
// build-order dependency. Validation lives in `src/lib/base-path.ts` and is
// exercised when the server starts; here we trust it.
//
// Caveat (NF-4): Next.js bakes `basePath` at build time. A single image cannot
// serve multiple slugs at runtime if Next.js itself owns the prefix. For
// multi-slug deployments, either build per slug (`docker build --build-arg
// RDV_BASE_PATH=/alpha`) or have the ingress strip the prefix before requests
// reach Next.js. This is a flag for the operator; the rest of the app is
// runtime-configurable.
const basePath = process.env.RDV_BASE_PATH || "";

const nextConfig: NextConfig = {
  // basePath must be omitted entirely or a non-empty `/foo` — the empty
  // string is not a legal value, hence the spread-only-when-truthy pattern.
  ...(basePath ? { basePath } : {}),
  // INLINE `process.env.RDV_BASE_PATH` into ALL bundles at build time so the
  // baked `/rdvslug` sentinel is a materializable LITERAL everywhere — most
  // importantly inside the Node-runtime **proxy** bundle (`src/proxy.ts` →
  // `src/lib/base-path.ts`). Without this, Turbopack leaves a RUNTIME
  // `process.env.RDV_BASE_PATH ?? ""` read in the proxy chunk; that read is NOT
  // reliably populated when the standalone server evaluates the proxy module
  // graph, so the proxy computed `BASE_PATH=""` and `getSessionCookieName()`
  // returned the UNSCOPED default cookie name (`__Secure-authjs.session-token`)
  // while the Node server set the SCOPED name (`__Secure-rdv-<slug>-...`) for an
  // instance — the mismatch made `getToken()` null and bounced OIDC/credentials
  // login back to /login. As a literal `/rdvslug`, the entrypoint's existing
  // `sed` materialization (`docker/entrypoint.sh`, over `/app/.next`) rewrites it
  // to the real `/<slug>` in the proxy chunk too, so the proxy resolves the same
  // basePath as the server. (Next 16 runs the proxy on Node.js and FORBIDS a
  // `runtime` export in the proxy file, so build-time inlining — not a runtime
  // switch — is the fix.) `env` values are baked at BUILD time: with
  // `RDV_BASE_PATH=""` (single-server) it inlines `""`, byte-identical behavior.
  env: { RDV_BASE_PATH: basePath },
  output: "standalone",
  // Next 16 buffers request bodies that pass through the Node proxy
  // (`src/proxy.ts`) and truncates them at a 10MB default. The
  // server-to-server migration uploads archives in 64 MiB chunks
  // (CHUNK_SIZE_BYTES in src/lib/migration-bundle.ts), so the default cap
  // aborted every working-tree/profile/agent-settings chunk mid-stream
  // (CHUNK_WRITE_FAILED "aborted" → HTTP 400 at chunk #0). Raise the proxy
  // body cap to 96mb: above one 64 MiB chunk (~67MB) with headroom, yet
  // under the Cloudflare tunnel's ~100MB request-body ceiling for off-LAN
  // peers. If CHUNK_SIZE_BYTES is ever increased, raise this in lockstep
  // (and mind the CF ceiling). `proxyClientMaxBodySize` is the Next 16 name
  // (the older `middlewareClientMaxBodySize` is its deprecated alias).
  experimental: {
    proxyClientMaxBodySize: "96mb",
  },
  serverExternalPackages: ["@libsql/client", "better-sqlite3", "pg", "mysql2"],
  outputFileTracingExcludes: {
    "*": [".agents/**", ".claude/**", ".claude-plugin/**"],
  },
  turbopack: {
    root: process.cwd(),
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "avatars.githubusercontent.com",
        pathname: "/u/**",
      },
    ],
  },
};

export default nextConfig;
