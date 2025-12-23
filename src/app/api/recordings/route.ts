import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth-utils";
import { getRecordings, createRecording } from "@/services/recording-service";
import type { CreateRecordingInput } from "@/types/recording";

export async function GET() {
  const session = await getAuthSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const recordings = await getRecordings(session.user.id);
    return NextResponse.json(recordings);
  } catch (error) {
    console.error("Failed to get recordings:", error);
    return NextResponse.json(
      { error: "Failed to get recordings" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  const session = await getAuthSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await request.json()) as CreateRecordingInput;

    if (!body.name || !body.data || typeof body.duration !== "number") {
      return NextResponse.json(
        { error: "Missing required fields: name, data, duration" },
        { status: 400 }
      );
    }

    const recording = await createRecording(session.user.id, body);
    return NextResponse.json(recording, { status: 201 });
  } catch (error) {
    console.error("Failed to create recording:", error);
    return NextResponse.json(
      { error: "Failed to create recording" },
      { status: 500 }
    );
  }
}
