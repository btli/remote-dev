import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth-utils";
import {
  getRecording,
  getParsedRecording,
  updateRecording,
  deleteRecording,
} from "@/services/recording-service";
import type { UpdateRecordingInput } from "@/types/recording";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(request: Request, { params }: RouteParams) {
  const session = await getAuthSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  try {
    // Check if parsed data is requested
    const url = new URL(request.url);
    const parsed = url.searchParams.get("parsed") === "true";

    if (parsed) {
      const recording = await getParsedRecording(id, session.user.id);
      if (!recording) {
        return NextResponse.json(
          { error: "Recording not found" },
          { status: 404 }
        );
      }
      return NextResponse.json(recording);
    }

    const recording = await getRecording(id, session.user.id);
    if (!recording) {
      return NextResponse.json(
        { error: "Recording not found" },
        { status: 404 }
      );
    }
    return NextResponse.json(recording);
  } catch (error) {
    console.error("Failed to get recording:", error);
    return NextResponse.json(
      { error: "Failed to get recording" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request, { params }: RouteParams) {
  const session = await getAuthSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  try {
    const body = (await request.json()) as UpdateRecordingInput;
    const recording = await updateRecording(id, session.user.id, body);

    if (!recording) {
      return NextResponse.json(
        { error: "Recording not found" },
        { status: 404 }
      );
    }

    return NextResponse.json(recording);
  } catch (error) {
    console.error("Failed to update recording:", error);
    return NextResponse.json(
      { error: "Failed to update recording" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request, { params }: RouteParams) {
  const session = await getAuthSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  try {
    const deleted = await deleteRecording(id, session.user.id);

    if (!deleted) {
      return NextResponse.json(
        { error: "Recording not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete recording:", error);
    return NextResponse.json(
      { error: "Failed to delete recording" },
      { status: 500 }
    );
  }
}
