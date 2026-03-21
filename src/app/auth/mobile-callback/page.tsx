import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createHash, randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { users, apiKeys } from "@/db/schema";
import { validateAccessJWT } from "@/lib/cloudflare-access";
import { createLogger } from "@/lib/logger";

const log = createLogger("auth/mobile-callback");

export default async function MobileCallbackPage() {
  const cookieStore = await cookies();
  const cfToken = cookieStore.get("CF_Authorization")?.value;

  if (!cfToken) {
    return (
      <div style={styles.container}>
        <h1 style={styles.title}>Authentication Required</h1>
        <p style={styles.text}>
          No Cloudflare Access token found. Please sign in first.
        </p>
      </div>
    );
  }

  // Validate the CF Access JWT
  const cfUser = await validateAccessJWT(cfToken);
  if (!cfUser) {
    return (
      <div style={styles.container}>
        <h1 style={styles.title}>Invalid Token</h1>
        <p style={styles.text}>
          Your Cloudflare Access token is invalid or expired.
        </p>
      </div>
    );
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

  // Generate API key
  const keyPrefix = "rdv_mobile_";
  const keyValue = randomBytes(32).toString("base64url");
  const fullKey = `${keyPrefix}${keyValue}`;
  const keyHash = createHash("sha256").update(fullKey).digest("hex");

  // Revoke existing mobile keys
  await db
    .delete(apiKeys)
    .where(
      and(eq(apiKeys.userId, user.id), eq(apiKeys.keyPrefix, keyPrefix))
    );

  // Store the new API key
  await db.insert(apiKeys).values({
    id: crypto.randomUUID(),
    userId: user.id,
    name: "Mobile App",
    keyHash,
    keyPrefix,
    expiresAt: null,
    createdAt: new Date(),
    lastUsedAt: null,
  });

  log.info("Mobile API key issued via callback", {
    userId: user.id,
    email: user.email,
  });

  // Redirect to deep link — the Flutter app intercepts this
  redirect(
    `remotedev://auth/callback?apiKey=${encodeURIComponent(fullKey)}&userId=${encodeURIComponent(user.id)}&email=${encodeURIComponent(user.email ?? "")}`
  );
}

const styles = {
  container: {
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    justifyContent: "center",
    minHeight: "100vh",
    padding: "24px",
    backgroundColor: "#1a1b26",
    color: "#c0caf5",
    fontFamily: "system-ui, sans-serif",
  },
  title: {
    fontSize: "24px",
    fontWeight: "bold" as const,
    marginBottom: "12px",
  },
  text: {
    fontSize: "16px",
    color: "#a9b1d6",
    textAlign: "center" as const,
  },
};
