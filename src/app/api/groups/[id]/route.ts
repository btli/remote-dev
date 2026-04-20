import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiAuth, errorResponse, parseJsonBody } from "@/lib/api";
import { GroupService } from "@/services/group-service";

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  collapsed: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

export const GET = withApiAuth(async (_req, { params }) => {
  const group = await GroupService.get(params!.id);
  if (!group) return errorResponse("not found", 404);
  return NextResponse.json({ group: group.props });
});

export const PATCH = withApiAuth(async (req, { params }) => {
  const result = await parseJsonBody<unknown>(req);
  if ("error" in result) return result.error;
  const parsed = updateSchema.safeParse(result.data);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
  }
  const group = await GroupService.update({
    id: params!.id,
    ...parsed.data,
  });
  return NextResponse.json({ group: group.props });
});

export const DELETE = withApiAuth(async (req, { params }) => {
  const url = new URL(req.url);
  const force = url.searchParams.get("force") === "true";
  try {
    await GroupService.delete({ id: params!.id, force });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(String(err), 400);
  }
});
