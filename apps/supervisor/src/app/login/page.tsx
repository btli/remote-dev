export const dynamic = "force-dynamic";

import { signIn, isOidcConfigured, oidcDisplayName, OIDC_PROVIDER_ID } from "@/auth";
import { safeCallbackPath } from "@/lib/safe-callback-path";

/**
 * Supervisor login page — native OIDC sign-in.
 *
 * Minimal by design: a single "Sign in with {SUPERVISOR_OIDC_NAME}" button that
 * kicks off the NextAuth OIDC flow via a server action (the v5 server-side
 * `signIn`, which 302s to the IdP). The button renders ONLY when OIDC is
 * configured; on a CF-Access-only deploy there is nothing to click (access is
 * gated upstream by Cloudflare Access, so users never reach this page anyway).
 *
 * The closed-allowlist `signIn` callback in `src/auth.ts` still decides whether
 * the authenticated email is actually allowed in.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const oidcEnabled = isOidcConfigured();
  const sp = await searchParams;
  const redirectTo = safeCallbackPath(sp.callbackUrl) ?? "/";

  return (
    <main className="mx-auto flex min-h-svh max-w-md flex-col items-center justify-center px-6 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">
        Remote Dev Supervisor
      </h1>

      {oidcEnabled ? (
        <>
          <p className="mt-3 text-sm text-muted-foreground">
            Sign in to manage instances.
          </p>
          <form
            action={async () => {
              "use server";
              await signIn(OIDC_PROVIDER_ID, { redirectTo });
            }}
            className="mt-8 w-full"
          >
            <button
              type="submit"
              className="inline-flex h-10 w-full items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90"
            >
              Sign in with {oidcDisplayName()}
            </button>
          </form>
        </>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">
          Native sign-in is not configured. This UI is gated by Cloudflare
          Access; for local development set{" "}
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
            SUPERVISOR_ADMIN_EMAIL
          </code>{" "}
          in <code className="font-mono text-xs">.env.local</code>.
        </p>
      )}
    </main>
  );
}
