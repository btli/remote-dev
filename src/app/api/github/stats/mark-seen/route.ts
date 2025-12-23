/**
 * POST /api/github/stats/mark-seen - Mark changes as seen
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import * as CacheService from "@/services/cache-service";

interface MarkSeenRequest {
  repositoryId?: string; // Optional: specific repo, or all if omitted
}

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Unauthorized", code: "UNAUTHORIZED" },
        { status: 401 }
      );
    }

    const body = (await request.json()) as MarkSeenRequest;

    if (body.repositoryId) {
      await CacheService.markChangesSeen(session.user.id, body.repositoryId);
    } else {
      await CacheService.markAllChangesSeen(session.user.id);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error marking changes as seen:", error);
    const err = error as Error;
    return NextResponse.json(
      { error: err.message, code: "MARK_SEEN_ERROR" },
      { status: 500 }
    );
  }
}
