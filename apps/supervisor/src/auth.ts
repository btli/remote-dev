/**
 * NextAuth (Auth.js) v5 config for the Supervisor — OPTIONAL native OIDC login.
 *
 * This is the SECOND authentication path alongside Cloudflare Access (the CF
 * path in `src/lib/cf-access.ts` is unchanged). A request authenticates if it
 * carries a valid CF Access JWT OR a valid NextAuth OIDC session; the dual-auth
 * seam lives in `src/lib/auth.ts` (`resolveAuthenticatedEmail`). Both paths
 * resolve to an email → `resolveSupervisorUser` (the role mapping is unchanged).
 *
 * SECURITY — closed allowlist (THE rule): the `signIn` callback REJECTS an OIDC
 * login unless the email is already a known `supervisor_user` row OR equals the
 * seeded admin (`SUPERVISOR_ADMIN_EMAIL`). An IdP that authenticates an unknown
 * email does NOT get in. (The CF path keeps its current auto-viewer behavior —
 * that is intentionally NOT changed here.)
 *
 * The generic OIDC provider is registered ONLY when issuer + clientId +
 * clientSecret are all set; with none set, NextAuth has no providers and the
 * login page renders nothing to click (CF-only deploys are unaffected). The
 * provider id is the stable string `oidc` — the OAuth callback URL is therefore
 * `https://<host>/api/auth/callback/oidc`.
 */

import NextAuth from "next-auth";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  users,
  accounts,
  sessions,
  verificationTokens,
  supervisorUser,
} from "@/db/schema";
import { createLogger } from "@/lib/logger";
import type { Provider } from "next-auth/providers";

const log = createLogger("Auth");

/** Stable provider id → callback URL is `/api/auth/callback/oidc`. */
export const OIDC_PROVIDER_ID = "oidc";

/**
 * True when the generic OIDC provider is fully configured. Mirrors the
 * fail-closed computation in `src/instrumentation.ts`. AUTH_SECRET is required
 * to sign the JWT session cookie, so a usable OIDC login needs it too.
 */
export function isOidcConfigured(): boolean {
  return Boolean(
    process.env.SUPERVISOR_OIDC_ISSUER &&
      process.env.SUPERVISOR_OIDC_CLIENT_ID &&
      process.env.SUPERVISOR_OIDC_CLIENT_SECRET &&
      process.env.AUTH_SECRET,
  );
}

/** Human-readable label for the sign-in button (e.g. "Sign in with {name}"). */
export function oidcDisplayName(): string {
  return process.env.SUPERVISOR_OIDC_NAME || "SSO";
}

/**
 * Closed allowlist (THE security rule): decide whether an OIDC-authenticated
 * email is allowed to sign in. Allowed iff the email already exists as a
 * `supervisor_user` row OR equals the seeded admin (`SUPERVISOR_ADMIN_EMAIL`).
 * An IdP that authenticates an unknown email does NOT get in.
 *
 * Extracted from the NextAuth `signIn` callback so it is unit-testable without
 * instantiating NextAuth. Returns false (deny) on a missing email.
 */
export async function isOidcSignInAllowed(
  email: string | null | undefined,
): Promise<boolean> {
  if (!email) {
    log.warn("OIDC sign-in denied: no email in profile");
    return false;
  }

  const adminEmail = process.env.SUPERVISOR_ADMIN_EMAIL;
  if (adminEmail && email === adminEmail) {
    return true;
  }

  const known = await db.query.supervisorUser.findFirst({
    where: eq(supervisorUser.email, email),
  });
  if (known) {
    return true;
  }

  log.warn("OIDC sign-in denied: email not in supervisor allowlist", { email });
  return false;
}

/**
 * Build the providers array. Empty unless OIDC is configured, so CF-only
 * deploys register no NextAuth provider at all.
 */
function buildProviders(): Provider[] {
  if (!isOidcConfigured()) return [];
  return [
    {
      id: OIDC_PROVIDER_ID,
      name: oidcDisplayName(),
      type: "oidc",
      // Auto-discovery via `{issuer}/.well-known/openid-configuration`.
      issuer: process.env.SUPERVISOR_OIDC_ISSUER,
      clientId: process.env.SUPERVISOR_OIDC_CLIENT_ID,
      clientSecret: process.env.SUPERVISOR_OIDC_CLIENT_SECRET,
    },
  ];
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  // DrizzleAdapter persists the OIDC identity (user/account) + verification
  // tokens. Sessions are JWT (below), so the `sessions` table is unused for
  // session storage but wired for adapter completeness/parity with the root app.
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  session: { strategy: "jwt" },
  secret: process.env.AUTH_SECRET,
  providers: buildProviders(),
  callbacks: {
    // Closed allowlist: only let an OIDC identity in if its email is already a
    // known supervisor_user OR the configured admin (see isOidcSignInAllowed).
    async signIn({ user }) {
      return isOidcSignInAllowed(user.email);
    },
  },
  pages: {
    signIn: "/login",
  },
});
