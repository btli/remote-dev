import { NextResponse } from "next/server";
import { auth } from "@/auth";
import * as TrashService from "@/services/trash-service";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/trash/:id - Get trash item details
 */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const item = await TrashService.getTrashItem(id, session.user.id);

    if (!item) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({ item });
  } catch (error) {
    console.error("Error getting trash item:", error);
    return NextResponse.json(
      { error: "Failed to get trash item" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/trash/:id - Permanently delete from trash
 */
export async function DELETE(request: Request, { params }: RouteParams) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    await TrashService.deleteTrashItem(id, session.user.id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting trash item:", error);

    if (error instanceof TrashService.TrashServiceError) {
      if (error.code === "NOT_FOUND") {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: "Failed to delete trash item" },
      { status: 500 }
    );
  }
}
