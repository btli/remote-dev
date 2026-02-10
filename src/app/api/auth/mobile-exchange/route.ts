/**
 * Mobile Auth Exchange Endpoint
 *
 * Exchanges a Cloudflare Access JWT token for an API key.
 * Used by the mobile app after CF Access browser authentication.
 */

import { NextResponse } from "next/server";
import { db } from "@/db";
import { users, apiKeys } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { validateAccessJWT } from "@/lib/auth-utils";
import { randomBytes } from "crypto";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { cfToken } = body;

    if (!cfToken || typeof cfToken !== "string") {
      return NextResponse.json(
        { error: "Missing cfToken" },
        { status: 400 }
      );
    }

    // Validate the Cloudflare Access JWT
    const cfUser = await validateAccessJWT(cfToken);
    if (!cfUser) {
      return NextResponse.json(
        { error: "Invalid Cloudflare Access token" },
        { status: 401 }
      );
    }

    // Get or create user
    let user = await db.query.users.findFirst({
      where: eq(users.email, cfUser.email),
    });

    if (!user) {
      // Create new user
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

    // Generate API key for mobile app
    const keyPrefix = "rdv_mobile_";
    const keyValue = randomBytes(32).toString("base64url");
    const fullKey = `${keyPrefix}${keyValue}`;

    // Hash the key for storage (we'll return the unhashed version once)
    const keyHash = await hashApiKey(fullKey);

    // Revoke any existing mobile app keys for this user (prevents key accumulation)
    // Each new login gets a fresh key, invalidating old devices
    await db.delete(apiKeys).where(
      sql`${apiKeys.userId} = ${user.id} AND ${apiKeys.keyPrefix} = 'rdv_mobile_'`
    );

    // Store the new API key
    await db.insert(apiKeys).values({
      id: crypto.randomUUID(),
      userId: user.id,
      name: "Mobile App",
      keyHash,
      keyPrefix,
      expiresAt: null, // Mobile keys don't expire
      createdAt: new Date(),
      lastUsedAt: null,
    });

    return NextResponse.json({
      apiKey: fullKey,
      userId: user.id,
      email: user.email,
    });
  } catch (error) {
    console.error("Mobile exchange error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * Hash an API key for secure storage.
 */
async function hashApiKey(key: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(key);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}
