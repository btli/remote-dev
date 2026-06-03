import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import GitHub from "next-auth/providers/github";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { db } from "@/db";
import { users, accounts, sessions, verificationTokens, authorizedUsers } from "@/db/schema";
import { encrypt, decryptSafe } from "@/lib/encryption";
import { createLogger } from "@/lib/logger";
import { GITHUB_SCOPE_STRING } from "@/lib/github-scopes";
import { buildScopedCookies } from "@/lib/auth-cookies";
import { BASE_PATH } from "@/lib/base-path";
import { getOrCreateUserByEmail, ensurePrimaryUserEmail } from "@/lib/user-identity";
import type { Adapter, AdapterAccount, AdapterUser } from "next-auth/adapters";
import type { Provider } from "next-auth/providers";

const log = createLogger("Auth");

/**
 * Stable provider id for the generic OIDC provider. Referenced everywhere the
 * id matters: the provider object, the `signIn` allowlist gate, the login
 * button (`signIn("oidc")`), and the OAuth callback URL
 * (`/api/auth/callback/oidc`).
 */
const OIDC_PROVIDER_ID = "oidc";

/**
 * Generic, env-driven OpenID Connect provider.
 *
 * Enabled only when `OIDC_ISSUER`, `OIDC_CLIENT_ID`, and `OIDC_CLIENT_SECRET`
 * are all set. Endpoints are auto-discovered from
 * `{OIDC_ISSUER}/.well-known/openid-configuration`. The display label
 * (`OIDC_NAME`, default "OIDC") is also surfaced to the client login button
 * via `NEXT_PUBLIC_OIDC_NAME`.
 *
 * Security: like GitHub, an OIDC sign-in is default-denied — the `signIn`
 * callback rejects it unless the user's email is present in `authorizedUsers`.
 * Returns `undefined` when not configured so the provider is simply omitted
 * from the list (no everyone-allowed branch is ever registered).
 */
function buildOidcProvider(): Provider | undefined {
  const issuer = process.env.OIDC_ISSUER;
  const clientId = process.env.OIDC_CLIENT_ID;
  const clientSecret = process.env.OIDC_CLIENT_SECRET;

  if (!issuer || !clientId || !clientSecret) {
    return undefined;
  }

  const name = process.env.OIDC_NAME || "OIDC";
  log.info("Generic OIDC provider enabled", { issuer, name });

  return {
    id: OIDC_PROVIDER_ID,
    name,
    type: "oidc",
    issuer,
    clientId,
    clientSecret,
    // Explicitly request the `email` claim. Many OIDC servers omit `email`
    // unless the scope is asked for — and the `signIn` allowlist gate
    // default-denies any sign-in that arrives without an email, so without
    // this scope a correctly-allowlisted user would be locked out.
    authorization: { params: { scope: "openid email profile" } },
    // Link an OIDC login to a pre-existing user with the same (IdP-verified)
    // email instead of erroring with OAuthAccountNotLinked. Safe in this
    // deployment: a single trusted self-hosted Authentik issues all identities,
    // emails are verified by the IdP, and the `signIn` callback already
    // default-denies any email not in the `authorized_user` allow-list. Without
    // this, seeded/pre-existing user rows (e.g. created by db seeding or the
    // getAuthSession auto-create path) block the user's first OIDC login.
    allowDangerousEmailAccountLinking: true,
  };
}

/**
 * Startup-time refusal: `ENABLE_LOCAL_CREDENTIALS=true` makes the Credentials
 * provider accept any allowlisted email without a password. That's the
 * intended behavior for local development, but a single Helm typo enabling
 * it on a production non-localhost deploy would turn every authorized email
 * into a passwordless backdoor. Refuse to start in that combination so a
 * mis-set env var fails loudly rather than silently.
 *
 * Triggered conditions: `ENABLE_LOCAL_CREDENTIALS=true` AND
 * `NODE_ENV=production` AND the `AUTH_URL` (or legacy `NEXTAUTH_URL`) does
 * NOT contain `localhost` or `127.0.0.1`.
 */
{
  const enableLocalCreds = process.env.ENABLE_LOCAL_CREDENTIALS === "true";
  // Treat empty strings as absent so callers can clear an inherited env
  // var without falling through past the second alias. `??` alone would
  // preserve `""`, which then fails the `!== ""` check below — but
  // important: a deliberately empty AUTH_URL should still let NEXTAUTH_URL
  // be consulted, so we OR the two and pick the first non-empty.
  const authUrl =
    (process.env.AUTH_URL && process.env.AUTH_URL !== "" ? process.env.AUTH_URL : undefined) ??
    (process.env.NEXTAUTH_URL && process.env.NEXTAUTH_URL !== "" ? process.env.NEXTAUTH_URL : undefined) ??
    "";
  const isProductionRemote =
    process.env.NODE_ENV === "production" &&
    authUrl !== "" &&
    !authUrl.includes("localhost") &&
    !authUrl.includes("127.0.0.1");

  if (enableLocalCreds && isProductionRemote) {
    log.error(
      "FATAL: ENABLE_LOCAL_CREDENTIALS=true is set on a production non-localhost deploy. " +
        "This would allow passwordless sign-in by anyone who knows an authorized email. Refusing to start.",
      { authUrl, NODE_ENV: process.env.NODE_ENV },
    );
    // Exit in real processes; vitest tests use `vi.spyOn(process, "exit")`
    // to assert without killing the test runner.
    process.exit(1);
  }

  if (enableLocalCreds) {
    log.warn(
      "ENABLE_LOCAL_CREDENTIALS=true — passwordless email sign-in is ENABLED. " +
        "This is acceptable for local development only. Do not set in production.",
    );
  }
}

/**
 * Check if the request is from localhost (127.0.0.1 or ::1)
 * Used to restrict credentials auth to local development only
 */
/**
 * Wrap the DrizzleAdapter to encrypt OAuth tokens before storage
 * and decrypt them when reading.
 */
function createEncryptedAdapter(): Adapter {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- DrizzleAdapter types lag behind drizzle-orm
  const baseAdapter = DrizzleAdapter(db as any, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- DrizzleAdapter types don't match our encrypted schema
  } as any);

  return {
    ...baseAdapter,
    // Override createUser to seed the primary user_email row alongside the
    // user the base adapter inserts (OAuth/OIDC first sign-in). Keeps the
    // multi-email resolution index complete for users created by NextAuth, not
    // just the CF-Access / credentials paths. Idempotent via UNIQUE(email).
    createUser: async (user: AdapterUser): Promise<AdapterUser> => {
      const created = await baseAdapter.createUser!(user);
      if (created.email) {
        await ensurePrimaryUserEmail(created.id, created.email);
      }
      return created;
    },
    // Override linkAccount to encrypt tokens before storage
    linkAccount: async (account: AdapterAccount): Promise<void> => {
      const encryptedAccount = {
        ...account,
        access_token: account.access_token ? encrypt(account.access_token) : undefined,
        refresh_token: account.refresh_token ? encrypt(account.refresh_token) : undefined,
      };
      await baseAdapter.linkAccount?.(encryptedAccount);
    },
    // Override getAccount to decrypt tokens after reading
    getAccount: async (providerAccountId: string, provider: string): Promise<AdapterAccount | null> => {
      const account = await baseAdapter.getAccount?.(providerAccountId, provider);
      if (!account) return null;
      return {
        ...account,
        access_token: decryptSafe(account.access_token ?? null) ?? undefined,
        refresh_token: decryptSafe(account.refresh_token ?? null) ?? undefined,
      };
    },
  };
}

/**
 * Check if the request is from localhost (127.0.0.1 or ::1)
 * Used to restrict credentials auth to local development only
 */
async function isLocalhostRequest(): Promise<boolean> {
  const headersList = await headers();

  // Check x-forwarded-for first (for proxied requests)
  const forwarded = headersList.get("x-forwarded-for");
  if (forwarded) {
    const firstIp = forwarded.split(",")[0].trim();
    return firstIp === "127.0.0.1" || firstIp === "::1" || firstIp === "localhost";
  }

  // Check x-real-ip
  const realIp = headersList.get("x-real-ip");
  if (realIp) {
    return realIp === "127.0.0.1" || realIp === "::1" || realIp === "localhost";
  }

  // For direct connections, Next.js doesn't expose the remote IP in headers
  // but if we're here without x-forwarded-for, we're likely on localhost
  // In production behind Cloudflare, x-forwarded-for will always be set
  return true;
}

// When RDV_BASE_PATH is unset, leave the `cookies` key out entirely so NextAuth
// applies its built-in defaults (preserves AC-1: byte-identical single-server
// behavior). When set, `buildScopedCookies` returns a fully-formed block that
// path-scopes every cookie to the instance basePath.
const scopedCookies = buildScopedCookies();

// AuthJS's internal `basePath` is overloaded — it's the prefix
// `parseActionAndProviderId` strips off the inbound request pathname AND the
// prefix `parseProviders` / `createActionURL` prepend when constructing the
// signinUrl, the GitHub OAuth callback URL, etc.
//
// Under multi-instance hosting that asymmetry between inbound and outbound
// breaks both endpoints in different ways:
//
//   * Outbound URLs need the *full* path AuthJS owns externally, including the
//     Next.js basePath: `/alpha/api/auth`. Otherwise GitHub gets registered
//     with `/api/auth/callback/github` and the OAuth round-trip 404s when
//     it redirects back (breaks AC-7).
//   * Inbound action parsing sees the pathname Next.js exposes to the route
//     handler after stripping `/alpha`: `/api/auth/csrf`. Matching that
//     against a `^/alpha/api/auth` prefix would fail.
//
// We resolve the tension by pinning AuthJS's `basePath` to the full external
// path (`BASE_PATH + "/api/auth"`) AND rewriting inbound requests in
// `src/app/api/auth/[...nextauth]/route.ts` to add `BASE_PATH` back to
// `req.nextUrl.pathname` before AuthJS sees them. Both sides then see the
// same `/alpha/api/auth/<action>` shape.
//
// next-auth's `setEnvDefaults` does `config.basePath ||= URL(AUTH_URL).pathname`
// which would yield just `/alpha` (no `/api/auth` suffix), so we set
// `basePath` explicitly here — `||=` preserves our value. The route-handler
// wrapper is the corresponding inbound side. (Opus C-2 / AC-7.)
const AUTH_BASE_PATH = `${BASE_PATH}/api/auth`;

// Provider list is assembled before the NextAuth() call so the generic OIDC
// provider can be conditionally appended only when fully configured. The
// `signIn` callback below independently default-denies it against the
// allowlist, so its mere presence never grants access by itself.
const oidcProvider = buildOidcProvider();

const providers: Provider[] = [
  GitHub({
    clientId: process.env.GITHUB_CLIENT_ID,
    clientSecret: process.env.GITHUB_CLIENT_SECRET,
    authorization: {
      params: {
        scope: GITHUB_SCOPE_STRING,
      },
    },
  }),
  Credentials({
    name: "credentials",
    credentials: {
      email: { label: "Email", type: "email" },
    },
    async authorize(credentials) {
      // Security: Only allow credentials auth from localhost.
      // Remote access must use Cloudflare Access (JWT validated in getAuthSession).
      //
      // The `ENABLE_LOCAL_CREDENTIALS` env var makes the gate deterministic
      // in containers, where the `x-forwarded-for` header reflects the
      // pod's loopback or the LB's IP rather than 127.0.0.1:
      //
      //   ENABLE_LOCAL_CREDENTIALS=true   → always allow (do NOT set in prod!)
      //   ENABLE_LOCAL_CREDENTIALS=false  → always deny (recommended for K8s)
      //   unset                           → fall back to 127.0.0.1 detection
      //
      // Default behavior (unset) preserves the existing local-dev flow.
      const explicit = process.env.ENABLE_LOCAL_CREDENTIALS;
      let credentialsAllowed: boolean;
      if (explicit === "true") {
        credentialsAllowed = true;
      } else if (explicit === "false") {
        credentialsAllowed = false;
      } else {
        credentialsAllowed = await isLocalhostRequest();
      }

      if (!credentialsAllowed) {
        log.warn("Credentials auth attempted from non-localhost or disabled via ENABLE_LOCAL_CREDENTIALS, rejecting");
        return null;
      }

      if (!credentials?.email) {
        return null;
      }

      const email = credentials.email as string;

      const authorized = await db.query.authorizedUsers.findFirst({
        where: eq(authorizedUsers.email, email),
      });

      if (!authorized) {
        return null;
      }

      // Resolve via the multi-email index (consistent with the CF Access path)
      // so any of a user's emails maps back to the same account, and a primary
      // user_email row is seeded when a brand-new user is created.
      const user = await getOrCreateUserByEmail(email);

      return {
        id: user.id,
        email: user.email,
        name: user.name,
      };
    },
  }),
];

// Generic OIDC is opt-in: append it only when env-configured. The allowlist
// gate in the `signIn` callback below is what actually authorizes users.
if (oidcProvider) {
  providers.push(oidcProvider);
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  adapter: createEncryptedAdapter(),
  session: { strategy: "jwt" },
  basePath: AUTH_BASE_PATH,
  ...(scopedCookies ? { cookies: scopedCookies } : {}),
  providers,
  callbacks: {
    async jwt({ token, user, account }) {
      if (user) {
        token.id = user.id;
      }
      // Store GitHub access token in JWT when user signs in with GitHub
      if (account?.provider === "github" && account.access_token) {
        token.githubAccessToken = account.access_token;
      }
      return token;
    },
    async session({ session, token }) {
      if (token.id) {
        session.user.id = token.id as string;
      }
      return session;
    },
    async signIn({ user, account }) {
      // Default-deny gate for OAuth/OIDC sign-in: only emails present in
      // `authorizedUsers` may sign in via GitHub or the generic OIDC provider.
      // (Credentials is gated separately inside its own `authorize()`.)
      if (account?.provider === "github" || account?.provider === OIDC_PROVIDER_ID) {
        // No email means we cannot check the allowlist — deny. Some OIDC
        // servers omit `email` unless its scope is requested; failing open
        // here would admit anyone whose IdP returns no email claim.
        if (!user.email) {
          return false;
        }
        const authorized = await db.query.authorizedUsers.findFirst({
          where: eq(authorizedUsers.email, user.email),
        });
        return !!authorized; // Allow only allowlisted emails
      }
      return true;
    },
  },
  pages: {
    // Must be the FULL external path (BASE_PATH-prefixed): Next.js basePath is
    // NOT auto-applied to NextAuth's own redirect Location headers, so a bare
    // "/login" would resolve to the cluster root (the supervisor) instead of
    // this instance's "/<slug>/login" — which is what caused auth errors (e.g.
    // OAuthAccountNotLinked) to bounce to the wrong app. Mirrors AUTH_BASE_PATH
    // above. BASE_PATH is "" for single-server, leaving "/login" unchanged.
    signIn: `${BASE_PATH}/login`,
  },
});
