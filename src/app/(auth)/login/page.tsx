import LoginClient from "./login-client";

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
export default function LoginPage() {
  const oidcEnabled = Boolean(process.env.OIDC_ISSUER && process.env.OIDC_CLIENT_ID);
  // Prefer the public alias (also available client-side) but fall back to the
  // server-only label, defaulting to a neutral "OIDC".
  const oidcName = process.env.NEXT_PUBLIC_OIDC_NAME || process.env.OIDC_NAME || "OIDC";

  return <LoginClient oidcEnabled={oidcEnabled} oidcName={oidcName} />;
}
