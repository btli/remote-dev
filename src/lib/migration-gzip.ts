/**
 * Gzip helpers for the migration DB-bundle POST.
 *
 * The whole {@link import("./migration-bundle").DbBundle} travels as ONE JSON
 * POST body (`POST /api/migration/imports`). The wire path between two
 * instances (Cloudflare and/or the supervisor router) caps the on-wire request
 * size at ~100 MB, and that cap is measured against the COMPRESSED bytes on the
 * wire. A DbBundle is highly repetitive JSON text (column keys repeated per
 * row), so gzip typically shrinks it 5–15×, multiplying the headroom of that
 * fixed ceiling instead of raising the ceiling itself.
 *
 * Kept separate from `migration-bundle.ts` (which must stay Node-runtime-free —
 * it defines the cross-version wire contract) because gzip needs `node:zlib`.
 *
 * Next.js App Router on Node does NOT auto-decompress REQUEST bodies (only
 * responses), so the destination must explicitly gunzip when the request
 * carries `Content-Encoding: gzip` — {@link readMaybeGzippedJson} does that.
 */
import { gunzip, gzip } from "node:zlib";
import { promisify } from "node:util";

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

/** The content-encoding value used for a gzip-compressed bundle body. */
export const GZIP_CONTENT_ENCODING = "gzip";

/**
 * Gzip a value's JSON serialization. Returns the compressed bytes; the caller
 * sends them with `Content-Encoding: gzip` + `Content-Type: application/json`.
 */
export async function gzipJson(value: unknown): Promise<Buffer> {
  return gzipAsync(Buffer.from(JSON.stringify(value), "utf8"));
}

/**
 * Parse a JSON request body, transparently gunzipping it first when the request
 * declared `Content-Encoding: gzip`. Used by the destination import route so a
 * gzip-aware source and a plain-JSON source are both accepted. Throws on
 * malformed gzip or JSON (the route maps that to a 400).
 */
export async function readMaybeGzippedJson<T>(request: Request): Promise<T> {
  const encoding = (request.headers.get("content-encoding") ?? "")
    .toLowerCase()
    .trim();
  if (encoding === GZIP_CONTENT_ENCODING || encoding === "x-gzip") {
    const compressed = Buffer.from(await request.arrayBuffer());
    const json = (await gunzipAsync(compressed)).toString("utf8");
    return JSON.parse(json) as T;
  }
  // No (recognized) content-encoding: a plain JSON body.
  return (await request.json()) as T;
}
