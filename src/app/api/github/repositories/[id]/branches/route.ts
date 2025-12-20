import { NextResponse } from "next/server";
import { auth } from "@/auth";
import * as GitHubService from "@/services/github-service";
import * as WorktreeService from "@/services/worktree-service";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/github/repositories/:id/branches - Get branches for a repository
 * Note: :id is the GitHub repository ID (number), not the internal database ID
 */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const githubId = parseInt(id, 10);

    if (isNaN(githubId)) {
      return NextResponse.json(
        { error: "Invalid repository ID" },
        { status: 400 }
      );
    }

    const repository = await GitHubService.getRepositoryByGitHubId(githubId, session.user.id);

    if (!repository) {
      return NextResponse.json(
        { error: "Repository not found" },
        { status: 404 }
      );
    }

    // If we have a local path, get branches from the local repo
    if (repository.localPath) {
      const branches = await WorktreeService.getBranches(repository.localPath);
      return NextResponse.json({ branches });
    }

    // Otherwise, fetch from GitHub API
    const accessToken = await GitHubService.getAccessToken(session.user.id);
    if (!accessToken) {
      return NextResponse.json(
        { error: "GitHub not connected" },
        { status: 400 }
      );
    }

    const [owner, repo] = repository.fullName.split("/");
    const apiBranches = await GitHubService.listBranchesFromAPI(
      accessToken,
      owner,
      repo
    );

    const branches = apiBranches.map((b) => ({
      name: b.name,
      isRemote: false,
      isDefault: b.name === repository.defaultBranch,
    }));

    return NextResponse.json({ branches });
  } catch (error) {
    console.error("Error listing branches:", error);
    return NextResponse.json(
      { error: "Failed to list branches" },
      { status: 500 }
    );
  }
}
