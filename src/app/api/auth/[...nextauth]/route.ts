/**
 * NextAuth route handler.
 *
 * Plain mode (no `RDV_BASE_PATH`): re-export NextAuth's handlers verbatim.
 *
 * Multi-instance mode: Next.js strips the deployment prefix (`/alpha`) from
 * `req.nextUrl.pathname` before the route handler runs. AuthJS's
 * `parseActionAndProviderId` then tries to match `^/alpha(.+)` against the
 * stripped pathname (`/api/auth/csrf`) and throws `UnknownAction`. To keep a
 * single `basePath="/alpha"` value working for *both* AuthJS's inbound action
 * parsing *and* its outbound URL construction (the GitHub OAuth callback URL,
 * the `signinUrl` in `/api/auth/providers`, etc.), this wrapper rewrites the
 * inbound request to add the deployment prefix back before handing off to
 * AuthJS.
 *
 * See `src/auth.ts` for the full rationale and the Phase 2 design note. — Opus C-2 / AC-7.
 */

import { handlers } from "@/auth";
import { BASE_PATH } from "@/lib/base-path";
import { NextRequest } from "next/server";

type AuthHandler = (req: NextRequest) => Promise<Response> | Response;

function withBasePathRestored(handler: AuthHandler): AuthHandler {
  if (BASE_PATH === "") return handler;
  return async (req) => {
    const url = new URL(req.url);
    if (!url.pathname.startsWith(BASE_PATH + "/") && url.pathname !== BASE_PATH) {
      url.pathname = BASE_PATH + url.pathname;
      // Reconstruct via NextRequest so `req.nextUrl` (used internally by
      // next-auth's `reqWithEnvURL`) survives the rewrite. A plain `Request`
      // would lose Next-specific properties and crash AuthJS.
      const restored = new NextRequest(url.toString(), req);
      return handler(restored);
    }
    return handler(req);
  };
}

export const GET = withBasePathRestored(handlers.GET);
export const POST = withBasePathRestored(handlers.POST);
