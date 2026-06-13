// @vitest-environment node
import { describe, it, expect } from "vitest";
import { RelaunchOnLimitUseCase } from "./RelaunchOnLimitUseCase";
import type { AutoRelaunchModePort } from "@/application/ports/AutoRelaunchModePort";
import type {
  NotificationPort,
  UsageLimitNotification,
} from "@/application/ports/NotificationPort";
import type { ProfileSelectionPolicy } from "@/application/ports/ProfileSelectionPolicy";
import type {
  SessionLauncherPort,
  LaunchReplacementInput,
} from "@/application/ports/SessionLauncherPort";
import type { ClaudeAutoRelaunchMode } from "@/types/claude-limits";

class FakeMode implements AutoRelaunchModePort {
  constructor(private readonly mode: ClaudeAutoRelaunchMode) {}
  async resolveMode(): Promise<ClaudeAutoRelaunchMode> {
    return this.mode;
  }
}

/** Policy whose `selectNextAvailable` returns a scripted value. */
class FakePolicy implements ProfileSelectionPolicy {
  constructor(private readonly nextAvailable: string | null) {}
  async selectForProject(): Promise<string | null> {
    return null;
  }
  async selectNextAvailable(): Promise<string | null> {
    return this.nextAvailable;
  }
}

class FakeNotifier implements NotificationPort {
  readonly sent: UsageLimitNotification[] = [];
  async notifyLimit(n: UsageLimitNotification): Promise<void> {
    this.sent.push(n);
  }
}

class FakeLauncher implements SessionLauncherPort {
  readonly launched: LaunchReplacementInput[] = [];
  constructor(private readonly behavior: "ok" | "throw" = "ok") {}
  async launch(input: LaunchReplacementInput): Promise<{ sessionId: string }> {
    this.launched.push(input);
    if (this.behavior === "throw") throw new Error("launch boom");
    return { sessionId: "new-session-1" };
  }
}

const baseInput = {
  sessionId: "sess-1",
  userId: "u1",
  projectId: "proj-1",
  currentProfileId: "prof-current",
  agentProvider: "claude",
  sessionName: "Work",
};

describe("RelaunchOnLimitUseCase", () => {
  it("disabled mode: does nothing", async () => {
    const notifier = new FakeNotifier();
    const launcher = new FakeLauncher();
    const useCase = new RelaunchOnLimitUseCase(
      new FakeMode("disabled"),
      new FakePolicy("prof-alt"),
      notifier,
      launcher
    );

    const action = await useCase.execute(baseInput);

    expect(action).toEqual({ kind: "noop", mode: "disabled" });
    expect(notifier.sent).toHaveLength(0);
    expect(launcher.launched).toHaveLength(0);
  });

  it("notify mode: sends a notification with a relaunch CTA when an alternate exists", async () => {
    const notifier = new FakeNotifier();
    const launcher = new FakeLauncher();
    const useCase = new RelaunchOnLimitUseCase(
      new FakeMode("notify"),
      new FakePolicy("prof-alt"),
      notifier,
      launcher
    );

    const action = await useCase.execute(baseInput);

    expect(action).toEqual({ kind: "notified", relaunchProfileId: "prof-alt" });
    expect(launcher.launched).toHaveLength(0);
    expect(notifier.sent).toHaveLength(1);
    expect(notifier.sent[0].relaunch).toEqual({
      projectId: "proj-1",
      profileId: "prof-alt",
      agentProvider: "claude",
    });
    expect(notifier.sent[0].sessionId).toBe("sess-1");
  });

  it("notify mode: sends an all-limited notification (no CTA) when none available", async () => {
    const notifier = new FakeNotifier();
    const useCase = new RelaunchOnLimitUseCase(
      new FakeMode("notify"),
      new FakePolicy(null),
      notifier,
      new FakeLauncher()
    );

    const action = await useCase.execute(baseInput);

    expect(action).toEqual({ kind: "notified_all_limited" });
    expect(notifier.sent).toHaveLength(1);
    expect(notifier.sent[0].relaunch).toBeUndefined();
  });

  it("auto mode: launches a NEW session under the alternate profile (old left running)", async () => {
    const notifier = new FakeNotifier();
    const launcher = new FakeLauncher("ok");
    const useCase = new RelaunchOnLimitUseCase(
      new FakeMode("auto"),
      new FakePolicy("prof-alt"),
      notifier,
      launcher
    );

    const action = await useCase.execute(baseInput);

    expect(action).toEqual({
      kind: "relaunched",
      newSessionId: "new-session-1",
      profileId: "prof-alt",
    });
    expect(launcher.launched).toHaveLength(1);
    expect(launcher.launched[0]).toEqual({
      userId: "u1",
      projectId: "proj-1",
      profileId: "prof-alt",
      agentProvider: "claude",
      originatingSessionId: "sess-1",
    });
    // The use-case never notifies on a clean auto-relaunch.
    expect(notifier.sent).toHaveLength(0);
  });

  it("auto mode: notifies all-limited when no alternate is available (never launches)", async () => {
    const notifier = new FakeNotifier();
    const launcher = new FakeLauncher();
    const useCase = new RelaunchOnLimitUseCase(
      new FakeMode("auto"),
      new FakePolicy(null),
      notifier,
      launcher
    );

    const action = await useCase.execute(baseInput);

    expect(action).toEqual({ kind: "notified_all_limited" });
    expect(launcher.launched).toHaveLength(0);
    expect(notifier.sent).toHaveLength(1);
  });

  it("auto mode: falls back to a notification when the launch throws", async () => {
    const notifier = new FakeNotifier();
    const launcher = new FakeLauncher("throw");
    const useCase = new RelaunchOnLimitUseCase(
      new FakeMode("auto"),
      new FakePolicy("prof-alt"),
      notifier,
      launcher
    );

    const action = await useCase.execute(baseInput);

    expect(action).toEqual({ kind: "notified", relaunchProfileId: "prof-alt" });
    expect(launcher.launched).toHaveLength(1);
    expect(notifier.sent).toHaveLength(1);
    expect(notifier.sent[0].relaunch?.profileId).toBe("prof-alt");
  });
});
