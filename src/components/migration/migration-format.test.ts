import { describe, expect, it } from "vitest";
import {
  formatBytes,
  isTerminalMigrationStatus,
  migrationPhaseLabel,
  migrationProgressPercent,
  parseConflictReport,
  workingTreeModeLabel,
} from "./migration-format";

describe("formatBytes", () => {
  it("formats across unit boundaries", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(formatBytes(1.2 * 1024 * 1024 * 1024)).toBe("1.2 GB");
  });

  it("drops the decimal for 3-digit values", () => {
    expect(formatBytes(250 * 1024)).toBe("250 KB");
  });

  it("returns an em dash for absent values", () => {
    expect(formatBytes(null)).toBe("—");
    expect(formatBytes(undefined)).toBe("—");
    expect(formatBytes(-1)).toBe("—");
    expect(formatBytes(Number.NaN)).toBe("—");
  });
});

describe("migrationProgressPercent", () => {
  it("computes a clamped percent when the estimate is usable", () => {
    expect(migrationProgressPercent(50, 200)).toBe(25);
    expect(migrationProgressPercent(300, 200)).toBe(100);
    expect(migrationProgressPercent(0, 200)).toBe(0);
  });

  it("returns null without a usable estimate", () => {
    expect(migrationProgressPercent(50, null)).toBeNull();
    expect(migrationProgressPercent(50, 0)).toBeNull();
    expect(migrationProgressPercent(-1, 200)).toBeNull();
  });
});

describe("status helpers", () => {
  it("flags exactly the terminal statuses", () => {
    expect(isTerminalMigrationStatus("completed")).toBe(true);
    expect(isTerminalMigrationStatus("failed")).toBe(true);
    expect(isTerminalMigrationStatus("aborted")).toBe(true);
    expect(isTerminalMigrationStatus("pending")).toBe(false);
    expect(isTerminalMigrationStatus("running")).toBe(false);
    expect(isTerminalMigrationStatus("db_done")).toBe(false);
    expect(isTerminalMigrationStatus("files_done")).toBe(false);
    expect(isTerminalMigrationStatus("verifying")).toBe(false);
  });

  it("labels every job status", () => {
    expect(migrationPhaseLabel("pending")).toBe("Queued");
    expect(migrationPhaseLabel("verifying")).toBe("Verifying on destination");
    expect(migrationPhaseLabel("failed")).toBe("Failed");
  });

  it("labels every working-tree mode", () => {
    expect(workingTreeModeLabel("full_tar")).toBe("Full copy");
    expect(workingTreeModeLabel("git_essentials")).toBe("Git clone + essentials");
    expect(workingTreeModeLabel("none")).toBe("No files");
  });
});

describe("parseConflictReport", () => {
  it("parses the runner-persisted shape", () => {
    const raw = JSON.stringify({
      conflicts: [
        { type: "project_id_remap", message: "Project id was taken", detail: "a → b" },
      ],
      rowCounts: { tasks: 3 },
      verify: { ok: true, rowCounts: { tasks: 3 }, missingPaths: [] },
    });
    const report = parseConflictReport(raw);
    expect(report).not.toBeNull();
    expect(report!.conflicts).toHaveLength(1);
    expect(report!.conflicts[0].message).toBe("Project id was taken");
    expect(report!.rowCounts.tasks).toBe(3);
    expect(report!.verify?.ok).toBe(true);
  });

  it("defaults missing fields instead of throwing", () => {
    const report = parseConflictReport("{}");
    expect(report).toEqual({ conflicts: [], rowCounts: {}, verify: undefined });
  });

  it("returns null for absent or invalid JSON", () => {
    expect(parseConflictReport(null)).toBeNull();
    expect(parseConflictReport(undefined)).toBeNull();
    expect(parseConflictReport("")).toBeNull();
    expect(parseConflictReport("not json")).toBeNull();
    expect(parseConflictReport('"a string"')).toBeNull();
  });
});
