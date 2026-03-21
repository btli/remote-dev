import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { users } from "@/db/schema";
import { validateAccessJWT } from "@/lib/cloudflare-access";
import { createApiKey } from "@/services/api-key-service";
import { createLogger } from "@/lib/logger";

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

  // Get or create user
  let user = await db.query.users.findFirst({
    where: eq(users.email, cfUser.email),
  });

  if (!user) {
    const [newUser] = await db
      .insert(users)
      .values({
        id: crypto.randomUUID(),
        email: cfUser.email,
        name: cfUser.email.split("@")[0],
      })
      .returning();
    user = newUser;
  }

  // Use the standard createApiKey service (handles prefix + hash correctly)
  const result = await createApiKey(user.id, "Mobile App");

  log.info("Mobile API key issued via callback", {
    userId: user.id,
    email: user.email,
  });

  // Redirect to deep link — the Flutter app intercepts this
  redirect(
    `remotedev://auth/callback?apiKey=${encodeURIComponent(result.key)}&userId=${encodeURIComponent(user.id)}&email=${encodeURIComponent(user.email ?? "")}`
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
