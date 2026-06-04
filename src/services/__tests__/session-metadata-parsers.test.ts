// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  parseGitStatusPorcelain,
  parseAheadBehind,
  mapCachedPrToStatus,
  attributePortsToPids,
} from "../session-metadata-parsers";

describe("parseGitStatusPorcelain", () => {
  it("counts staged, unstaged, and untracked entries", () => {
    const out = " M src/a.ts\nA  src/b.ts\n?? src/c.ts\n";
    expect(parseGitStatusPorcelain(out)).toBe(3);
  });
  it("returns 0 for a clean tree", () => {
    expect(parseGitStatusPorcelain("")).toBe(0);
  });
  it("ignores trailing blank lines", () => {
    expect(parseGitStatusPorcelain(" M a\n\n\n")).toBe(1);
  });
});

describe("parseAheadBehind", () => {
  it("parses `git rev-list --left-right --count` output (behind\\tahead)", () => {
    expect(parseAheadBehind("2\t5")).toEqual({ behind: 2, ahead: 5 });
  });
  it("tolerates multiple spaces instead of a tab", () => {
    expect(parseAheadBehind("0   3")).toEqual({ behind: 0, ahead: 3 });
  });
  it("defaults to zero on garbage", () => {
    expect(parseAheadBehind("nope")).toEqual({ behind: 0, ahead: 0 });
  });
});

describe("mapCachedPrToStatus", () => {
  it("maps a cached PR row to SessionPrStatus", () => {
    const row = {
      prNumber: 42,
      state: "open" as const,
      url: "https://x/42",
      isDraft: true,
      reviewDecision: "CHANGES_REQUESTED" as const,
      ciStatus: "failing" as const,
    };
    expect(mapCachedPrToStatus(row)).toEqual({
      number: 42,
      state: "open",
      url: "https://x/42",
      isDraft: true,
      reviewDecision: "CHANGES_REQUESTED",
      ciStatus: "failing",
    });
  });
  it("coerces missing review/ci fields to null", () => {
    const row = {
      prNumber: 7,
      state: "closed" as const,
      url: "u",
      isDraft: false,
      reviewDecision: null,
      ciStatus: null,
    };
    expect(mapCachedPrToStatus(row)).toEqual({
      number: 7,
      state: "closed",
      url: "u",
      isDraft: false,
      reviewDecision: null,
      ciStatus: null,
    });
  });
});

describe("attributePortsToPids", () => {
  it("keeps only ports whose pid is in the subtree set, sorted ascending", () => {
    const listening = new Map<number, { process?: string; pid?: number }>([
      [5173, { process: "vite", pid: 222 }],
      [3000, { process: "node", pid: 111 }],
      [8080, { process: "other", pid: 999 }],
    ]);
    const result = attributePortsToPids(listening, new Set([111, 222]));
    expect(result).toEqual([
      { port: 3000, process: "node", pid: 111 },
      { port: 5173, process: "vite", pid: 222 },
    ]);
  });
  it("returns [] when no pids match", () => {
    const m = new Map([[3000, { process: "node", pid: 1 }]]);
    expect(attributePortsToPids(m, new Set([999]))).toEqual([]);
  });
  it("ignores entries with no pid", () => {
    const m = new Map([[3000, { process: "node" }]]);
    expect(attributePortsToPids(m, new Set([1]))).toEqual([]);
  });
});
