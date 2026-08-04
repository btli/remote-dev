// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import {
  stopTmuxSessionAndConfirmAbsent,
  stopTmuxSessionAndConfirmAbsentSync,
  tmuxAbsenceConfirmed,
} from "@/server/tmux-containment";

function tmuxError(message: string, stderr = message): Error {
  return Object.assign(new Error(message), { stderr });
}

describe("tmux containment", () => {
  it.each([
    ["can't find session: rdv-missing"],
    ["no server running on /tmp/tmux-501/default"],
    ["error connecting to /tmp/tmux-501/default (No such file or directory)"],
    ["error connecting to /tmp/tmux-501/default (Connection refused)"],
  ])("recognizes confirmed absence: %s", (message) => {
    expect(tmuxAbsenceConfirmed(tmuxError(message))).toBe(true);
  });

  it.each([
    ["permission denied"],
    ["server temporarily unavailable"],
    ["timed out"],
  ])("does not turn an inconclusive error into absence: %s", (message) => {
    expect(tmuxAbsenceConfirmed(tmuxError(message))).toBe(false);
  });

  it("keeps a live session quarantined after a failed synchronous kill", () => {
    const run = vi.fn((args: string[]) => {
      if (args[0] === "kill-session") throw tmuxError("permission denied");
    });

    expect(stopTmuxSessionAndConfirmAbsentSync("rdv-live", run)).toBe(false);
    expect(run.mock.calls).toEqual([
      [["kill-session", "-t", "rdv-live"]],
      [["has-session", "-t", "rdv-live"]],
    ]);
  });

  it("accepts absence only after the failed synchronous kill is confirmed", () => {
    const run = vi.fn((args: string[]) => {
      if (args[0] === "kill-session") throw tmuxError("kill failed");
      throw tmuxError("can't find session: rdv-gone");
    });

    expect(stopTmuxSessionAndConfirmAbsentSync("rdv-gone", run)).toBe(true);
  });

  it("applies the same quarantine rule to asynchronous relaunch containment", async () => {
    const run = vi.fn(async (args: string[]) => {
      if (args[0] === "kill-session") throw tmuxError("kill failed");
      throw tmuxError("probe timed out");
    });

    await expect(stopTmuxSessionAndConfirmAbsent("rdv-uncertain", run)).resolves.toBe(false);
  });
});
