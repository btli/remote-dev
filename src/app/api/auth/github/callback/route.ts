import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { accounts } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { validateSignedState } from "@/lib/oauth-state";
import { encrypt } from "@/lib/encryption";
import { linkGitHubAccountUseCase } from "@/infrastructure/container";
import { createLogger } from "@/lib/logger";
import { prefixPath } from "@/lib/base-path";

const log = createLogger("api/auth");

/**
 * Build a same-origin redirect URL that respects `RDV_BASE_PATH`.
 *
 * Next.js strips the deployment prefix (`/alpha`) from `request.url` before
 * route handlers run, so `new URL("/?error=...", request.url)` would build
 * `https://host/?error=...` and drop the user into the wrong instance (or
 * a 404 if no landing app sits at the bare root). Prefixing here keeps the
 * user inside the instance.
 */
function buildRedirect(request: NextRequest, target: string): URL {
  return new URL(prefixPath(target), request.url);
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get("code");
  const state = searchParams.get("state");

  if (!code || !state) {
    return NextResponse.redirect(buildRedirect(request, "/?error=missing_params"));
  }

  // Validate HMAC-signed state to prevent CSRF attacks
  const stateResult = validateSignedState(state);
  if (!stateResult.valid) {
    log.warn("OAuth state validation failed", { error: stateResult.error });
    return NextResponse.redirect(buildRedirect(request, `/?error=${encodeURIComponent(stateResult.error)}`));
  }

  const stateData = stateResult.payload;

  if (stateData.action !== "link") {
    return NextResponse.redirect(buildRedirect(request, "/?error=invalid_action"));
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
    log.error("GitHub token error", { error: String(tokenData.error) });
    return NextResponse.redirect(buildRedirect(request, "/?error=github_auth_failed"));
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
    return NextResponse.redirect(buildRedirect(request, "/?error=github_user_fetch_failed"));
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
      buildRedirect(request, "/?error=github_already_linked")
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

  // Link GitHub account metadata and provision gh CLI config
  try {
    await linkGitHubAccountUseCase.execute({
      userId: stateData.userId,
      providerAccountId: String(githubUser.id),
      login: githubUser.login,
      displayName: githubUser.name ?? null,
      avatarUrl: githubUser.avatar_url,
      email: githubUser.email ?? null,
      accessToken: access_token,
    });
  } catch (error) {
    log.error("Failed to link GitHub account metadata", { error: String(error) });
    // Non-fatal: the OAuth account was already saved above
  }

  return NextResponse.redirect(buildRedirect(request, "/?github=connected"));
}
