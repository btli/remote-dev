import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiAuth, errorResponse, parseJsonBody } from "@/lib/api";
import { db } from "@/db";
import { userSettings } from "@/db/schema";
import { eq } from "drizzle-orm";

const schema = z.object({
  nodeId: z.string().min(1),
  nodeType: z.enum(["group", "project"]),
});

export const POST = withApiAuth(async (req, { userId }) => {
  const result = await parseJsonBody<unknown>(req);
  if ("error" in result) return result.error;
  const parsed = schema.safeParse(result.data);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
  }
  try {
    // Upsert: ensure a row exists, then update the active-node columns.
    await db
      .insert(userSettings)
      .values({
        userId,
        activeNodeId: parsed.data.nodeId,
        activeNodeType: parsed.data.nodeType,
      })
      .onConflictDoUpdate({
        target: userSettings.userId,
        set: {
          activeNodeId: parsed.data.nodeId,
          activeNodeType: parsed.data.nodeType,
          updatedAt: new Date(),
        },
      });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(String(err), 400);
  }
});
