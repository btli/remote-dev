// @vitest-environment node
import { describe, expect, it } from "vitest";

import { GET } from "../route";

describe("GET /api/healthz", () => {
  it("returns 200 with status: ok (no auth required)", async () => {
    const response = GET();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok" });
  });
});
