/**
 * Tests for `src/lib/qr-provisioning.ts` (remote-dev-8xfo).
 *
 * The composer builds the versioned CF service-token envelope the mobile app's
 * `QrPayload.parse` consumes. These tests pin the exact serialised shape so the
 * two sides can't silently drift, and assert no extraneous fields leak in.
 *
 * NOTE: fixture credential values are obvious placeholders so no realistic
 * secret rides in the test source.
 */

import { describe, it, expect } from "vitest";
import {
  buildCfServiceTokenPayload,
  CF_SERVICE_TOKEN_TYPE,
  QR_PAYLOAD_VERSION,
} from "../qr-provisioning";

describe("buildCfServiceTokenPayload", () => {
  it("emits the versioned envelope with exactly the expected fields", () => {
    const json = buildCfServiceTokenPayload({
      host: "https://dev.example.com",
      clientId: "cid.public",
      clientSecret: "placeholder-secret",
    });
    const parsed = JSON.parse(json);

    expect(parsed).toEqual({
      v: 1,
      type: "rdv.cfServiceToken",
      host: "https://dev.example.com",
      clientId: "cid.public",
      clientSecret: "placeholder-secret",
    });
    // No extraneous fields beyond the five-field contract.
    expect(Object.keys(parsed).sort()).toEqual([
      "clientId",
      "clientSecret",
      "host",
      "type",
      "v",
    ]);
  });

  it("uses the exported version and type constants", () => {
    const parsed = JSON.parse(
      buildCfServiceTokenPayload({
        host: "https://h",
        clientId: "c",
        clientSecret: "s",
      }),
    );
    expect(parsed.v).toBe(QR_PAYLOAD_VERSION);
    expect(parsed.type).toBe(CF_SERVICE_TOKEN_TYPE);
  });

  it("trims surrounding whitespace from host and clientId", () => {
    const parsed = JSON.parse(
      buildCfServiceTokenPayload({
        host: "  https://dev.example.com  ",
        clientId: "  cid.public  ",
        clientSecret: "placeholder-secret",
      }),
    );
    expect(parsed.host).toBe("https://dev.example.com");
    expect(parsed.clientId).toBe("cid.public");
  });

  it("preserves the secret verbatim (does not trim it)", () => {
    const secret = "  spaces-matter-in-secret  ";
    const parsed = JSON.parse(
      buildCfServiceTokenPayload({
        host: "https://h",
        clientId: "c",
        clientSecret: secret,
      }),
    );
    expect(parsed.clientSecret).toBe(secret);
  });

  it("produces a string parseable as the mobile parser would receive it", () => {
    const json = buildCfServiceTokenPayload({
      host: "https://dev.example.com",
      clientId: "cid",
      clientSecret: "placeholder-secret",
    });
    // Round-trips through JSON without throwing and yields an object with a
    // `type` discriminator (the mobile parser keys typed envelopes off `type`).
    const parsed = JSON.parse(json);
    expect(typeof parsed).toBe("object");
    expect(typeof parsed.type).toBe("string");
  });
});
