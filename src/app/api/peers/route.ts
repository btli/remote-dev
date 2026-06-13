/**
 * /api/peers — registry of remote Remote Dev instances (server-to-server
 * migration, stage 1).
 *   GET  — list the caller's registered peers (API keys masked).
 *   POST — register a peer (API key + optional CF Access secret encrypted at rest).
 *
 * Note: /api/peers/messages and /api/peers/peers (inter-agent peer messaging)
 * are unrelated static subroutes — Next resolves them before the [id] segment.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiAuth, errorResponse, parseJsonBody } from "@/lib/api";
import * as PeerInstanceService from "@/services/peer-instance-service";
import { createLogger } from "@/lib/logger";

const log = createLogger("api/peers");

const createSchema = z.object({
  name: z.string().min(1),
  baseUrl: z.string().min(1),
  apiKey: z.string().min(1),
  cfAccessClientId: z.string().nullable().optional(),
  cfAccessSecret: z.string().nullable().optional(),
});

export const GET = withApiAuth(async (_request, { userId }) => {
  try {
    const peers = await PeerInstanceService.listPeers(userId);
    return NextResponse.json({ peers });
  } catch (error) {
    log.error("Error listing peers", { error: String(error) });
    return errorResponse("Failed to list peers", 500);
  }
});

export const POST = withApiAuth(async (request, { userId }) => {
  const result = await parseJsonBody<unknown>(request);
  if ("error" in result) return result.error;
  const parsed = createSchema.safeParse(result.data);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
  }
  try {
    const peer = await PeerInstanceService.createPeer(userId, parsed.data);
    return NextResponse.json({ peer }, { status: 201 });
  } catch (error) {
    const message = String(error instanceof Error ? error.message : error);
    if (message.includes("UNIQUE") || message.includes("unique")) {
      return errorResponse("A peer with that name already exists", 409, "DUPLICATE_NAME");
    }
    log.error("Error creating peer", { error: String(error) });
    return errorResponse(message, 400, "CREATE_FAILED");
  }
});
