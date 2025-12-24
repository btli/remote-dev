import { NextResponse } from "next/server";
import { withAuth, errorResponse } from "@/lib/api";
import {
  getRecording,
  getParsedRecording,
  updateRecording,
  deleteRecording,
} from "@/services/recording-service";
import type { UpdateRecordingInput } from "@/types/recording";

export const GET = withAuth(async (request, { userId, params }) => {
  // Check if parsed data is requested
  const url = new URL(request.url);
  const parsed = url.searchParams.get("parsed") === "true";

  if (parsed) {
    const recording = await getParsedRecording(params!.id, userId);
    if (!recording) {
      return errorResponse("Recording not found", 404);
    }
    return NextResponse.json(recording);
  }

  const recording = await getRecording(params!.id, userId);
  if (!recording) {
    return errorResponse("Recording not found", 404);
  }
  return NextResponse.json(recording);
});

export const PATCH = withAuth(async (request, { userId, params }) => {
  const body = (await request.json()) as UpdateRecordingInput;
  const recording = await updateRecording(params!.id, userId, body);

  if (!recording) {
    return errorResponse("Recording not found", 404);
  }

  return NextResponse.json(recording);
});

export const DELETE = withAuth(async (_request, { userId, params }) => {
  const deleted = await deleteRecording(params!.id, userId);

  if (!deleted) {
    return errorResponse("Recording not found", 404);
  }

  return NextResponse.json({ success: true });
});
