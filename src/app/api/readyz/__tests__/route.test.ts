// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

// Use `vi.stubGlobal` to replace global `fetch`. `vi.spyOn(globalThis, "fetch")`
// is unreliable here because fetch is inherited from the realm prototype in
// the node test environment, not an own property of globalThis. stubGlobal
// installs the mock as an own property and restores cleanly via `unstubAllGlobals`.
const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

function mockTerminalHealthy(): void {
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ status: "ok" }), { status: 200 }));
}

function mockTerminalDown(error: Error): void {
  fetchMock.mockRejectedValue(error);
}

function mockTerminalUnhealthyStatus(status: number): void {
  fetchMock.mockResolvedValue(new Response("", { status }));
}

describe("GET /api/readyz", () => {
  beforeEach(() => {
    mockedDbRun.mockReset();
    mockedExecFile.mockReset();
    fetchMock.mockReset();
  });

  afterEach(() => {
    // No-op for now; stubGlobal persists across this describe block, which
    // is the intent (every test mocks fetch). If a later suite needs the
    // real fetch back, add `vi.unstubAllGlobals()` here.
  });

  it("returns 200 with checks=true when DB, tmux, and terminal are healthy", async () => {
    mockedDbRun.mockResolvedValue(undefined as never);
    mockedExecFile.mockResolvedValue({ stdout: "tmux 3.4", stderr: "", exitCode: 0 });
    mockTerminalHealthy();

    const response = await GET();
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ready: boolean; checks: Record<string, { ok: boolean }> };
    expect(body.ready).toBe(true);
    expect(body.checks.db.ok).toBe(true);
    expect(body.checks.tmux.ok).toBe(true);
    expect(body.checks.terminal.ok).toBe(true);
  });

  it("returns 503 when the DB probe fails", async () => {
    mockedDbRun.mockRejectedValue(new Error("database is locked"));
    mockedExecFile.mockResolvedValue({ stdout: "tmux 3.4", stderr: "", exitCode: 0 });
    mockTerminalHealthy();

    const response = await GET();
    expect(response.status).toBe(503);
    const body = (await response.json()) as { ready: boolean; checks: Record<string, { ok: boolean; error?: string }> };
    expect(body.ready).toBe(false);
    expect(body.checks.db.ok).toBe(false);
    expect(body.checks.db.error).toContain("database is locked");
    expect(body.checks.tmux.ok).toBe(true);
    expect(body.checks.terminal.ok).toBe(true);
  });

  it("returns 503 when tmux is missing", async () => {
    mockedDbRun.mockResolvedValue(undefined as never);
    mockedExecFile.mockRejectedValue(new Error("ENOENT: tmux not found"));
    mockTerminalHealthy();

    const response = await GET();
    expect(response.status).toBe(503);
    const body = (await response.json()) as { ready: boolean; checks: Record<string, { ok: boolean; error?: string }> };
    expect(body.ready).toBe(false);
    expect(body.checks.tmux.ok).toBe(false);
    expect(body.checks.tmux.error).toContain("ENOENT");
  });

  it("returns 503 when the terminal server is unreachable", async () => {
    mockedDbRun.mockResolvedValue(undefined as never);
    mockedExecFile.mockResolvedValue({ stdout: "tmux 3.4", stderr: "", exitCode: 0 });
    mockTerminalDown(new Error("ECONNREFUSED"));

    const response = await GET();
    expect(response.status).toBe(503);
    const body = (await response.json()) as { ready: boolean; checks: Record<string, { ok: boolean; error?: string }> };
    expect(body.ready).toBe(false);
    expect(body.checks.terminal.ok).toBe(false);
    expect(body.checks.terminal.error).toContain("ECONNREFUSED");
    // DB + tmux still report healthy independently
    expect(body.checks.db.ok).toBe(true);
    expect(body.checks.tmux.ok).toBe(true);
  });

  it("returns 503 when the terminal server returns a non-200", async () => {
    mockedDbRun.mockResolvedValue(undefined as never);
    mockedExecFile.mockResolvedValue({ stdout: "tmux 3.4", stderr: "", exitCode: 0 });
    mockTerminalUnhealthyStatus(500);

    const response = await GET();
    expect(response.status).toBe(503);
    const body = (await response.json()) as { ready: boolean; checks: Record<string, { ok: boolean; error?: string }> };
    expect(body.ready).toBe(false);
    expect(body.checks.terminal.ok).toBe(false);
    expect(body.checks.terminal.error).toContain("HTTP 500");
  });

  it("returns 503 when all probes fail", async () => {
    mockedDbRun.mockRejectedValue(new Error("disk full"));
    mockedExecFile.mockRejectedValue(new Error("no tmux"));
    mockTerminalDown(new Error("no terminal"));

    const response = await GET();
    expect(response.status).toBe(503);
    const body = (await response.json()) as { ready: boolean };
    expect(body.ready).toBe(false);
  });
});
