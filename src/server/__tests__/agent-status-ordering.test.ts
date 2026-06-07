// @vitest-environment node
/**
 * [remote-dev-1aa5] Tests for the monotonic activity-status write guard.
 *
 * `shouldApplyStatusWrite` is the single source of truth for the atomic SQL
 * WHERE guard in terminal.ts's /internal/agent-status handler:
 *   - an older (out-of-order) write is rejected
 *   - a subagent-stop "running" never resurrects a terminal 'idle'/'ended'
 */
import { describe, it, expect } from "vitest";
import { shouldApplyStatusWrite } from "../agent-status-ordering";

describe("shouldApplyStatusWrite", () => {
  describe("monotonic arrival ordering", () => {
    it("applies the first write when no arrival is recorded yet", () => {
      expect(
        shouldApplyStatusWrite({
          incomingAt: 1000,
          currentAt: null,
          currentStatus: null,
          status: "running",
          source: null,
        })
      ).toBe(true);
    });

    it("applies a newer write", () => {
      expect(
        shouldApplyStatusWrite({
          incomingAt: 2000,
          currentAt: 1000,
          currentStatus: "running",
          status: "idle",
          source: null,
        })
      ).toBe(true);
    });

    it("applies an equal-timestamp write (newer-or-equal)", () => {
      expect(
        shouldApplyStatusWrite({
          incomingAt: 1000,
          currentAt: 1000,
          currentStatus: "running",
          status: "idle",
          source: null,
        })
      ).toBe(true);
    });

    it("rejects an older write (the late-hook race)", () => {
      // A slow SubagentStop 'running' (arrived earlier, lands later) must not
      // overwrite a newer Stop 'idle'.
      expect(
        shouldApplyStatusWrite({
          incomingAt: 1000,
          currentAt: 2000,
          currentStatus: "idle",
          status: "running",
          source: null,
        })
      ).toBe(false);
    });
  });

  describe("subagent-stop terminal-status protection", () => {
    it("rejects a subagent-stop running over a current 'idle' (even if newer)", () => {
      expect(
        shouldApplyStatusWrite({
          incomingAt: 5000,
          currentAt: 1000,
          currentStatus: "idle",
          status: "running",
          source: "subagent-stop",
        })
      ).toBe(false);
    });

    it("rejects a subagent-stop running over a current 'ended'", () => {
      expect(
        shouldApplyStatusWrite({
          incomingAt: 5000,
          currentAt: 1000,
          currentStatus: "ended",
          status: "running",
          source: "subagent-stop",
        })
      ).toBe(false);
    });

    it("ALLOWS a subagent-stop running when the turn is still active", () => {
      // Mid-turn the parent status is 'running'/'subagent' — the subagent-stop
      // running is a legitimate re-assertion.
      expect(
        shouldApplyStatusWrite({
          incomingAt: 5000,
          currentAt: 1000,
          currentStatus: "running",
          status: "running",
          source: "subagent-stop",
        })
      ).toBe(true);
    });

    it("does NOT block a NON-subagent-stop running over 'idle' (a real new turn)", () => {
      // A new turn re-asserts running via PreToolUse (untagged) — that must win.
      expect(
        shouldApplyStatusWrite({
          incomingAt: 5000,
          currentAt: 1000,
          currentStatus: "idle",
          status: "running",
          source: null,
        })
      ).toBe(true);
    });

    it("does NOT block a subagent-stop non-running status over 'idle'", () => {
      // Only the 'running' status is guarded for subagent-stop.
      expect(
        shouldApplyStatusWrite({
          incomingAt: 5000,
          currentAt: 1000,
          currentStatus: "idle",
          status: "waiting",
          source: "subagent-stop",
        })
      ).toBe(true);
    });
  });

  it("an older subagent-stop write is rejected by the arrival guard first", () => {
    expect(
      shouldApplyStatusWrite({
        incomingAt: 500,
        currentAt: 1000,
        currentStatus: "running",
        status: "running",
        source: "subagent-stop",
      })
    ).toBe(false);
  });
});
