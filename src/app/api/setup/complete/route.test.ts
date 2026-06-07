// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the shared setup gate so each test drives the gate decision directly; the
// gate's own logic is covered in src/lib/__tests__/setup-gate.test.ts. POST uses
// hasValidSession + isFirstRunOpen (it resolves the session once, then re-checks
// completion inside the transaction); GET uses isSetupRequestAllowed.
vi.mock("@/lib/setup-gate", () => ({
  hasValidSession: vi.fn(),
  isFirstRunOpen: vi.fn(),
  isSetupRequestAllowed: vi.fn(),
}));

// The route reads setup_config via db.query.setupConfig.findFirst (GET) and runs
// the POST read-decide-write inside db.transaction(cb) where the re-read +
// writes go through `tx`. We give `tx` its OWN findFirst spy (txFindFirst) so the
// TOCTOU test can make the in-transaction re-read disagree with anything else.
// The transaction propagates thrown errors and performs no write on throw, so a
// SetupForbiddenError surfaces as a 401 with nothing written.
const findFirst = vi.fn(); // GET path
const txFindFirst = vi.fn(); // POST in-transaction re-read
const setSpy = vi.fn();
const whereSpy = vi.fn().mockResolvedValue(undefined);
const valuesSpy = vi.fn().mockResolvedValue(undefined);

const tx = {
  query: { setupConfig: { findFirst: () => txFindFirst() } },
  update: () => ({ set: (...a: unknown[]) => setSpy(...a) }),
  insert: () => ({ values: (...a: unknown[]) => valuesSpy(...a) }),
};

vi.mock("@/db", () => ({
  db: {
    query: { setupConfig: { findFirst: () => findFirst() } },
    transaction: async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx),
  },
}));

// existsSync is consulted to validate the supplied workingDirectory; force true
// so POST validation passes and we reach the gate-relevant code paths.
vi.mock("node:fs", () => ({ existsSync: () => true }));

import type { NextRequest } from "next/server";
import {
  hasValidSession,
  isFirstRunOpen,
  isSetupRequestAllowed,
} from "@/lib/setup-gate";
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
    vi.mocked(hasValidSession).mockReset();
    vi.mocked(isFirstRunOpen).mockReset();
    txFindFirst.mockReset();
    setSpy.mockClear();
    whereSpy.mockClear();
    valuesSpy.mockClear();
    setSpy.mockReturnValue({ where: (...a: unknown[]) => whereSpy(...a) });
  });

  it("allows the write when first-run is open and there is no session (insert path)", async () => {
    vi.mocked(hasValidSession).mockResolvedValue(false);
    vi.mocked(isFirstRunOpen).mockResolvedValue(true);
    txFindFirst.mockResolvedValue(undefined); // no existing row → insert

    const res = await POST(postRequest(VALID_CONFIG));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ success: true });
    expect(valuesSpy).toHaveBeenCalledTimes(1);
  });

  it("allows the write when setup is complete and the caller has a session (update path)", async () => {
    vi.mocked(hasValidSession).mockResolvedValue(true);
    vi.mocked(isFirstRunOpen).mockResolvedValue(false); // not consulted (authed short-circuits)
    txFindFirst.mockResolvedValue({ id: "cfg-1", isComplete: true }); // existing → update

    const res = await POST(postRequest(VALID_CONFIG));
    expect(res.status).toBe(200);
    expect(setSpy).toHaveBeenCalledTimes(1);
    expect(whereSpy).toHaveBeenCalledTimes(1);
    // An authenticated caller never needs the first-run-open check.
    expect(isFirstRunOpen).not.toHaveBeenCalled();
  });

  it("returns 401 up front when not authed and first-run is closed (no DB write)", async () => {
    vi.mocked(hasValidSession).mockResolvedValue(false);
    vi.mocked(isFirstRunOpen).mockResolvedValue(false);

    const res = await POST(postRequest(VALID_CONFIG));
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "Unauthorized" });
    // Rejected before the transaction even opens.
    expect(txFindFirst).not.toHaveBeenCalled();
    expect(valuesSpy).not.toHaveBeenCalled();
    expect(setSpy).not.toHaveBeenCalled();
  });

  it("TOCTOU: passes the up-front gate but the in-transaction re-read shows complete + no session → 401, nothing written", async () => {
    // Simulate the race: the up-front gate sees first-run OPEN (a concurrent POST
    // has not yet committed), but by the time our transaction re-reads, the row is
    // already complete. With no session, the in-transaction guard must reject and
    // write nothing.
    vi.mocked(hasValidSession).mockResolvedValue(false);
    vi.mocked(isFirstRunOpen).mockResolvedValue(true); // up-front: still open
    txFindFirst.mockResolvedValue({ id: "cfg-1", isComplete: true }); // re-read: now complete

    const res = await POST(postRequest(VALID_CONFIG));
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "Unauthorized" });
    // The overwrite was prevented inside the transaction.
    expect(setSpy).not.toHaveBeenCalled();
    expect(valuesSpy).not.toHaveBeenCalled();
  });

  it("authed caller may overwrite a completed config even if first-run looks open (no spurious 401)", async () => {
    vi.mocked(hasValidSession).mockResolvedValue(true);
    txFindFirst.mockResolvedValue({ id: "cfg-1", isComplete: true });

    const res = await POST(postRequest(VALID_CONFIG));
    expect(res.status).toBe(200);
    expect(setSpy).toHaveBeenCalledTimes(1);
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
