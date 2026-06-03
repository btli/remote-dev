export const dynamic = "force-dynamic";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { validateAccessJWT } from "@/lib/cf-access";
import { resolveSupervisorUser } from "@/lib/auth";
import { createLogger } from "@/lib/logger";

const log = createLogger("auth/mobile-callback");

/**
 * Supervisor host-scope mobile-callback — the discovery-bootstrap twin of the
 * instance route (src/app/auth/mobile-callback/page.tsx), minus the API-key step.
 *
 * The Supervisor has no API key to mint (it is a control plane, not a workspace),
 * so the Flutter app distinguishes this redirect by `scope=host` / the absence of
 * an `apiKey` param and stores the host-wide CF token. We only validate the
 * Supervisor's OWN CF Access JWT and derive identity from it.
 */
export default async function MobileCallbackPage() {
  const cookieStore = await cookies();
  const cfToken = cookieStore.get("CF_Authorization")?.value;

  if (!cfToken) {
    return <ErrorPage message="No Cloudflare Access token found. Please sign in first." />;
  }

  const cfUser = await validateAccessJWT(cfToken);
  if (!cfUser) {
    return <ErrorPage message="Your Cloudflare Access token is invalid or expired." />;
  }

  // Resolve (or create on first sight) the supervisor_user so the app receives a
  // stable userId, mirroring the instance route's user-row resolution. No API key
  // is minted — the host redirect carries scope=host + cfToken only.
  const user = await resolveSupervisorUser(cfUser.email);

  log.info("Host-scope mobile callback issued", {
    userId: user.id,
    email: user.email,
  });

  // Redirect to the deep link — the Flutter app intercepts this. NO apiKey:
  // scope=host signals a host (Supervisor) credential whose CF token is shared
  // across that host's workspaces; per-workspace API keys are issued separately.
  redirect(
    `remotedev://auth/callback?scope=host&cfToken=${encodeURIComponent(cfToken)}&userId=${encodeURIComponent(user.id)}&email=${encodeURIComponent(user.email ?? "")}`,
  );
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
