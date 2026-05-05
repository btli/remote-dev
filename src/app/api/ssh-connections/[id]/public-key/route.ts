/**
 * /api/ssh-connections/[id]/public-key — read the on-disk public key.
 *
 * Returns 404 if the connection has no `id.pub` file. Useful for the
 * Settings UI to display the generated key for copy-paste into the
 * remote `~/.ssh/authorized_keys` file.
 */

import { NextResponse } from "next/server";
import { withApiAuth, errorResponse } from "@/lib/api";
import * as SshConnectionService from "@/services/ssh-connection-service";
import { createLogger } from "@/lib/logger";

const log = createLogger("api/ssh-connections/[id]/public-key");

export const GET = withApiAuth(async (_request, { userId, params }) => {
  const id = params?.id;
  if (!id) return errorResponse("Connection id is required", 400, "ID_REQUIRED");

  try {
    const conn = await SshConnectionService.get(id, userId);
    if (!conn) return errorResponse("Not found", 404, "NOT_FOUND");

    const publicKey = await SshConnectionService.readPublicKey(id);
    if (!publicKey) {
      return errorResponse("No public key on disk", 404, "NO_PUBLIC_KEY");
    }
    return NextResponse.json({ publicKey });
  } catch (error) {
    log.error("Error reading public key", { error: String(error), id });
    return errorResponse("Failed to read public key", 500);
  }
});
