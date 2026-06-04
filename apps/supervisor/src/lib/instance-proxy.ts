/**
 * Instance proxy — authenticated server-to-server fetch into an instance's data
 * plane (epic remote-dev-oyej.10).
 *
 * The instance image is slug-aware: it serves its app under `/<slug>` behind the
 * supervisor router (single front door). So a call to instance `:slug` is
 * `https://${SUPERVISOR_INSTANCE_HOST}/${slug}${path}`, carrying the instance's
 * programmatic credential as `Authorization: Bearer <key>`.
 *
 * Per-instance API keys are the eventual model; for the homelab single-key
 * deployment we resolve one shared key from `SUPERVISOR_INSTANCE_API_KEY`. The
 * per-instance-key upgrade path is documented in docs/AUTOMATION.md.
 */
import { createLogger } from "@/lib/logger";

const log = createLogger("instance-proxy");

/** The subset of an instance row the proxy needs. */
export interface ProxyInstance {
  slug: string;
  baseUrl?: string | null;
}

/** Resolve the base origin instances are served from. */
function instanceHost(): string {
  const host = process.env.SUPERVISOR_INSTANCE_HOST;
  if (!host) {
    throw new Error("SUPERVISOR_INSTANCE_HOST is not set");
  }
  // Allow either a bare host or a full origin.
  return host.startsWith("http") ? host : `https://${host}`;
}

/** Resolve the instance programmatic credential (single-key homelab model). */
function instanceApiKey(): string | null {
  return process.env.SUPERVISOR_INSTANCE_API_KEY ?? null;
}

/**
 * Build the absolute URL for an instance data-plane path. Prefers the
 * instance's recorded `baseUrl` when set; otherwise composes
 * `${host}/${slug}${path}`.
 */
export function instanceUrl(row: ProxyInstance, path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  if (row.baseUrl) {
    return `${row.baseUrl.replace(/\/$/, "")}${p}`;
  }
  return `${instanceHost().replace(/\/$/, "")}/${row.slug}${p}`;
}

/**
 * Fetch an instance data-plane endpoint with the instance credential attached.
 * Throws when no instance API key is configured (callers surface a clear error).
 */
export async function instanceFetch(
  row: ProxyInstance,
  path: string,
  init: RequestInit = {},
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const key = instanceApiKey();
  if (!key) {
    throw new Error(
      "SUPERVISOR_INSTANCE_API_KEY is not set (required to proxy into instance data planes)",
    );
  }
  const url = instanceUrl(row, path);
  log.debug("proxying to instance data plane", { slug: row.slug, path });
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${key}`);
  return fetchImpl(url, { ...init, headers });
}
