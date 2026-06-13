/**
 * Peer fetch — authenticated server-to-server fetch into a registered peer
 * Remote Dev instance (server-to-server project migration).
 *
 * Mirrors apps/supervisor/src/lib/instance-proxy.ts: compose
 * `${baseUrl}${path}`, attach the peer's API key as `Authorization: Bearer`
 * (decrypted from the registry row at call time, never persisted in plain),
 * and — when the peer sits behind Cloudflare Access — the CF Access
 * service-token header pair so the edge admits the request.
 *
 * `redirect: "manual"` is deliberate: a Cloudflare-Access challenge (off-LAN,
 * no/expired service token) or an OIDC login flow answers with a 3xx to an
 * HTML login page. Following it would make the downstream `response.json()`
 * choke on `<!doctype html>` ("Unexpected token '<'"). With manual redirect
 * the 3xx stays a real, inspectable Response so {@link readPeerJson} can turn
 * it into an actionable error ("destination behind Cloudflare Access…").
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
  /** Optional, for clearer error messages — falls back to the id. */
  name?: string | null;
}

/** Build the absolute URL for a peer data-plane path. */
export function peerUrl(peer: Pick<PeerTarget, "baseUrl">, path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${peer.baseUrl.replace(/\/$/, "")}${p}`;
}

/**
 * Fetch a peer endpoint with the peer credential attached. Throws when:
 *  - the stored API key cannot be decrypted (e.g. AUTH_SECRET changed), or
 *  - exactly one half of the Cloudflare Access service-token pair is set
 *    (sending a half credential would silently fail the edge check).
 *
 * Redirects are NOT followed (see the module header) — a 3xx is returned to
 * the caller verbatim so it can be reported as a credential/URL problem.
 */
export async function peerFetch(
  peer: PeerTarget,
  path: string,
  init: RequestInit = {},
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const label = peer.name?.trim() || peer.id;

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

  // Cloudflare Access service token: both halves or neither. A lone half is
  // almost always a copy-paste slip — sending it produces an opaque edge 302
  // rather than a clear "missing secret", so reject it up front.
  const hasCfId = !!peer.cfAccessClientId?.trim();
  const hasCfSecret = !!peer.encryptedCfAccessSecret;
  if (hasCfId !== hasCfSecret) {
    const present = hasCfId ? "Client ID" : "Client Secret";
    const missing = hasCfId ? "Client Secret" : "Client ID";
    throw new Error(
      `Peer ${label}: Cloudflare Access ${present} is set but the ${missing} is missing — ` +
        "re-save the peer with both, or neither",
    );
  }
  if (hasCfId && hasCfSecret) {
    try {
      headers.set("CF-Access-Client-Id", peer.cfAccessClientId as string);
      headers.set("CF-Access-Client-Secret", decrypt(peer.encryptedCfAccessSecret as string));
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
  // `redirect: "manual"` keeps a CF-Access/OIDC 302 as an opaque-redirect
  // Response instead of chasing it into an HTML login page.
  return fetchImpl(url, { ...init, redirect: "manual", headers });
}

/**
 * Parse a JSON response from a peer, turning every cross-instance failure
 * mode into a debuggable error rather than an opaque crash:
 *
 *  - 3xx (manual redirect): almost always Cloudflare Access / OIDC bouncing
 *    an unauthenticated request to a login page, or a wrong Base URL.
 *  - 401: the destination rejected the API key.
 *  - 404: usually a Base URL missing the instance path prefix (Shape B slug).
 *  - any other non-2xx: status + a short body snippet.
 *  - 2xx but non-JSON (an HTML login page slipped through): flag the
 *    content-type so the user knows it's an auth wall, not their data.
 *
 * On success returns the parsed JSON typed as `T`.
 */
export async function readPeerJson<T = unknown>(
  response: Response,
  context: string,
): Promise<T> {
  // A manual-redirect fetch surfaces 3xx as either `response.redirected`/an
  // opaque-redirect `type`, or (Node undici) a normal Response with a 3xx
  // status. Catch both shapes.
  const isRedirect =
    response.type === "opaqueredirect" ||
    (response.status >= 300 && response.status < 400);
  if (isRedirect) {
    throw new Error(
      `Peer ${context}: unexpected redirect (HTTP ${response.status || "3xx"}) — ` +
        "the destination is likely behind Cloudflare Access without a service token on " +
        "this peer, or the Base URL is wrong",
    );
  }

  if (!response.ok) {
    const snippet = await bodySnippet(response);
    if (response.status === 401) {
      throw new Error(
        `Peer ${context}: destination rejected the API key (401) — confirm an API key for ` +
          "YOUR user exists on the destination instance and was copied exactly" +
          (snippet ? ` · ${snippet}` : ""),
      );
    }
    if (response.status === 404) {
      throw new Error(
        `Peer ${context}: not found (404) — check the Base URL includes the instance path ` +
          "prefix, e.g. https://rdv.joyful.house/homelab" +
          (snippet ? ` · ${snippet}` : ""),
      );
    }
    throw new Error(
      `Peer ${context}: destination returned HTTP ${response.status}` +
        (snippet ? ` — ${snippet}` : ""),
    );
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!/\bjson\b/i.test(contentType)) {
    const ct = contentType || "no content-type";
    throw new Error(
      `Peer ${context}: expected JSON but got ${ct} — likely a Cloudflare Access / OIDC ` +
        "login page; check the peer's credentials and Base URL",
    );
  }

  return (await response.json()) as T;
}

/** Read a short, single-line body snippet for an error message (best effort). */
async function bodySnippet(response: Response): Promise<string> {
  try {
    const text = (await response.text()).trim().replace(/\s+/g, " ");
    return text ? text.slice(0, 200) : "";
  } catch {
    return "";
  }
}
