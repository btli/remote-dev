import { NextResponse } from "next/server";
import { withAuth, errorResponse } from "@/lib/api";
import { getRecordings, createRecording } from "@/services/recording-service";
import type { CreateRecordingInput } from "@/types/recording";

export const GET = withAuth(async (_request, { userId }) => {
  const recordings = await getRecordings(userId);
  return NextResponse.json(recordings);
});

export const POST = withAuth(async (request, { userId }) => {
  const body = (await request.json()) as CreateRecordingInput;

  if (!body.name || !body.data || typeof body.duration !== "number") {
    return errorResponse("Missing required fields: name, data, duration", 400);
  }

  const recording = await createRecording(userId, body);
  return NextResponse.json(recording, { status: 201 });
});
