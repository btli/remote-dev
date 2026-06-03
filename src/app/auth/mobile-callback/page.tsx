export const dynamic = "force-dynamic";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { validateAccessJWT } from "@/lib/cloudflare-access";
import { createApiKey } from "@/services/api-key-service";
import { createLogger } from "@/lib/logger";
import { getOrCreateUserByEmail } from "@/lib/user-identity";

const log = createLogger("auth/mobile-callback");

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

  // Resolve via the multi-email index so any of the user's emails maps to the
  // same account (creates user + primary user_email row when unknown).
  const user = await getOrCreateUserByEmail(cfUser.email);

  // Use the standard createApiKey service (handles prefix + hash correctly)
  const result = await createApiKey(user.id, "Mobile App");

  log.info("Mobile API key issued via callback", {
    userId: user.id,
    email: user.email,
  });

  // Redirect to deep link — the Flutter app intercepts this.
  // Include the CF token so the app can send it as a cookie on API requests
  // (CF Access blocks requests without a valid CF_Authorization cookie).
  redirect(
    `remotedev://auth/callback?apiKey=${encodeURIComponent(result.key)}&userId=${encodeURIComponent(user.id)}&email=${encodeURIComponent(user.email ?? "")}&cfToken=${encodeURIComponent(cfToken)}`
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
