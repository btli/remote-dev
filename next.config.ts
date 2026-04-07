import type { NextConfig } from "next";

const ccflarePort = process.env.CCFLARE_PORT || "8787";

const nextConfig: NextConfig = {
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
  async rewrites() {
    return [
      // Proxy ccflare dashboard through Next.js (auth enforced by middleware)
      {
        source: "/ccflare/:path*",
        destination: `http://127.0.0.1:${ccflarePort}/:path*`,
      },
    ];
  },
};

export default nextConfig;
