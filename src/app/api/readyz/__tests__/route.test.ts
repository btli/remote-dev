// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";

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

// The route picks its transport (Unix socket vs TCP) from env at call time:
// `TERMINAL_SOCKET` → `node:http` request; else `TERMINAL_PORT` → fetch. We
// mock `http.request` so the socket-mode tests are hermetic, and stub `fetch`
// for the TCP-mode tests. Mock `node:http` before importing the route.
const httpRequestMock = vi.fn();
vi.mock("node:http", () => ({
  default: { request: (...args: unknown[]) => httpRequestMock(...args) },
  request: (...args: unknown[]) => httpRequestMock(...args),
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

const ORIGINAL_TERMINAL_SOCKET = process.env.TERMINAL_SOCKET;
const ORIGINAL_TERMINAL_PORT = process.env.TERMINAL_PORT;

function mockTerminalHealthy(): void {
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ status: "ok" }), { status: 200 }));
}

function mockTerminalDown(error: Error): void {
  fetchMock.mockRejectedValue(error);
}

function mockTerminalUnhealthyStatus(status: number): void {
  fetchMock.mockResolvedValue(new Response("", { status }));
}

/**
 * Build a fake `http.ClientRequest` whose response emits `statusCode` then
 * ends. `httpRequestMock` invokes the route's response callback with it.
 *
 * Behaviors (mutually exclusive):
 *   - `error`: the request emits `error` instead of responding.
 *   - `fireTimeout`: simulate a wedged server. `req.setTimeout(ms, cb)` captures
 *     `cb` and invokes it synchronously on `req.end()` (the idle timeout firing);
 *     no response is ever produced, so `"end"` never emits.
 *   - otherwise: the response emits `statusCode` then ends.
 */
function stubHttpRequest(opts: { statusCode?: number; error?: Error; fireTimeout?: boolean }): void {
  httpRequestMock.mockImplementation((_options: unknown, cb?: (res: EventEmitter) => void) => {
    let timeoutCb: (() => void) | undefined;
    const req = new EventEmitter() as EventEmitter & {
      setTimeout: (ms: number, fn: () => void) => void;
      destroy: () => void;
      end: () => void;
    };
    req.setTimeout = (_ms: number, fn: () => void) => {
      // Capture so a wedged-server test can fire the production timeout branch.
      timeoutCb = fn;
    };
    req.destroy = () => {};
    req.end = () => {
      if (opts.fireTimeout) {
        // Wedged server: the idle timeout fires and no response ever arrives.
        timeoutCb?.();
        return;
      }
      queueMicrotask(() => {
        if (opts.error) {
          req.emit("error", opts.error);
          return;
        }
        const res = new EventEmitter() as EventEmitter & { statusCode?: number };
        res.statusCode = opts.statusCode ?? 200;
        cb?.(res);
        // Emit a chunk before "end" so the production drain handler
        // (`res.on("data", ...)`) is exercised. Valid for every status; only
        // the 2xx path's outcome is asserted, so this is purely coverage.
        res.emit("data", Buffer.from("{}"));
        res.emit("end");
      });
    };
    return req;
  });
}

beforeEach(() => {
  mockedDbRun.mockReset();
  mockedExecFile.mockReset();
  fetchMock.mockReset();
  httpRequestMock.mockReset();
});

afterEach(() => {
  if (ORIGINAL_TERMINAL_SOCKET === undefined) delete process.env.TERMINAL_SOCKET;
  else process.env.TERMINAL_SOCKET = ORIGINAL_TERMINAL_SOCKET;
  if (ORIGINAL_TERMINAL_PORT === undefined) delete process.env.TERMINAL_PORT;
  else process.env.TERMINAL_PORT = ORIGINAL_TERMINAL_PORT;
});

describe("GET /api/readyz — TCP/port mode (dev)", () => {
  beforeEach(() => {
    // Force the fetch/TCP path: no socket, explicit port.
    delete process.env.TERMINAL_SOCKET;
    process.env.TERMINAL_PORT = "6002";
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
    // Confirm we used the TCP path, not the socket path.
    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:6002/health", expect.anything());
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

describe("GET /api/readyz — Unix socket mode (prod)", () => {
  beforeEach(() => {
    // Force the socket path: TERMINAL_SOCKET set takes precedence.
    process.env.TERMINAL_SOCKET = "/tmp/rdv-test/terminal.sock";
    delete process.env.TERMINAL_PORT;
  });

  it("checks /health over the unix socket and returns 200 when healthy", async () => {
    mockedDbRun.mockResolvedValue(undefined as never);
    mockedExecFile.mockResolvedValue({ stdout: "tmux 3.4", stderr: "", exitCode: 0 });
    stubHttpRequest({ statusCode: 200 });

    const response = await GET();
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ready: boolean; checks: Record<string, { ok: boolean }> };
    expect(body.ready).toBe(true);
    expect(body.checks.terminal.ok).toBe(true);
    // fetch must NOT be used in socket mode; http.request must be, with the
    // socketPath + /health.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(httpRequestMock).toHaveBeenCalledWith(
      expect.objectContaining({ socketPath: "/tmp/rdv-test/terminal.sock", path: "/health" }),
      expect.any(Function),
    );
  });

  it("returns 503 when the terminal socket connection errors", async () => {
    mockedDbRun.mockResolvedValue(undefined as never);
    mockedExecFile.mockResolvedValue({ stdout: "tmux 3.4", stderr: "", exitCode: 0 });
    stubHttpRequest({ error: new Error("ENOENT: socket missing") });

    const response = await GET();
    expect(response.status).toBe(503);
    const body = (await response.json()) as { ready: boolean; checks: Record<string, { ok: boolean; error?: string }> };
    expect(body.ready).toBe(false);
    expect(body.checks.terminal.ok).toBe(false);
    expect(body.checks.terminal.error).toContain("ENOENT");
  });

  it("socket mode: a wedged terminal server (timeout) reports not-ready", async () => {
    mockedDbRun.mockResolvedValue(undefined as never);
    mockedExecFile.mockResolvedValue({ stdout: "tmux 3.4", stderr: "", exitCode: 0 });
    // Wedged server: connection opens but no response ever arrives, so the
    // 1s idle timeout fires. `fireTimeout` invokes the captured `setTimeout`
    // callback synchronously; the fake response never emits "end".
    stubHttpRequest({ fireTimeout: true });

    const response = await GET();
    expect(response.status).toBe(503);
    const body = (await response.json()) as { ready: boolean; checks: Record<string, { ok: boolean; error?: string }> };
    expect(body.ready).toBe(false);
    expect(body.checks.terminal.ok).toBe(false);
    expect(body.checks.terminal.error).toContain("timed out");
  });

  it("returns 503 when the terminal server returns a non-200 over the socket", async () => {
    mockedDbRun.mockResolvedValue(undefined as never);
    mockedExecFile.mockResolvedValue({ stdout: "tmux 3.4", stderr: "", exitCode: 0 });
    stubHttpRequest({ statusCode: 503 });

    const response = await GET();
    expect(response.status).toBe(503);
    const body = (await response.json()) as { ready: boolean; checks: Record<string, { ok: boolean; error?: string }> };
    expect(body.ready).toBe(false);
    expect(body.checks.terminal.ok).toBe(false);
    expect(body.checks.terminal.error).toContain("HTTP 503");
  });
});
