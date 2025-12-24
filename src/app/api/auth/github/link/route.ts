import { NextResponse } from "next/server";
import { withAuth, errorResponse } from "@/lib/api";

export const GET = withAuth(async (_request, { userId }) => {
  // Redirect to GitHub OAuth with state parameter to indicate this is an account link
  const clientId = process.env.GITHUB_CLIENT_ID;
  if (!clientId) {
    return errorResponse("GitHub OAuth not configured", 500);
  }

  const redirectUri = `${process.env.NEXTAUTH_URL || "http://localhost:3000"}/api/auth/github/callback`;
  const scope = "read:user user:email repo";
  const state = Buffer.from(
    JSON.stringify({
      userId,
      action: "link",
    })
  ).toString("base64");

  const githubAuthUrl = new URL("https://github.com/login/oauth/authorize");
  githubAuthUrl.searchParams.set("client_id", clientId);
  githubAuthUrl.searchParams.set("redirect_uri", redirectUri);
  githubAuthUrl.searchParams.set("scope", scope);
  githubAuthUrl.searchParams.set("state", state);

  return NextResponse.redirect(githubAuthUrl.toString());
});
