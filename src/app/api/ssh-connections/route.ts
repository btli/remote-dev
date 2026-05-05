/**
 * /api/ssh-connections — list + create SSH connection definitions.
 *
 * Connections are user-scoped with an optional `projectId` pin. The list
 * endpoint accepts `?projectId=` to filter to a specific project.
 *
 * @see /api/ssh-connections/[id] for read/update/delete
 * @see /api/ssh-connections/[id]/test for connectivity check
 */

import { NextResponse } from "next/server";
import { withApiAuth, errorResponse, parseJsonBody } from "@/lib/api";
import * as SshConnectionService from "@/services/ssh-connection-service";
import type {
  SshAuthType,
  SshKnownHostsPolicy,
} from "@/services/ssh-connection-service";
import { createLogger } from "@/lib/logger";
import { serializeConnection, serviceErrorResponse } from "./_shared";

const log = createLogger("api/ssh-connections");

const VALID_AUTH_TYPES: SshAuthType[] = ["key", "agent", "password", "system"];
const VALID_POLICIES: SshKnownHostsPolicy[] = ["strict", "accept-new", "no"];

export const GET = withApiAuth(async (request, { userId }) => {
  try {
    const { searchParams } = new URL(request.url);
    const raw = searchParams.get("projectId");
    // Tri-state filter:
    //   absent           → all connections for the user
    //   ?projectId=<id>  → connections bound to that project
    //   ?projectId=null  → user-level (unbound) connections only
    let projectIdFilter: string | null | undefined;
    if (raw === null) {
      projectIdFilter = undefined;
    } else if (raw === "null" || raw === "") {
      projectIdFilter = null;
    } else {
      projectIdFilter = raw;
    }
    const list = await SshConnectionService.list({
      userId,
      projectId: projectIdFilter,
    });
    return NextResponse.json({ connections: list.map(serializeConnection) });
  } catch (error) {
    log.error("Error listing SSH connections", { error: String(error) });
    return errorResponse("Failed to list SSH connections", 500);
  }
});

export const POST = withApiAuth(async (request, { userId }) => {
  try {
    const result = await parseJsonBody<{
      name?: string;
      host?: string;
      port?: number;
      username?: string;
      authType?: SshAuthType;
      password?: string;
      hasPassphrase?: boolean;
      knownHostsPolicy?: SshKnownHostsPolicy;
      extraOptions?: string[];
      projectId?: string | null;
      // Optional: paste a private key (and optional public key) to write
      // to the connection's directory. Only meaningful when authType === "key".
      privateKey?: string;
      publicKey?: string;
      // Optional: ask the server to generate an ed25519 keypair after create.
      // Only meaningful when authType === "key" and no privateKey is supplied.
      generateKeypair?: boolean;
    }>(request);
    if ("error" in result) return result.error;
    const body = result.data;

    if (!body.name || !body.host || !body.username || !body.authType) {
      return errorResponse(
        "name, host, username, and authType are required",
        400,
        "MISSING_FIELDS"
      );
    }
    if (!VALID_AUTH_TYPES.includes(body.authType)) {
      return errorResponse("Invalid authType", 400, "INVALID_AUTH_TYPE");
    }
    if (body.knownHostsPolicy && !VALID_POLICIES.includes(body.knownHostsPolicy)) {
      return errorResponse("Invalid knownHostsPolicy", 400, "INVALID_POLICY");
    }

    const connection = await SshConnectionService.create(userId, {
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

    // Side-effects after create: write key, generate, etc.
    let publicKey: string | null = null;
    if (body.authType === "key") {
      if (body.privateKey) {
        await SshConnectionService.writeKey(
          connection.id,
          body.privateKey,
          body.publicKey
        );
        if (body.publicKey) publicKey = body.publicKey.trim();
      } else if (body.generateKeypair) {
        const generated = await SshConnectionService.generateKeypair(connection.id);
        publicKey = generated.publicKey;
      }
    }

    return NextResponse.json(
      {
        connection: serializeConnection(connection),
        publicKey,
      },
      { status: 201 }
    );
  } catch (error) {
    const mapped = serviceErrorResponse(error);
    if (mapped) return mapped;
    log.error("Error creating SSH connection", { error: String(error) });
    return errorResponse("Failed to create SSH connection", 500);
  }
});
