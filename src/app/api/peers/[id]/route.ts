/**
 * /api/peers/[id] — manage one registered peer instance.
 *   GET    — fetch (masked).
 *   PATCH  — update fields; secret fields are re-encrypted when provided.
 *   DELETE — remove the peer (cascade removes its migration jobs).
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiAuth, errorResponse, parseJsonBody } from "@/lib/api";
import * as PeerInstanceService from "@/services/peer-instance-service";
import { createLogger } from "@/lib/logger";

const log = createLogger("api/peers");

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  baseUrl: z.string().min(1).optional(),
  apiKey: z.string().min(1).optional(),
  cfAccessClientId: z.string().nullable().optional(),
  cfAccessSecret: z.string().nullable().optional(),
});

export const GET = withApiAuth(async (_request, { userId, params }) => {
  const id = params?.id;
  if (!id) return errorResponse("Missing id", 400, "MISSING_ID");
  const peer = await PeerInstanceService.getPeer(userId, id);
  if (!peer) return errorResponse("Peer not found", 404, "NOT_FOUND");
  return NextResponse.json({ peer });
});

export const PATCH = withApiAuth(async (request, { userId, params }) => {
  const id = params?.id;
  if (!id) return errorResponse("Missing id", 400, "MISSING_ID");
  const result = await parseJsonBody<unknown>(request);
  if ("error" in result) return result.error;
  const parsed = updateSchema.safeParse(result.data);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
  }
  try {
    const peer = await PeerInstanceService.updatePeer(userId, id, parsed.data);
    if (!peer) return errorResponse("Peer not found", 404, "NOT_FOUND");
    return NextResponse.json({ peer });
  } catch (error) {
    log.error("Error updating peer", { peerId: id, error: String(error) });
    return errorResponse(String(error instanceof Error ? error.message : error), 400, "UPDATE_FAILED");
  }
});

export const DELETE = withApiAuth(async (_request, { userId, params }) => {
  const id = params?.id;
  if (!id) return errorResponse("Missing id", 400, "MISSING_ID");
  const deleted = await PeerInstanceService.deletePeer(userId, id);
  if (!deleted) return errorResponse("Peer not found", 404, "NOT_FOUND");
  return NextResponse.json({ ok: true });
});
