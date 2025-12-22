import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth-utils";
import * as GitHubService from "@/services/github-service";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/github/repositories/:id/folders - Get folder structure of a cloned repository
 */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const session = await getAuthSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const repository = await GitHubService.getRepository(id, session.user.id);

    if (!repository) {
      return NextResponse.json(
        { error: "Repository not found" },
        { status: 404 }
      );
    }

    if (!repository.localPath) {
      return NextResponse.json(
        { error: "Repository not cloned", code: "NOT_CLONED" },
        { status: 400 }
      );
    }

    const { searchParams } = new URL(request.url);
    const maxDepth = parseInt(searchParams.get("maxDepth") || "3", 10);

    const folders = GitHubService.getFolderStructure(
      repository.localPath,
      maxDepth
    );

    return NextResponse.json({
      folders,
      rootPath: repository.localPath,
    });
  } catch (error) {
    console.error("Error getting folder structure:", error);
    return NextResponse.json(
      { error: "Failed to get folder structure" },
      { status: 500 }
    );
  }
}
