// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/setup-gate", () => ({
  isSetupRequestAllowed: vi.fn(),
}));

// Stub child_process so package-manager detection never shells out for real.
vi.mock("node:child_process", () => ({
  execFile: (
    _cmd: string,
    _args: string[],
    _opts: unknown,
    cb: (err: Error | null, out: { stdout: string; stderr: string }) => void,
  ) => cb(new Error("not found"), { stdout: "", stderr: "" }),
}));

import { isSetupRequestAllowed } from "@/lib/setup-gate";
import { GET } from "./route";

describe("GET /api/setup/platform", () => {
  beforeEach(() => {
    vi.mocked(isSetupRequestAllowed).mockReset();
  });

  it("returns 401 when setup is complete and there is no session", async () => {
    vi.mocked(isSetupRequestAllowed).mockResolvedValue(false);

    const res = await GET();
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "Unauthorized" });
  });

  it("returns platform info when allowed (first run / authenticated)", async () => {
    vi.mocked(isSetupRequestAllowed).mockResolvedValue(true);

    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { os: string; arch: string };
    expect(typeof body.os).toBe("string");
    expect(typeof body.arch).toBe("string");
  });
});
