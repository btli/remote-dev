import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone mode for Electron packaging
  output: "standalone",
  serverExternalPackages: ["@libsql/client"],
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
