import { describe, it, expect } from "vitest";
import { isValidIssueId, isBeadsUnavailable } from "../beads-cli";

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
