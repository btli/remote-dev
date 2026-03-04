import { NextResponse } from "next/server";
import { withApiAuth, errorResponse, parseJsonBody } from "@/lib/api";
import { getTasks, createTask } from "@/services/task-service";
import type { CreateTaskInput } from "@/types/task";

export const GET = withApiAuth(async (request, { userId }) => {
  const url = new URL(request.url);
  const folderId = url.searchParams.get("folderId") ?? undefined;

  const tasks = await getTasks(userId, folderId);
  return NextResponse.json(tasks);
});

export const POST = withApiAuth(async (request, { userId }) => {
  const result = await parseJsonBody<CreateTaskInput>(request);
  if ("error" in result) return result.error;
  const body = result.data;

  if (!body.title?.trim()) {
    return errorResponse("Task title is required", 400);
  }

  const task = await createTask(userId, body);
  return NextResponse.json(task, { status: 201 });
});
