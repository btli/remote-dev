import { auth } from "@/auth";

/**
 * Protect /ccflare/* proxy routes with session auth.
 * The rewrite in next.config.ts maps these to the local ccflare server,
 * but without this middleware they would be publicly accessible.
 */
export default auth;

export const config = {
  matcher: ["/ccflare/:path*"],
};
