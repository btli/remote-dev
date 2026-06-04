import { redirect } from "next/navigation";
import { getAuthSession } from "@/lib/auth-utils";
import { safeCallbackPath } from "@/lib/safe-callback-path";
import LoginClient from "./login-client";

// Re-exported for tests that assert the sanitizer behavior without importing
// this server component (which pulls in NextAuth). The implementation lives in
// `@/lib/safe-callback-path`.
export { safeCallbackPath };

/**
 * Server component: resolves whether the generic OIDC provider is configured
 * and its display label, then hands them to the client login form. Reading
 * the gate on the server keeps the "Sign in with {OIDC_NAME}" button in step
 * with the provider registered in `src/auth.ts`.
 *
 * The button gate is derived from the two non-secret vars (issuer + client id)
 * only — never `OIDC_CLIENT_SECRET` — so the UI is not coupled to the secret.
 * If the secret is missing, `src/auth.ts` simply won't register the provider
 * and the OIDC callback returns an error, but no secret is read here.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Authoritative "already logged in → go home" redirect. In scoped instance
  // mode the edge proxy runs in a separate Next-standalone realm without
  // AUTH_SECRET/AUTH_URL, so it cannot validate the session and deliberately
  // lets /login render (see the `!scoped` guard in src/proxy.ts). This server
  // component DOES have the correct env + crypto, so it makes the real call
  // here — otherwise a user returning from the OIDC round-trip would land back
  // on /login with a valid session and appear stuck in a login loop. Mirrors
  // the inverse check on the Home page (src/app/page.tsx). redirect("/") is
  // basePath-aware via next.config.ts, so it resolves to "/<slug>".
  const session = await getAuthSession();
  if (session?.user?.id) {
    redirect("/");
  }

  const oidcEnabled = Boolean(process.env.OIDC_ISSUER && process.env.OIDC_CLIENT_ID);
  // Prefer the public alias (also available client-side) but fall back to the
  // server-only label, defaulting to a neutral "OIDC".
  const oidcName = process.env.NEXT_PUBLIC_OIDC_NAME || process.env.OIDC_NAME || "OIDC";

  const sp = await searchParams;
  const callbackUrl = safeCallbackPath(sp.callbackUrl);

  return (
    <LoginClient
      oidcEnabled={oidcEnabled}
      oidcName={oidcName}
      callbackUrl={callbackUrl}
    />
  );
}
