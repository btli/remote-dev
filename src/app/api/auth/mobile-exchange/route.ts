/**
 * Mobile Auth Exchange Endpoint
 *
 * Exchanges a Cloudflare Access JWT token for an API key.
 * Used by the mobile app after CF Access browser authentication.
 */

import { NextResponse } from "next/server";
import { createLogger } from "@/lib/logger";

import { validateAccessJWT } from "@/lib/cloudflare-access";
import { createApiKey } from "@/services/api-key-service";
import { getOrCreateUserByEmail } from "@/lib/user-identity";

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

    // Resolve via the multi-email index so any of the user's emails maps to the
    // same account (creates user + primary user_email row when unknown).
    const user = await getOrCreateUserByEmail(cfUser.email);

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
