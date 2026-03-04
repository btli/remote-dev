import { NextResponse } from "next/server";
import { withApiAuth, errorResponse, parseJsonBody } from "@/lib/api";
import { getTask, updateTask, deleteTask } from "@/services/task-service";
import type { UpdateTaskInput } from "@/types/task";

export const GET = withApiAuth(async (_request, { userId, params }) => {
  const id = params?.id;
  if (!id) return errorResponse("Task ID is required", 400);

  const task = await getTask(id, userId);
  if (!task) return errorResponse("Task not found", 404);

  return NextResponse.json(task);
});

export const PATCH = withApiAuth(async (request, { userId, params }) => {
  const id = params?.id;
  if (!id) return errorResponse("Task ID is required", 400);

  const result = await parseJsonBody<UpdateTaskInput>(request);
  if ("error" in result) return result.error;

  const task = await updateTask(id, userId, result.data);
  if (!task) return errorResponse("Task not found", 404);

  return NextResponse.json(task);
});

export const DELETE = withApiAuth(async (_request, { userId, params }) => {
  const id = params?.id;
  if (!id) return errorResponse("Task ID is required", 400);

  const deleted = await deleteTask(id, userId);
  if (!deleted) return errorResponse("Task not found", 404);

  return new NextResponse(null, { status: 204 });
});
