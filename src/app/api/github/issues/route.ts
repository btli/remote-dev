import { NextResponse } from "next/server";
import { withApiAuth, errorResponse } from "@/lib/api";
import * as GitHubService from "@/services/github-service";

/**
 * POST /api/github/issues - Create a new issue
 *
 * Body:
 * - owner: string (required) - Repository owner
 * - repo: string (required) - Repository name
 * - title: string (required) - Issue title
 * - body?: string (optional) - Issue body/description
 * - labels?: string[] (optional) - Labels to add
 * - assignees?: string[] (optional) - Usernames to assign
 */
export const POST = withApiAuth(async (request, { userId }) => {
  try {
    const body = await request.json();
    const { owner, repo, title, body: issueBody, labels, assignees } = body;

    if (!owner || !repo) {
      return errorResponse("Owner and repo are required", 400, "MISSING_PARAMS");
    }

    if (!title?.trim()) {
      return errorResponse("Title is required", 400, "TITLE_REQUIRED");
    }

    // Get access token
    const accessToken = await GitHubService.getAccessToken(userId);
    if (!accessToken) {
      return errorResponse(
        "GitHub not connected. Link your GitHub account first.",
        400,
        "GITHUB_NOT_CONNECTED"
      );
    }

    // Create issue via GitHub API
    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/issues`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: title.trim(),
          body: issueBody?.trim() || undefined,
          labels: labels || undefined,
          assignees: assignees || undefined,
        }),
      }
    );

    if (!response.ok) {
      const error = await response.json();
      return errorResponse(
        error.message || "Failed to create issue",
        response.status,
        "GITHUB_API_ERROR"
      );
    }

    const issue = await response.json();

    return NextResponse.json({
      success: true,
      issue: {
        id: issue.id,
        number: issue.number,
        title: issue.title,
        htmlUrl: issue.html_url,
        state: issue.state,
      },
    });
  } catch (error) {
    console.error("Error creating issue:", error);
    return errorResponse("Failed to create issue", 500);
  }
});
