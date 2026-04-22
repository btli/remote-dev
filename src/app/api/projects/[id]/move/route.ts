import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiAuth, errorResponse, parseJsonBody } from "@/lib/api";
import { ProjectService } from "@/services/project-service";

// Null newGroupId means move the project to the tree root.
const schema = z.object({ newGroupId: z.string().min(1).nullable() });

export const POST = withApiAuth(async (req, { params }) => {
  const result = await parseJsonBody<unknown>(req);
  if ("error" in result) return result.error;
  const parsed = schema.safeParse(result.data);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
  }
  try {
    await ProjectService.move({
      id: params!.id,
      newGroupId: parsed.data.newGroupId,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(String(err), 400);
  }
});
