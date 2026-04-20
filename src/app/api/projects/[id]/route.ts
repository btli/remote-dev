import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiAuth, errorResponse, parseJsonBody } from "@/lib/api";
import { ProjectService } from "@/services/project-service";

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  collapsed: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

export const GET = withApiAuth(async (_req, { params }) => {
  const project = await ProjectService.get(params!.id);
  if (!project) return errorResponse("not found", 404);
  return NextResponse.json({ project: project.props });
});

export const PATCH = withApiAuth(async (req, { params }) => {
  const result = await parseJsonBody<unknown>(req);
  if ("error" in result) return result.error;
  const parsed = updateSchema.safeParse(result.data);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
  }
  const project = await ProjectService.update({
    id: params!.id,
    ...parsed.data,
  });
  return NextResponse.json({ project: project.props });
});

export const DELETE = withApiAuth(async (_req, { params }) => {
  await ProjectService.delete(params!.id);
  return NextResponse.json({ ok: true });
});
