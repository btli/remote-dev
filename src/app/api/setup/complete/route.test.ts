// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

// Gate the route behind a mock of the shared setup gate so each test drives
// allow/deny directly; the gate's own logic is covered in
// src/lib/__tests__/setup-gate.test.ts.
vi.mock("@/lib/setup-gate", () => ({
  isSetupRequestAllowed: vi.fn(),
}));

// The route reads/writes setup_config via db.query.setupConfig.findFirst,
// db.update(...).set(...).where(...) and db.insert(...).values(...). Back those
// with controllable spies. The chained builders just need to be awaitable.
const findFirst = vi.fn();
const setSpy = vi.fn();
const whereSpy = vi.fn().mockResolvedValue(undefined);
const valuesSpy = vi.fn().mockResolvedValue(undefined);
vi.mock("@/db", () => ({
  db: {
    query: { setupConfig: { findFirst: () => findFirst() } },
    update: () => ({ set: (...a: unknown[]) => setSpy(...a) }),
    insert: () => ({ values: (...a: unknown[]) => valuesSpy(...a) }),
  },
}));

// existsSync is consulted to validate the supplied workingDirectory; force true
// so POST validation passes and we reach the gate-relevant code paths.
vi.mock("node:fs", () => ({ existsSync: () => true }));

import type { NextRequest } from "next/server";
import { isSetupRequestAllowed } from "@/lib/setup-gate";
import { GET, POST } from "./route";

setSpy.mockReturnValue({ where: (...a: unknown[]) => whereSpy(...a) });

const VALID_CONFIG = {
  workingDirectory: "/home/user/projects",
  nextPort: 6001,
  terminalPort: 6002,
  wslDistribution: undefined,
  autoStart: true,
  checkForUpdates: true,
};

function postRequest(body: unknown): NextRequest {
  return new Request("http://localhost/api/setup/complete", {
    method: "POST",
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

describe("POST /api/setup/complete", () => {
  beforeEach(() => {
    vi.mocked(isSetupRequestAllowed).mockReset();
    findFirst.mockReset();
    setSpy.mockClear();
    whereSpy.mockClear();
    valuesSpy.mockClear();
    setSpy.mockReturnValue({ where: (...a: unknown[]) => whereSpy(...a) });
  });

  it("allows the write when setup is incomplete and there is no session (first run)", async () => {
    vi.mocked(isSetupRequestAllowed).mockResolvedValue(true);
    findFirst.mockResolvedValue(undefined); // no existing row → insert path

    const res = await POST(postRequest(VALID_CONFIG));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ success: true });
    expect(valuesSpy).toHaveBeenCalledTimes(1);
  });

  it("allows the write when setup is complete and the caller has a session (update path)", async () => {
    vi.mocked(isSetupRequestAllowed).mockResolvedValue(true);
    findFirst.mockResolvedValue({ id: "cfg-1", isComplete: true }); // existing → update

    const res = await POST(postRequest(VALID_CONFIG));
    expect(res.status).toBe(200);
    expect(setSpy).toHaveBeenCalledTimes(1);
    expect(whereSpy).toHaveBeenCalledTimes(1);
  });

  it("returns 401 when setup is complete and there is no session", async () => {
    vi.mocked(isSetupRequestAllowed).mockResolvedValue(false);

    const res = await POST(postRequest(VALID_CONFIG));
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "Unauthorized" });
    // The gate runs BEFORE any DB write.
    expect(valuesSpy).not.toHaveBeenCalled();
    expect(setSpy).not.toHaveBeenCalled();
  });
});

describe("GET /api/setup/complete", () => {
  beforeEach(() => {
    vi.mocked(isSetupRequestAllowed).mockReset();
    findFirst.mockReset();
  });

  it("returns { isComplete: false } when setup is not complete (no gate needed)", async () => {
    findFirst.mockResolvedValue({ isComplete: false });

    const res = await GET();
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ isComplete: false });
  });

  it("hides the config payload when setup is complete and there is no session", async () => {
    findFirst.mockResolvedValue({
      isComplete: true,
      workingDirectory: "/secret/path",
      nextPort: 6001,
      terminalPort: 6002,
      wslDistribution: "Ubuntu",
      autoStart: true,
      checkForUpdates: true,
    });
    vi.mocked(isSetupRequestAllowed).mockResolvedValue(false);

    const res = await GET();
    expect(res.status).toBe(200);
    // Only the flag — no config (no path/port disclosure).
    await expect(res.json()).resolves.toEqual({ isComplete: true });
  });

  it("includes the config payload when setup is complete and the caller has a session", async () => {
    findFirst.mockResolvedValue({
      isComplete: true,
      workingDirectory: "/home/user/projects",
      nextPort: 6001,
      terminalPort: 6002,
      wslDistribution: "Ubuntu",
      autoStart: true,
      checkForUpdates: true,
    });
    vi.mocked(isSetupRequestAllowed).mockResolvedValue(true);

    const res = await GET();
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      isComplete: true,
      config: {
        workingDirectory: "/home/user/projects",
        nextPort: 6001,
        terminalPort: 6002,
        wslDistribution: "Ubuntu",
        autoStart: true,
        checkForUpdates: true,
      },
    });
  });
});
