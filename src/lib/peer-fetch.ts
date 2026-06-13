/**
 * Peer fetch — authenticated server-to-server fetch into a registered peer
 * Remote Dev instance (server-to-server project migration).
 *
 * Mirrors apps/supervisor/src/lib/instance-proxy.ts: compose
 * `${baseUrl}${path}`, attach the peer's API key as `Authorization: Bearer`
 * (decrypted from the registry row at call time, never persisted in plain),
 * and — when the peer sits behind Cloudflare Access — the CF Access
 * service-token header pair so the edge admits the request.
 */
import { decrypt } from "@/lib/encryption";
import { createLogger } from "@/lib/logger";

const log = createLogger("PeerFetch");

/** The subset of a peer_instance row peerFetch needs. */
export interface PeerTarget {
  id: string;
  baseUrl: string;
  encryptedApiKey: string;
  cfAccessClientId?: string | null;
  encryptedCfAccessSecret?: string | null;
}

/** Build the absolute URL for a peer data-plane path. */
export function peerUrl(peer: Pick<PeerTarget, "baseUrl">, path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${peer.baseUrl.replace(/\/$/, "")}${p}`;
}

/**
 * Fetch a peer endpoint with the peer credential attached. Throws when the
 * stored API key cannot be decrypted (e.g. AUTH_SECRET changed since the peer
 * was registered) — callers surface a clear error.
 */
export async function peerFetch(
  peer: PeerTarget,
  path: string,
  init: RequestInit = {},
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  let apiKey: string;
  try {
    apiKey = decrypt(peer.encryptedApiKey);
  } catch (error) {
    log.error("Failed to decrypt peer API key", {
      peerId: peer.id,
      error: String(error),
    });
    throw new Error(
      "Stored peer API key cannot be decrypted (was AUTH_SECRET rotated?) — re-register the peer",
    );
  }

  const url = peerUrl(peer, path);
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${apiKey}`);

  if (peer.cfAccessClientId && peer.encryptedCfAccessSecret) {
    try {
      headers.set("CF-Access-Client-Id", peer.cfAccessClientId);
      headers.set("CF-Access-Client-Secret", decrypt(peer.encryptedCfAccessSecret));
    } catch (error) {
      log.error("Failed to decrypt peer CF Access secret", {
        peerId: peer.id,
        error: String(error),
      });
      throw new Error(
        "Stored peer CF Access secret cannot be decrypted — re-register the peer",
      );
    }
  }

  log.debug("fetching peer endpoint", { peerId: peer.id, path });
  return fetchImpl(url, { ...init, headers });
}
