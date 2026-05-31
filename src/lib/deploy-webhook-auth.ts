import { createHmac, timingSafeEqual } from "crypto";

/**
 * Verify an HMAC-SHA256 signature header (`sha256=<hex>`) over `data`, keyed by
 * `secret`. Used for both the deploy webhook (signature over the raw request
 * body) and the deploy-status endpoint (signature over the commit query value).
 * Rejects a length mismatch up front (the expected length is a non-secret
 * constant — "sha256=" + 64 hex) so timingSafeEqual never throws, then compares
 * in constant time.
 */
export function verifySignature(
  secret: string,
  data: Buffer,
  signatureHeader: string,
): boolean {
  const expected =
    "sha256=" + createHmac("sha256", secret).update(data).digest("hex");
  const expectedBuf = Buffer.from(expected);
  const sigBuf = Buffer.from(signatureHeader);
  if (sigBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(sigBuf, expectedBuf);
}
