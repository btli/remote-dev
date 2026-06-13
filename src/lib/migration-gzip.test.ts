// @vitest-environment node
/**
 * migration-gzip — round-trip + request-decoding tests.
 *
 * The DB bundle travels as ONE POST body; a gzip-aware source compresses it so
 * the on-wire request stays under the wire path's ~100 MB cap, and the
 * destination must gunzip a `Content-Encoding: gzip` request (Next.js does NOT
 * auto-decompress request bodies). These tests lock both halves of that contract.
 */
import { describe, it, expect } from "vitest";
import { gunzipSync } from "node:zlib";
import { GZIP_CONTENT_ENCODING, gzipJson, readMaybeGzippedJson } from "./migration-gzip";

const SAMPLE = {
  version: 1,
  project: { id: "p1", name: "Repeated keys compress well" },
  rows: Array.from({ length: 50 }, (_, i) => ({ id: `id-${i}`, label: "x".repeat(20) })),
};

describe("gzipJson", () => {
  it("produces bytes that gunzip back to the original JSON", () => {
    return gzipJson(SAMPLE).then((compressed) => {
      expect(Buffer.isBuffer(compressed)).toBe(true);
      const restored = JSON.parse(gunzipSync(compressed).toString("utf8"));
      expect(restored).toEqual(SAMPLE);
    });
  });

  it("actually shrinks a repetitive payload", async () => {
    const raw = Buffer.byteLength(JSON.stringify(SAMPLE), "utf8");
    const compressed = (await gzipJson(SAMPLE)).length;
    expect(compressed).toBeLessThan(raw);
  });
});

describe("readMaybeGzippedJson", () => {
  it("decodes a gzip-compressed request body (Content-Encoding: gzip)", async () => {
    const compressed = await gzipJson(SAMPLE);
    const request = new Request("https://dest/api/migration/imports", {
      method: "POST",
      headers: { "content-type": "application/json", "content-encoding": GZIP_CONTENT_ENCODING },
      body: new Uint8Array(compressed),
    });
    expect(await readMaybeGzippedJson(request)).toEqual(SAMPLE);
  });

  it("reads a plain (uncompressed) JSON body unchanged", async () => {
    const request = new Request("https://dest/api/migration/imports", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(SAMPLE),
    });
    expect(await readMaybeGzippedJson(request)).toEqual(SAMPLE);
  });

  it("round-trips gzip → decode for a large body (multi-MB) intact", async () => {
    const big = {
      ...SAMPLE,
      rows: Array.from({ length: 20000 }, (_, i) => ({ id: `id-${i}`, label: "y".repeat(64) })),
    };
    const compressed = await gzipJson(big);
    // Compression keeps the wire body far below the raw size.
    expect(compressed.length).toBeLessThan(Buffer.byteLength(JSON.stringify(big), "utf8"));
    const request = new Request("https://dest/api/migration/imports", {
      method: "POST",
      headers: { "content-encoding": "gzip" },
      body: new Uint8Array(compressed),
    });
    expect(await readMaybeGzippedJson(request)).toEqual(big);
  });

  it("throws on malformed gzip bytes", async () => {
    const request = new Request("https://dest/api/migration/imports", {
      method: "POST",
      headers: { "content-encoding": "gzip" },
      body: new Uint8Array([1, 2, 3, 4, 5]),
    });
    await expect(readMaybeGzippedJson(request)).rejects.toThrow();
  });
});
