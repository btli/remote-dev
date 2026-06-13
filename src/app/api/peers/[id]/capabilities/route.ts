/**
 * /api/peers/[id]/capabilities — live-verify a registered peer.
 *   GET — call the peer's GET /api/migration/capabilities with the stored
 *         credential, cache the result on the registry row, and return it.
 */
import { NextResponse } from "next/server";
import { withApiAuth, errorResponse } from "@/lib/api";
import * as PeerInstanceService from "@/services/peer-instance-service";
import { createLogger } from "@/lib/logger";

const log = createLogger("api/peers");

export const GET = withApiAuth(async (_request, { userId, params }) => {
  const id = params?.id;
  if (!id) return errorResponse("Missing id", 400, "MISSING_ID");
  try {
    const capabilities = await PeerInstanceService.verifyPeer(userId, id);
    return NextResponse.json({ capabilities });
  } catch (error) {
    const message = String(error instanceof Error ? error.message : error);
    if (message.includes("not found")) {
      return errorResponse("Peer not found", 404, "NOT_FOUND");
    }
    log.warn("Peer verification failed", { peerId: id, error: message });
    // 502: the failure is on the peer leg, not this request.
    return errorResponse(message, 502, "PEER_UNREACHABLE");
  }
});
