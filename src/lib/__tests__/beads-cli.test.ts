import { describe, it, expect, vi, beforeEach } from "vitest";
import { isValidIssueId, isBeadsUnavailable } from "../beads-cli";

// Capture the argv `runBd*` passes to execFile. beads-cli promisifies execFile
// at module load, so the mock's execFile is invoked in callback form
// `(file, args, options, cb)`; we record argv and resolve with empty stdout
// (no real `bd` spawn). The state lives in vi.hoisted so the hoisted vi.mock
// factory can close over it.
const { execFileCalls, execFile } = vi.hoisted(() => {
  const calls: Array<{ file: string; args: string[] }> = [];
  const fn = vi.fn(
    (
      file: string,
      args: string[],
      _options: unknown,
      cb: (err: unknown, result: { stdout: string; stderr: string }) => void
    ) => {
      calls.push({ file, args });
      cb(null, { stdout: "[]", stderr: "" });
    }
  );
  return { execFileCalls: calls, execFile: fn };
});
vi.mock("node:child_process", () => ({ execFile, default: { execFile } }));

beforeEach(() => {
  execFileCalls.length = 0;
  execFile.mockClear();
});

describe("isValidIssueId", () => {
  it("accepts well-formed beads issue ids", () => {
    expect(isValidIssueId("remote-dev-1r98")).toBe(true);
    expect(isValidIssueId("bd-abc.1")).toBe(true);
    expect(isValidIssueId("ABC123")).toBe(true);
  });

  it("rejects empty, flag-like, and metachar-bearing inputs", () => {
    expect(isValidIssueId("")).toBe(false);
    expect(isValidIssueId("--help")).toBe(false);
    expect(isValidIssueId("-x")).toBe(false);
    expect(isValidIssueId("a b")).toBe(false);
    expect(isValidIssueId("a;b")).toBe(false);
    expect(isValidIssueId("$(x)")).toBe(false);
  });

  it("rejects over-long ids (200 chars)", () => {
    expect(isValidIssueId("a".repeat(200))).toBe(false);
  });
});

describe("isBeadsUnavailable", () => {
  it("classifies the execFile timeout code as unavailable", () => {
    expect(isBeadsUnavailable({ code: "ERR_CHILD_PROCESS_TIMED_OUT" })).toBe(true);
  });

  it("classifies a killed/SIGTERM error as unavailable", () => {
    expect(isBeadsUnavailable({ killed: true, signal: "SIGTERM" })).toBe(true);
  });
});

describe("runBdExportCached", () => {
  it("runs plain `bd export` (no --include-infra — messages aren't in the export)", async () => {
    const { runBdExportCached } = await import("../beads-cli");
    // Unique path so the module-level TTL cache can't serve a sibling test's run.
    await runBdExportCached("/proj-export");
    expect(execFileCalls).toHaveLength(1);
    // argv is `-C <path> export` (the `-C <path>` prefix is added by runBd).
    expect(execFileCalls[0].args).toEqual(["-C", "/proj-export", "export"]);
  });
});

describe("runBdInfraListCached", () => {
  it("runs `bd list --include-infra -n 0 --json` (unlimited, so messages aren't truncated)", async () => {
    const { runBdInfraListCached } = await import("../beads-cli");
    await runBdInfraListCached("/proj-list");
    expect(execFileCalls).toHaveLength(1);
    expect(execFileCalls[0].args).toEqual([
      "-C",
      "/proj-list",
      "list",
      "--include-infra",
      "-n",
      "0",
      "--json",
    ]);
  });
});
