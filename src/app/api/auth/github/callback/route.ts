import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { accounts } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { validateSignedState } from "@/lib/oauth-state";
import { encrypt } from "@/lib/encryption";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get("code");
  const state = searchParams.get("state");

  if (!code || !state) {
    return NextResponse.redirect(new URL("/?error=missing_params", request.url));
  }

  // Validate HMAC-signed state to prevent CSRF attacks
  const stateResult = validateSignedState(state);
  if (!stateResult.valid) {
    console.warn("OAuth state validation failed:", stateResult.error);
    return NextResponse.redirect(new URL(`/?error=${stateResult.error}`, request.url));
  }

  const stateData = stateResult.payload;

  if (stateData.action !== "link") {
    return NextResponse.redirect(new URL("/?error=invalid_action", request.url));
  }

  // Exchange code for access token
  const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      client_id: process.env.GITHUB_CLIENT_ID,
      client_secret: process.env.GITHUB_CLIENT_SECRET,
      code,
    }),
  });

  const tokenData = await tokenResponse.json();

  if (tokenData.error) {
    console.error("GitHub token error:", tokenData);
    return NextResponse.redirect(new URL("/?error=github_auth_failed", request.url));
  }

  const { access_token, token_type, scope } = tokenData;

  // Get GitHub user info
  const userResponse = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${access_token}`,
      Accept: "application/vnd.github.v3+json",
    },
  });

  const githubUser = await userResponse.json();

  if (!githubUser.id) {
    return NextResponse.redirect(new URL("/?error=github_user_fetch_failed", request.url));
  }

  // Check if this GitHub account is already linked to another user
  const existingAccount = await db.query.accounts.findFirst({
    where: and(
      eq(accounts.provider, "github"),
      eq(accounts.providerAccountId, String(githubUser.id))
    ),
  });

  if (existingAccount && existingAccount.userId !== stateData.userId) {
    return NextResponse.redirect(
      new URL("/?error=github_already_linked", request.url)
    );
  }

  // Encrypt access token before storage for security
  const encryptedToken = encrypt(access_token);

  // Upsert the account link
  if (existingAccount) {
    // Update existing account using composite key
    await db
      .update(accounts)
      .set({
        access_token: encryptedToken,
        token_type,
        scope,
      })
      .where(
        and(
          eq(accounts.provider, "github"),
          eq(accounts.providerAccountId, String(githubUser.id))
        )
      );
  } else {
    // Create new account link
    await db.insert(accounts).values({
      userId: stateData.userId,
      type: "oauth",
      provider: "github",
      providerAccountId: String(githubUser.id),
      access_token: encryptedToken,
      token_type,
      scope,
    });
  }

  return NextResponse.redirect(new URL("/?github=connected", request.url));
}
