/**
 * Shared server-page auth helper. Resolves the current Supervisor operator for
 * a server-rendered page using the SAME dual-auth precedence as the API wrapper
 * (`withSupervisorAuth`): Cloudflare Access → NextAuth OIDC session → dev
 * SUPERVISOR_ADMIN_EMAIL fallback.
 *
 * Replaces the per-page `getCurrentUser()` that the dashboard / new-instance /
 * detail pages each duplicated. Those read CF tokens straight off `headers()`;
 * here we forward the inbound headers into a `Request` and delegate to
 * `resolveAuthenticatedEmail` so the CF path AND the OIDC session path are both
 * honored in one place, then map the email to a `supervisor_user` row.
 */

import { headers } from "next/headers";
import { resolveAuthenticatedEmail, resolveSupervisorUser } from "@/lib/auth";
import type { Role } from "@/lib/roles";
import { createLogger } from "@/lib/logger";

const log = createLogger("page/session");

export interface CurrentUser {
  id: string;
  email: string;
  role: Role;
}

/**
 * Resolve the current operator for a server component, or null when
 * unauthenticated. Never throws.
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  try {
    // Forward the inbound headers into a Request so `getAccessToken` (CF) sees
    // the same cookie / cf-access-jwt-assertion. The OIDC branch inside
    // `resolveAuthenticatedEmail` reads the session via Next's request context,
    // not this Request, so the URL here is irrelevant.
    const hdrs = await headers();
    const request = new Request("https://supervisor.internal/page", {
      headers: hdrs,
    });

    const email = await resolveAuthenticatedEmail(request);
    if (!email) return null;

    const user = await resolveSupervisorUser(email);
    return { id: user.id, email: user.email, role: user.role };
  } catch (error) {
    log.error("Failed to resolve current user", { error: String(error) });
    return null;
  }
}
