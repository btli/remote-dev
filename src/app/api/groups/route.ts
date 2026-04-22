import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiAuth, errorResponse, parseJsonBody } from "@/lib/api";
import { GroupService } from "@/services/group-service";
import { createLogger } from "@/lib/logger";

const log = createLogger("api/groups");

const createSchema = z.object({
  name: z.string().min(1),
  parentGroupId: z.string().nullable(),
  sortOrder: z.number().int().optional(),
});

export const GET = withApiAuth(async (_req, { userId }) => {
  const groups = await GroupService.list(userId);
  return NextResponse.json({ groups: groups.map((g) => g.props) });
});

export const POST = withApiAuth(async (req, { userId }) => {
  const result = await parseJsonBody<unknown>(req);
  if ("error" in result) return result.error;
  const parsed = createSchema.safeParse(result.data);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
  }
  try {
    const group = await GroupService.create({
      userId,
      name: parsed.data.name,
      parentGroupId: parsed.data.parentGroupId,
      sortOrder: parsed.data.sortOrder,
    });
    return NextResponse.json({ group: group.props }, { status: 201 });
  } catch (err) {
    log.error("create group failed", { error: String(err) });
    return errorResponse(String(err), 400);
  }
});
