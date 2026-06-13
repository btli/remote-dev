/**
 * PeerInstanceService — registry of remote Remote Dev instances this instance
 * can migrate projects to (server-to-server migration, stage 1).
 *
 * The destination API key (and optional Cloudflare Access service-token
 * secret) are encrypted at rest with src/lib/encryption.ts. Decrypted values
 * NEVER leave this process: API/listing surfaces get a masked
 * keyPrefix-style preview ("rdv_…last4"); only peerFetch decrypts at call
 * time.
 */
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { peerInstances } from "@/db/schema";
import { encrypt } from "@/lib/encryption";
import { peerFetch, readPeerJson } from "@/lib/peer-fetch";
import { MigrationServiceError } from "./migration-errors";
import { createLogger } from "@/lib/logger";

const log = createLogger("PeerInstanceService");

/** Row type for a `peer_instance` record. */
export type PeerInstanceRow = typeof peerInstances.$inferSelect;

/** Capabilities advertised by a peer's GET /api/migration/capabilities. */
export interface PeerCapabilities {
  version: number;
  maxChunkBytes: number;
  appVersion: string;
}

/** The API-safe view of a peer — never contains decryptable secrets. */
export interface PeerInstanceView {
  id: string;
  name: string;
  baseUrl: string;
  /** Masked preview of the stored API key (e.g. "rdv_…a1b2"). */
  apiKeyMasked: string;
  cfAccessClientId: string | null;
  hasCfAccessSecret: boolean;
  capabilities: PeerCapabilities | null;
  lastSeenAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreatePeerInput {
  name: string;
  baseUrl: string;
  apiKey: string;
  cfAccessClientId?: string | null;
  cfAccessSecret?: string | null;
}

export interface UpdatePeerInput {
  name?: string;
  baseUrl?: string;
  apiKey?: string;
  cfAccessClientId?: string | null;
  cfAccessSecret?: string | null;
}

/**
 * Mask a plaintext key for display: leading prefix + last 4 chars
 * ("rdv_…a1b2"). Short values mask entirely.
 */
export function maskApiKey(plaintext: string): string {
  if (plaintext.length <= 8) return "••••";
  const prefixLen = plaintext.startsWith("rdv_") ? 4 : Math.min(4, plaintext.length - 4);
  return `${plaintext.slice(0, prefixLen)}…${plaintext.slice(-4)}`;
}

/** Normalize a base URL: require http(s), strip trailing slash. */
function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//.test(trimmed)) {
    throw new Error("baseUrl must start with http:// or https://");
  }
  return trimmed;
}

function parseCapabilities(raw: string | null): PeerCapabilities | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PeerCapabilities;
  } catch {
    return null;
  }
}

function toView(row: PeerInstanceRow, apiKeyMasked: string): PeerInstanceView {
  return {
    id: row.id,
    name: row.name,
    baseUrl: row.baseUrl,
    apiKeyMasked,
    cfAccessClientId: row.cfAccessClientId ?? null,
    hasCfAccessSecret: !!row.encryptedCfAccessSecret,
    capabilities: parseCapabilities(row.capabilities),
    lastSeenAt: row.lastSeenAt ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * A real mask ("rdv_…a1b2") is only computable while the plaintext is in hand
 * (create/update). Reads deliberately cannot recover it — decrypting stored
 * keys for display would defeat the at-rest model — so list/get show this
 * generic placeholder instead.
 */
const GENERIC_MASK = "rdv_…••••";

/** List the caller's registered peers (masked). */
export async function listPeers(userId: string): Promise<PeerInstanceView[]> {
  const rows = await db
    .select()
    .from(peerInstances)
    .where(eq(peerInstances.userId, userId))
    .orderBy(peerInstances.name);
  return rows.map((row) => toView(row, GENERIC_MASK));
}

/** Fetch one peer row (owner-scoped). Internal callers get the full row. */
export async function getPeerRow(
  userId: string,
  id: string,
): Promise<PeerInstanceRow | null> {
  const row = await db.query.peerInstances.findFirst({
    where: and(eq(peerInstances.id, id), eq(peerInstances.userId, userId)),
  });
  return row ?? null;
}

/** Fetch one peer (owner-scoped, masked view). */
export async function getPeer(
  userId: string,
  id: string,
): Promise<PeerInstanceView | null> {
  const row = await getPeerRow(userId, id);
  return row ? toView(row, GENERIC_MASK) : null;
}

/** Register a peer. The API key + CF secret are encrypted before insert. */
export async function createPeer(
  userId: string,
  input: CreatePeerInput,
): Promise<PeerInstanceView> {
  if (!input.name.trim()) throw new Error("name is required");
  if (!input.apiKey.trim()) throw new Error("apiKey is required");
  const baseUrl = normalizeBaseUrl(input.baseUrl);

  const [row] = await db
    .insert(peerInstances)
    .values({
      userId,
      name: input.name.trim(),
      baseUrl,
      encryptedApiKey: encrypt(input.apiKey),
      cfAccessClientId: input.cfAccessClientId?.trim() || null,
      encryptedCfAccessSecret: input.cfAccessSecret
        ? encrypt(input.cfAccessSecret)
        : null,
    })
    .returning();

  log.info("Peer instance registered", { peerId: row.id, userId, baseUrl });
  return toView(row, maskApiKey(input.apiKey));
}

/** Update a peer. Secret fields are re-encrypted when provided. */
export async function updatePeer(
  userId: string,
  id: string,
  input: UpdatePeerInput,
): Promise<PeerInstanceView | null> {
  const existing = await getPeerRow(userId, id);
  if (!existing) return null;

  const patch: Partial<typeof peerInstances.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (input.name !== undefined) {
    if (!input.name.trim()) throw new Error("name cannot be empty");
    patch.name = input.name.trim();
  }
  if (input.baseUrl !== undefined) patch.baseUrl = normalizeBaseUrl(input.baseUrl);
  if (input.apiKey !== undefined) {
    if (!input.apiKey.trim()) throw new Error("apiKey cannot be empty");
    patch.encryptedApiKey = encrypt(input.apiKey);
    // Cached capabilities were proven with the OLD credential; reset.
    patch.capabilities = null;
    patch.lastSeenAt = null;
  }
  if (input.cfAccessClientId !== undefined) {
    patch.cfAccessClientId = input.cfAccessClientId?.trim() || null;
  }
  if (input.cfAccessSecret !== undefined) {
    patch.encryptedCfAccessSecret = input.cfAccessSecret
      ? encrypt(input.cfAccessSecret)
      : null;
  }

  const [row] = await db
    .update(peerInstances)
    .set(patch)
    .where(and(eq(peerInstances.id, id), eq(peerInstances.userId, userId)))
    .returning();

  log.info("Peer instance updated", { peerId: id, userId });
  return toView(row, input.apiKey ? maskApiKey(input.apiKey) : GENERIC_MASK);
}

/** Delete a peer (owner-scoped). Returns true when a row was removed. */
export async function deletePeer(userId: string, id: string): Promise<boolean> {
  const deleted = await db
    .delete(peerInstances)
    .where(and(eq(peerInstances.id, id), eq(peerInstances.userId, userId)))
    .returning({ id: peerInstances.id });
  if (deleted.length > 0) {
    log.info("Peer instance deleted", { peerId: id, userId });
  }
  return deleted.length > 0;
}

/**
 * Verify a peer is reachable + compatible: GET /api/migration/capabilities
 * with the stored credential, cache the response in `capabilities` and stamp
 * `lastSeenAt`. Throws with a descriptive message on auth/network failure.
 */
export async function verifyPeer(
  userId: string,
  id: string,
): Promise<PeerCapabilities> {
  const peer = await getPeerRow(userId, id);
  if (!peer) throw new MigrationServiceError("Peer not found", 404, "NOT_FOUND");

  let response: Response;
  try {
    response = await peerFetch(peer, "/api/migration/capabilities", {
      method: "GET",
    });
  } catch (error) {
    // Decrypt / half-CF-credential / network failures land here. The message
    // peerFetch threw is already actionable — surface it verbatim.
    log.warn("Peer capabilities fetch failed", {
      peerId: id,
      error: String(error),
      // undici hides the real network error (ECONNREFUSED, ENOTFOUND, TLS …)
      // in error.cause; without this the log only shows "TypeError: fetch failed".
      cause: String((error as { cause?: unknown })?.cause ?? ""),
    });
    throw error instanceof Error
      ? error
      : new Error(`Peer unreachable: ${String(error)}`);
  }

  // readPeerJson maps 3xx (CF Access wall) / 401 (bad key) / 404 (Base URL
  // missing the slug) / non-JSON (login page) onto specific, debuggable
  // messages — the Test-connection path shows these straight to the user.
  const capabilities = await readPeerJson<PeerCapabilities>(
    response,
    `${peer.name} capabilities check`,
  );
  await db
    .update(peerInstances)
    .set({
      capabilities: JSON.stringify(capabilities),
      lastSeenAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(peerInstances.id, id), eq(peerInstances.userId, userId)));

  log.info("Peer verified", { peerId: id, version: capabilities.version });
  return capabilities;
}
