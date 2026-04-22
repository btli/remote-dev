import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiAuth, errorResponse, parseJsonBody } from "@/lib/api";
import { ProjectService } from "@/services/project-service";

const createSchema = z.object({
  // Null means create the project at the tree root. When provided as a
  // string, it must be non-empty (same as before).
  groupId: z.string().min(1).nullable(),
  name: z.string().min(1),
  sortOrder: z.number().int().optional(),
});

export const GET = withApiAuth(async (req, { userId }) => {
  const url = new URL(req.url);
  const groupId = url.searchParams.get("groupId");
  const projects = groupId
    ? await ProjectService.listByGroup(groupId)
    : await ProjectService.listByUser(userId);
  return NextResponse.json({ projects: projects.map((p) => p.props) });
});

export const POST = withApiAuth(async (req, { userId }) => {
  const result = await parseJsonBody<unknown>(req);
  if ("error" in result) return result.error;
  const parsed = createSchema.safeParse(result.data);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
  }
  try {
    const project = await ProjectService.create({
      userId,
      groupId: parsed.data.groupId,
      name: parsed.data.name,
      sortOrder: parsed.data.sortOrder,
    });
    return NextResponse.json({ project: project.props }, { status: 201 });
  } catch (err) {
    return errorResponse(String(err), 400);
  }
});
