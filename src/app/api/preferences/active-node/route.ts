import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiAuth, errorResponse, parseJsonBody } from "@/lib/api";
import { db } from "@/db";
import { userSettings } from "@/db/schema";
import { eq } from "drizzle-orm";

// `nodeId`/`nodeType` may be null to clear the active/pinned selection.
// `pinned` toggles whether the selection is "pinned" — in which case the
// value is written to `pinnedNode*` and the `activeNode*` columns are
// cleared. Unpinned selections write to `activeNode*` and clear
// `pinnedNode*`.
const schema = z.object({
  nodeId: z.string().min(1).nullable(),
  nodeType: z.enum(["group", "project"]).nullable(),
  pinned: z.boolean().optional().default(false),
});

export const POST = withApiAuth(async (req, { userId }) => {
  const result = await parseJsonBody<unknown>(req);
  if ("error" in result) return result.error;
  const parsed = schema.safeParse(result.data);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
  }
  const { nodeId, nodeType, pinned } = parsed.data;
  // Require both nodeId and nodeType to be present or both absent.
  if ((nodeId === null) !== (nodeType === null)) {
    return NextResponse.json(
      { error: "nodeId and nodeType must be provided together" },
      { status: 400 }
    );
  }
  const activeNodeId = pinned ? null : nodeId;
  const activeNodeType = pinned ? null : nodeType;
  const pinnedNodeId = pinned ? nodeId : null;
  const pinnedNodeType = pinned ? nodeType : null;
  try {
    // Upsert: ensure a row exists, then update the active/pinned node columns.
    await db
      .insert(userSettings)
      .values({
        userId,
        activeNodeId,
        activeNodeType,
        pinnedNodeId,
        pinnedNodeType,
      })
      .onConflictDoUpdate({
        target: userSettings.userId,
        set: {
          activeNodeId,
          activeNodeType,
          pinnedNodeId,
          pinnedNodeType,
          updatedAt: new Date(),
        },
      });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(String(err), 400);
  }
});
