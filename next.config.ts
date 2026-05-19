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
  output: "standalone",
  serverExternalPackages: ["@libsql/client", "mysql2"],
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
