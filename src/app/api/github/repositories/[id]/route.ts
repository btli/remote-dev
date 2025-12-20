import { NextResponse } from "next/server";
import { auth } from "@/auth";
import * as GitHubService from "@/services/github-service";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/github/repositories/:id - Get a single repository
 */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const session = await auth();
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

    return NextResponse.json(repository);
  } catch (error) {
    console.error("Error getting repository:", error);
    return NextResponse.json(
      { error: "Failed to get repository" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/github/repositories/:id - Clone repository to local cache
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const accessToken = await GitHubService.getAccessToken(session.user.id);
    if (!accessToken) {
      return NextResponse.json(
        { error: "GitHub not connected" },
        { status: 400 }
      );
    }

    const { id } = await params;
    const repository = await GitHubService.getRepository(id, session.user.id);

    if (!repository) {
      return NextResponse.json(
        { error: "Repository not found" },
        { status: 404 }
      );
    }

    // Clone the repository
    const result = await GitHubService.cloneRepository(
      accessToken,
      repository.fullName
    );

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || "Clone failed" },
        { status: 500 }
      );
    }

    // Update the local path in database
    await GitHubService.updateLocalPath(id, result.localPath);

    return NextResponse.json({
      success: true,
      localPath: result.localPath,
    });
  } catch (error) {
    console.error("Error cloning repository:", error);
    return NextResponse.json(
      { error: "Failed to clone repository" },
      { status: 500 }
    );
  }
}
