import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import GitHub from "next-auth/providers/github";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { db } from "@/db";
import { users, accounts, sessions, verificationTokens, authorizedUsers } from "@/db/schema";
import { encrypt, decryptSafe } from "@/lib/encryption";
import type { Adapter, AdapterAccount } from "next-auth/adapters";

/**
 * Check if the request is from localhost (127.0.0.1 or ::1)
 * Used to restrict credentials auth to local development only
 */
/**
 * Wrap the DrizzleAdapter to encrypt OAuth tokens before storage
 * and decrypt them when reading.
 */
function createEncryptedAdapter(): Adapter {
  const baseAdapter = DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  });

  return {
    ...baseAdapter,
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

export const { handlers, signIn, signOut, auth } = NextAuth({
  adapter: createEncryptedAdapter(),
  session: { strategy: "jwt" },
  providers: [
    GitHub({
      clientId: process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_CLIENT_SECRET,
      authorization: {
        params: {
          // Request full repo access for cloning private repos and managing worktrees
          scope: "read:user user:email repo",
        },
      },
    }),
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
      },
      async authorize(credentials) {
        // Security: Only allow credentials auth from localhost
        // Remote access must use Cloudflare Access (JWT validated in getAuthSession)
        const isLocalhost = await isLocalhostRequest();
        if (!isLocalhost) {
          console.warn("Credentials auth attempted from non-localhost, rejecting");
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

        let user = await db.query.users.findFirst({
          where: eq(users.email, email),
        });

        if (!user) {
          const [newUser] = await db
            .insert(users)
            .values({
              email,
              name: email.split("@")[0],
            })
            .returning();
          user = newUser;
        }

        return {
          id: user.id,
          email: user.email,
          name: user.name,
        };
      },
    }),
  ],
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
      // For GitHub OAuth sign-in, check if user's email is authorized
      if (account?.provider === "github" && user.email) {
        const authorized = await db.query.authorizedUsers.findFirst({
          where: eq(authorizedUsers.email, user.email),
        });
        if (!authorized) {
          return false; // Block unauthorized users
        }
      }
      return true;
    },
  },
  pages: {
    signIn: "/login",
  },
});
