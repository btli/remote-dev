/**
 * Shared helpers for the /api/ssh-connections route handlers.
 *
 * `serializeConnection` is the single source of truth for how
 * `SshConnection` rows are projected to API responses. It deliberately
 * never exposes `passwordEnc` so we can't accidentally leak ciphertext.
 */

import { errorResponse } from "@/lib/api";
import * as SshConnectionService from "@/services/ssh-connection-service";
import type {
  SshAuthType,
  SshKnownHostsPolicy,
} from "@/services/ssh-connection-service";

export interface SshConnectionResponse {
  id: string;
  userId: string;
  projectId: string | null;
  name: string;
  host: string;
  port: number;
  username: string;
  authType: SshAuthType;
  hasPassphrase: boolean;
  knownHostsPolicy: SshKnownHostsPolicy;
  extraOptions: string[] | null;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
}

export function serializeConnection(
  c: SshConnectionService.SshConnection
): SshConnectionResponse {
  return {
    id: c.id,
    userId: c.userId,
    projectId: c.projectId,
    name: c.name,
    host: c.host,
    port: c.port,
    username: c.username,
    authType: c.authType,
    hasPassphrase: c.hasPassphrase,
    knownHostsPolicy: c.knownHostsPolicy,
    extraOptions: c.extraOptions,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
    lastUsedAt: c.lastUsedAt?.toISOString() ?? null,
    // NB: never expose passwordEnc.
  };
}

/**
 * Map a `SshConnectionServiceError` to an HTTP error response. Returns
 * `null` if the error is not a service error so callers can fall through
 * to a generic 500.
 */
const STATUS_BY_CODE: Record<string, number> = {
  NOT_FOUND: 404,
  SSHPASS_MISSING: 422,
  INVALID_INPUT: 400,
};

export function serviceErrorResponse(error: unknown) {
  if (error instanceof SshConnectionService.SshConnectionServiceError) {
    return errorResponse(
      error.message,
      STATUS_BY_CODE[error.code] ?? 400,
      error.code
    );
  }
  return null;
}
