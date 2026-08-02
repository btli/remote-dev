// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Logger } from "@/lib/logger";
import {
  TmuxSizeController,
  type TmuxExec,
} from "@/server/tmux-size-controller";

class FakeTmuxExec {
  readonly calls: Array<{
    args: string[];
    callback: (err: Error | null) => void;
  }> = [];

  readonly exec: TmuxExec = (args, callback) => {
    this.calls.push({ args, callback });
  };

  completeNext(error: Error | null = null): void {
    const call = this.calls.find((candidate) => !this.completed.has(candidate));
    if (!call) throw new Error("No pending tmux exec call");
    this.completed.add(call);
    call.callback(error);
  }

  private readonly completed = new Set<(typeof this.calls)[number]>();
}

function makeLogger(): Logger {
  return {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
  };
}

describe("TmuxSizeController", () => {
  let exec: FakeTmuxExec;
  let controller: TmuxSizeController;

  beforeEach(() => {
    exec = new FakeTmuxExec();
    controller = new TmuxSizeController(exec.exec, makeLogger());
  });

  it("RC-H: serializes resize-window calls and applies the latest requested size last", () => {
    controller.requestResize("s1", "rdv-s1", 100, 30);
    controller.requestResize("s1", "rdv-s1", 120, 40);

    expect(exec.calls).toHaveLength(1);
    exec.completeNext();

    expect(exec.calls).toHaveLength(2);
    expect(exec.calls.at(-1)?.args).toEqual([
      "resize-window",
      "-t",
      "rdv-s1",
      "-x",
      "120",
      "-y",
      "40",
    ]);

    exec.completeNext();
    expect(controller.getAppliedSize("s1")).toEqual({ cols: 120, rows: 40 });
  });

  it("force bypasses the applied-size dedupe for focus reassertion", () => {
    controller.requestResize("s1", "rdv-s1", 100, 30);
    exec.completeNext();

    controller.requestResize("s1", "rdv-s1", 100, 30);
    expect(exec.calls).toHaveLength(1);

    controller.requestResize("s1", "rdv-s1", 100, 30, { force: true });
    expect(exec.calls).toHaveLength(2);
  });

  it("keeps a queued force sticky across a same-size non-forced overwrite", () => {
    controller.requestResize("s1", "rdv-s1", 100, 30);
    exec.completeNext();

    controller.requestResize("s1", "rdv-s1", 120, 40);
    controller.requestResize("s1", "rdv-s1", 100, 30, { force: true });
    controller.requestResize("s1", "rdv-s1", 100, 30);
    exec.completeNext(new Error("first resize failed"));

    expect(exec.calls).toHaveLength(3);
    expect(exec.calls.at(-1)?.args).toEqual([
      "resize-window",
      "-t",
      "rdv-s1",
      "-x",
      "100",
      "-y",
      "30",
    ]);
  });

  it("clearSession prevents an old in-flight callback from mutating a recreated session", () => {
    controller.requestResize("s1", "rdv-s1", 100, 30);
    controller.requestResize("s1", "rdv-s1", 110, 35);
    controller.clearSession("s1");
    controller.requestResize("s1", "rdv-s1", 120, 40);

    expect(exec.calls).toHaveLength(2);
    exec.completeNext();
    expect(controller.getAppliedSize("s1")).not.toEqual({ cols: 100, rows: 30 });
    expect(exec.calls).toHaveLength(2);
    expect(exec.calls.at(-1)?.args).toContain("120");

    exec.completeNext();
    expect(controller.getAppliedSize("s1")).toEqual({ cols: 120, rows: 40 });
  });

  it("clearSession deletes both maps and a callback finding no state is safe", () => {
    controller.requestResize("s1", "rdv-s1", 100, 30);

    controller.clearSession("s1");

    const internals = controller as unknown as {
      sessions: Map<string, unknown>;
      sessionEpochs: Map<string, unknown>;
    };
    expect(internals.sessions.has("s1")).toBe(false);
    expect(internals.sessionEpochs.has("s1")).toBe(false);
    expect(() => exec.completeNext()).not.toThrow();
    expect(controller.getAppliedSize("s1")).toBeNull();
  });

  it("does not mark a failed resize as applied and retries it on the next request", () => {
    controller.requestResize("s1", "rdv-s1", 100, 30);
    exec.completeNext(new Error("tmux unavailable"));

    expect(controller.getAppliedSize("s1")).toBeNull();

    controller.requestResize("s1", "rdv-s1", 100, 30);
    expect(exec.calls).toHaveLength(2);
    exec.completeNext();
    expect(controller.getAppliedSize("s1")).toEqual({ cols: 100, rows: 30 });
  });
});
