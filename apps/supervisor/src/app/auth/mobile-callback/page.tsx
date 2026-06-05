export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";

import { resolveSupervisorMobileCallback } from "@/lib/mobile-callback";

/**
 * Supervisor host-scope mobile-callback — the discovery-bootstrap twin of the
 * instance route (src/app/auth/mobile-callback/page.tsx), minus the API-key step.
 *
 * The Supervisor has no API key to mint (it is a control plane, not a workspace),
 * so the Flutter app distinguishes this redirect by `scope=host` / the absence of
 * an `apiKey` param and stores the host-wide auth cookies. Supports both CF Access
 * (legacy `cfToken` + `authCookies`) and native OIDC (`authCookies` only).
 *
 * All identity resolution and deep-link construction live in
 * `src/lib/mobile-callback.ts` (testable without a browser).
 */
export default async function MobileCallbackPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  // Anti-hijack nonce the app generated for THIS login attempt (remote-dev-gkuo).
  // Echoed unchanged on the deep link so the app rejects callbacks it didn't
  // initiate. Absent for older app builds (then nothing is echoed).
  const rawState = sp.state;
  const state = Array.isArray(rawState) ? rawState[0] : rawState;

  const result = await resolveSupervisorMobileCallback({ state });

  if (result.kind === "redirect") {
    redirect(result.url);
  }

  if (result.kind === "login") {
    // Preserve `state` across the login round-trip: NextAuth returns the user to
    // this `callbackUrl` after sign-in, so the nonce must ride inside it (the
    // top-level query param is dropped during the OIDC bounce). `safeCallbackPath`
    // on the login page accepts this relative path + query as a same-origin
    // redirect.
    const inner =
      "/auth/mobile-callback" +
      (state ? `?state=${encodeURIComponent(state)}` : "");
    redirect(`/login?callbackUrl=${encodeURIComponent(inner)}`);
  }

  // kind === "error"
  return <ErrorPage message={result.message} />;
}

function ErrorPage({ message }: { message: string }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        padding: "24px",
        backgroundColor: "#1a1b26",
        color: "#c0caf5",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <h1 style={{ fontSize: "24px", fontWeight: "bold", marginBottom: "12px" }}>
        Authentication Error
      </h1>
      <p style={{ fontSize: "16px", color: "#a9b1d6", textAlign: "center" }}>
        {message}
      </p>
    </div>
  );
}
