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
export default async function MobileCallbackPage() {
  const result = await resolveSupervisorMobileCallback();

  if (result.kind === "redirect") {
    redirect(result.url);
  }

  if (result.kind === "login") {
    redirect("/login?callbackUrl=%2Fauth%2Fmobile-callback");
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
