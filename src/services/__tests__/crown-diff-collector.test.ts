// @vitest-environment node
/**
 * Unit tests for crown-diff-collector's pure filtering helpers (oyej.5):
 * binary-hunk dropping, truncation, and numstat parsing.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/logger", () => ({
  createLogger: () => ({
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
  }),
}));
vi.mock("@/lib/exec", () => ({ execFile: vi.fn() }));

import {
  filterDiff,
  parseNumstat,
  MAX_DIFF_BYTES,
} from "../crown-diff-collector";

describe("filterDiff", () => {
  it("drops Binary-files marker lines", () => {
    const raw = [
      "diff --git a/img.png b/img.png",
      "Binary files a/img.png and b/img.png differ",
      "diff --git a/src.ts b/src.ts",
      "+const x = 1;",
    ].join("\n");
    const { diff } = filterDiff(raw);
    expect(diff).not.toContain("Binary files");
    expect(diff).toContain("+const x = 1;");
  });

  it("truncates oversize diffs and flags truncated", () => {
    const big = "+".repeat(MAX_DIFF_BYTES + 5000);
    const { diff, truncated } = filterDiff(big);
    expect(truncated).toBe(true);
    expect(diff).toContain("[... diff truncated ...]");
    expect(Buffer.byteLength(diff, "utf-8")).toBeLessThan(MAX_DIFF_BYTES + 200);
  });

  it("leaves a small textual diff unchanged (not truncated)", () => {
    const { diff, truncated } = filterDiff("+a\n-b");
    expect(truncated).toBe(false);
    expect(diff).toBe("+a\n-b");
  });
});

describe("parseNumstat", () => {
  it("sums additions/deletions and counts files", () => {
    const numstat = "10\t2\tsrc/a.ts\n5\t0\tsrc/b.ts";
    expect(parseNumstat(numstat)).toEqual({
      files: 2,
      additions: 15,
      deletions: 2,
    });
  });

  it("treats binary '-' counts as zero", () => {
    const numstat = "-\t-\timg.png\n3\t1\tsrc/c.ts";
    expect(parseNumstat(numstat)).toEqual({
      files: 2,
      additions: 3,
      deletions: 1,
    });
  });

  it("ignores blank lines", () => {
    expect(parseNumstat("\n\n")).toEqual({
      files: 0,
      additions: 0,
      deletions: 0,
    });
  });
});
