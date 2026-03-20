import { NextResponse } from "next/server";
import { withAuth, errorResponse } from "@/lib/api";
import { createSignedState } from "@/lib/oauth-state";
import { GITHUB_SCOPE_STRING } from "@/lib/github-scopes";

export const GET = withAuth(async (_request, { userId }) => {
  // Redirect to GitHub OAuth with state parameter to indicate this is an account link
  const clientId = process.env.GITHUB_CLIENT_ID;
  if (!clientId) {
    return errorResponse("GitHub OAuth not configured", 500);
  }

  const redirectUri = `${process.env.NEXTAUTH_URL || "http://localhost:3000"}/api/auth/github/callback`;

  // Use HMAC-signed state to prevent CSRF attacks
  const state = createSignedState(userId, "link");

  const githubAuthUrl = new URL("https://github.com/login/oauth/authorize");
  githubAuthUrl.searchParams.set("client_id", clientId);
  githubAuthUrl.searchParams.set("redirect_uri", redirectUri);
  githubAuthUrl.searchParams.set("scope", GITHUB_SCOPE_STRING);
  githubAuthUrl.searchParams.set("state", state);
  // Force GitHub to show the account picker instead of silently re-authing
  githubAuthUrl.searchParams.set("prompt", "select_account");

  return NextResponse.redirect(githubAuthUrl.toString());
});
