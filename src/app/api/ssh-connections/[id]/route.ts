/**
 * /api/ssh-connections/[id] — read, update, delete a single SSH connection.
 */

import { NextResponse } from "next/server";
import { withApiAuth, errorResponse, parseJsonBody } from "@/lib/api";
import * as SshConnectionService from "@/services/ssh-connection-service";
import type {
  SshAuthType,
  SshKnownHostsPolicy,
} from "@/services/ssh-connection-service";
import { createLogger } from "@/lib/logger";
import { serializeConnection, serviceErrorResponse } from "../_shared";

const log = createLogger("api/ssh-connections/[id]");

const VALID_AUTH_TYPES: SshAuthType[] = ["key", "agent", "password", "system"];
const VALID_POLICIES: SshKnownHostsPolicy[] = ["strict", "accept-new", "no"];

export const GET = withApiAuth(async (_request, { userId, params }) => {
  const id = params?.id;
  if (!id) return errorResponse("Connection id is required", 400, "ID_REQUIRED");

  try {
    const conn = await SshConnectionService.get(id, userId);
    if (!conn) return errorResponse("Not found", 404, "NOT_FOUND");
    return NextResponse.json({ connection: serializeConnection(conn) });
  } catch (error) {
    log.error("Error fetching SSH connection", { error: String(error), id });
    return errorResponse("Failed to fetch SSH connection", 500);
  }
});

export const PATCH = withApiAuth(async (request, { userId, params }) => {
  const id = params?.id;
  if (!id) return errorResponse("Connection id is required", 400, "ID_REQUIRED");

  try {
    const result = await parseJsonBody<{
      name?: string;
      host?: string;
      port?: number;
      username?: string;
      authType?: SshAuthType;
      password?: string | null;
      hasPassphrase?: boolean;
      knownHostsPolicy?: SshKnownHostsPolicy;
      extraOptions?: string[] | null;
      projectId?: string | null;
      privateKey?: string;
      publicKey?: string;
      generateKeypair?: boolean;
    }>(request);
    if ("error" in result) return result.error;
    const body = result.data;

    if (body.authType && !VALID_AUTH_TYPES.includes(body.authType)) {
      return errorResponse("Invalid authType", 400, "INVALID_AUTH_TYPE");
    }
    if (body.knownHostsPolicy && !VALID_POLICIES.includes(body.knownHostsPolicy)) {
      return errorResponse("Invalid knownHostsPolicy", 400, "INVALID_POLICY");
    }

    const updated = await SshConnectionService.update(id, userId, {
      name: body.name,
      host: body.host,
      port: body.port,
      username: body.username,
      authType: body.authType,
      password: body.password,
      hasPassphrase: body.hasPassphrase,
      knownHostsPolicy: body.knownHostsPolicy,
      extraOptions: body.extraOptions,
      projectId: body.projectId,
    });

    let publicKey: string | null = null;
    const effectiveAuthType = body.authType ?? updated.authType;
    if (effectiveAuthType === "key") {
      if (body.privateKey) {
        await SshConnectionService.writeKey(id, body.privateKey, body.publicKey);
        if (body.publicKey) publicKey = body.publicKey.trim();
      } else if (body.generateKeypair) {
        const generated = await SshConnectionService.generateKeypair(id);
        publicKey = generated.publicKey;
      }
    }

    return NextResponse.json({
      connection: serializeConnection(updated),
      publicKey,
    });
  } catch (error) {
    const mapped = serviceErrorResponse(error);
    if (mapped) return mapped;
    log.error("Error updating SSH connection", { error: String(error), id });
    return errorResponse("Failed to update SSH connection", 500);
  }
});

export const DELETE = withApiAuth(async (_request, { userId, params }) => {
  const id = params?.id;
  if (!id) return errorResponse("Connection id is required", 400, "ID_REQUIRED");

  try {
    await SshConnectionService.remove(id, userId);
    return NextResponse.json({ success: true });
  } catch (error) {
    const mapped = serviceErrorResponse(error);
    if (mapped) return mapped;
    log.error("Error deleting SSH connection", { error: String(error), id });
    return errorResponse("Failed to delete SSH connection", 500);
  }
});
