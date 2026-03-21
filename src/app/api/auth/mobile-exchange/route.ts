/**
 * Mobile Auth Exchange Endpoint
 *
 * Exchanges a Cloudflare Access JWT token for an API key.
 * Used by the mobile app after CF Access browser authentication.
 */

import { NextResponse } from "next/server";
import { createLogger } from "@/lib/logger";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { users } from "@/db/schema";
import { validateAccessJWT } from "@/lib/cloudflare-access";
import { createApiKey } from "@/services/api-key-service";

const log = createLogger("api/auth");

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

    // Use the standard createApiKey service (handles prefix + hash correctly)
    const result = await createApiKey(user.id, "Mobile App");

    return NextResponse.json({
      apiKey: result.key,
      userId: user.id,
      email: user.email,
    });
  } catch (error) {
    log.error("Mobile exchange error", { error: String(error) });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
