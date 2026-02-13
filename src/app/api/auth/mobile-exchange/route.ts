/**
 * Mobile Auth Exchange Endpoint
 *
 * Exchanges a Cloudflare Access JWT token for an API key.
 * Used by the mobile app after CF Access browser authentication.
 */

import { createHash, randomBytes } from "crypto";

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { users, apiKeys } from "@/db/schema";
import { validateAccessJWT } from "@/lib/cloudflare-access";

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

    const keyHash = hashApiKey(fullKey);

    // Revoke existing mobile keys so each login gets a fresh key
    await db.delete(apiKeys).where(
      and(eq(apiKeys.userId, user.id), eq(apiKeys.keyPrefix, keyPrefix))
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

function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}
