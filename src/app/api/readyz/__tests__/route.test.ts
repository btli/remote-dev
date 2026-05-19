// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the DB and exec helpers before importing the route handler so the
// handler closes over the mocks. `db.run` returns a libsql ResultSet; we
// return a minimal Promise that resolves to `undefined` since the route
// only cares about throw-vs-resolve.
vi.mock("@/db", () => ({
  db: { run: vi.fn() },
}));
vi.mock("@/lib/exec", () => ({
  execFile: vi.fn(),
}));

import { db } from "@/db";
import { execFile } from "@/lib/exec";
import { GET } from "../route";

const mockedDbRun = vi.mocked(db.run);
const mockedExecFile = vi.mocked(execFile);

describe("GET /api/readyz", () => {
  beforeEach(() => {
    mockedDbRun.mockReset();
    mockedExecFile.mockReset();
  });

  it("returns 200 with checks=true when DB and tmux are healthy", async () => {
    mockedDbRun.mockResolvedValue(undefined as never);
    mockedExecFile.mockResolvedValue({ stdout: "tmux 3.4", stderr: "", exitCode: 0 });

    const response = await GET();
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ready: boolean; checks: Record<string, { ok: boolean }> };
    expect(body.ready).toBe(true);
    expect(body.checks.db.ok).toBe(true);
    expect(body.checks.tmux.ok).toBe(true);
  });

  it("returns 503 when the DB probe fails", async () => {
    mockedDbRun.mockRejectedValue(new Error("database is locked"));
    mockedExecFile.mockResolvedValue({ stdout: "tmux 3.4", stderr: "", exitCode: 0 });

    const response = await GET();
    expect(response.status).toBe(503);
    const body = (await response.json()) as { ready: boolean; checks: Record<string, { ok: boolean; error?: string }> };
    expect(body.ready).toBe(false);
    expect(body.checks.db.ok).toBe(false);
    expect(body.checks.db.error).toContain("database is locked");
    expect(body.checks.tmux.ok).toBe(true);
  });

  it("returns 503 when tmux is missing", async () => {
    mockedDbRun.mockResolvedValue(undefined as never);
    mockedExecFile.mockRejectedValue(new Error("ENOENT: tmux not found"));

    const response = await GET();
    expect(response.status).toBe(503);
    const body = (await response.json()) as { ready: boolean; checks: Record<string, { ok: boolean; error?: string }> };
    expect(body.ready).toBe(false);
    expect(body.checks.tmux.ok).toBe(false);
    expect(body.checks.tmux.error).toContain("ENOENT");
  });

  it("returns 503 when both probes fail", async () => {
    mockedDbRun.mockRejectedValue(new Error("disk full"));
    mockedExecFile.mockRejectedValue(new Error("no tmux"));

    const response = await GET();
    expect(response.status).toBe(503);
    const body = (await response.json()) as { ready: boolean };
    expect(body.ready).toBe(false);
  });
});
