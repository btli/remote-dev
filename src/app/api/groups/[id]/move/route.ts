import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiAuth, errorResponse, parseJsonBody } from "@/lib/api";
import { GroupService } from "@/services/group-service";

const schema = z.object({ newParentGroupId: z.string().nullable() });

export const POST = withApiAuth(async (req, { params }) => {
  const result = await parseJsonBody<unknown>(req);
  if ("error" in result) return result.error;
  const parsed = schema.safeParse(result.data);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
  }
  try {
    await GroupService.move({
      id: params!.id,
      newParentGroupId: parsed.data.newParentGroupId,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(String(err), 400);
  }
});
