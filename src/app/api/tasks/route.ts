import { NextResponse } from "next/server";
import { withApiAuth, errorResponse, parseJsonBody } from "@/lib/api";
import {
  getTasks,
  listTasksByNode,
  createTask,
  clearTasks,
} from "@/services/task-service";
import type { CreateTaskInput, TaskSource } from "@/types/task";

export const GET = withApiAuth(async (request, { userId }) => {
  const url = new URL(request.url);
  const folderId = url.searchParams.get("folderId") ?? undefined;
  const nodeId = url.searchParams.get("nodeId");
  const nodeType = url.searchParams.get("nodeType");

  // Phase 4: prefer nodeId/nodeType when present so group nodes can roll up
  // across descendant projects via task-service.listTasksByNode.
  if (nodeId && (nodeType === "group" || nodeType === "project")) {
    const tasks = await listTasksByNode({ id: nodeId, type: nodeType }, userId);
    return NextResponse.json(tasks);
  }

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

export const DELETE = withApiAuth(async (request, { userId }) => {
  const url = new URL(request.url);
  const folderId = url.searchParams.get("folderId");
  const source = url.searchParams.get("source") as TaskSource | null;
  const sessionId = url.searchParams.get("sessionId") ?? undefined;
  const completedOnly = url.searchParams.get("completedOnly") === "true";

  if (!folderId) {
    return errorResponse("folderId is required", 400);
  }

  if (source && source !== "manual" && source !== "agent") {
    return errorResponse("source must be 'manual' or 'agent'", 400);
  }

  const deleted = await clearTasks(userId, folderId, source ?? undefined, {
    sessionId,
    completedOnly,
  });
  return NextResponse.json({ deleted }, { status: 200 });
});
