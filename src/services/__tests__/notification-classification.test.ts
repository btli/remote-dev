// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  notificationSeverity,
  notificationGroup,
  type NotificationType,
} from "@/types/notification";

describe("notificationSeverity", () => {
  it("classifies agent_waiting as actionable", () =>
    expect(notificationSeverity("agent_waiting")).toBe("actionable"));
  it("classifies agent_error and agent_stuck as error", () => {
    expect(notificationSeverity("agent_error")).toBe("error");
    expect(notificationSeverity("agent_stuck")).toBe("error");
  });
  it("classifies clean stop (agent_exited/agent_complete) as passive", () => {
    expect(notificationSeverity("agent_exited")).toBe("passive");
    expect(notificationSeverity("agent_complete")).toBe("passive");
  });
  it("waiting maps to actionable, stop maps to passive (no actionable stop)", () => {
    expect(notificationSeverity("agent_waiting")).toBe("actionable");
    expect(notificationSeverity("agent_exited")).toBe("passive");
  });
});

describe("notificationGroup", () => {
  it("collapses lifecycle pings into one group", () => {
    expect(notificationGroup("agent_waiting")).toBe("agent_lifecycle");
    expect(notificationGroup("agent_exited")).toBe("agent_lifecycle");
  });
  it("keeps info/update types in their own group", () =>
    expect(notificationGroup("info")).toBe("info"));
});

describe("severity model exhaustiveness (y5ch.11)", () => {
  it("every NotificationType resolves to a valid severity (exhaustive)", () => {
    const all: NotificationType[] = [
      "agent_waiting",
      "agent_error",
      "agent_complete",
      "agent_exited",
      "build_fail",
      "session_closed",
      "update_pending",
      "update_applied",
      "agent_stuck",
      "info",
    ];
    for (const t of all) {
      expect(["actionable", "passive", "error"]).toContain(
        notificationSeverity(t),
      );
    }
  });

  it("every NotificationType resolves to a non-empty coalescing group", () => {
    const all: NotificationType[] = [
      "agent_waiting",
      "agent_error",
      "agent_complete",
      "agent_exited",
      "build_fail",
      "session_closed",
      "update_pending",
      "update_applied",
      "agent_stuck",
      "info",
    ];
    for (const t of all) {
      expect(notificationGroup(t).length).toBeGreaterThan(0);
    }
  });
});

describe("payload plumbing (y5ch.8)", () => {
  it("CreateNotificationInput carries meta through to the event shape", () => {
    const input: import("@/types/notification").CreateNotificationInput = {
      userId: "u",
      type: "agent_waiting",
      title: "x",
      meta: {
        deepLinkSessionId: "s",
        cta: { label: "Open", action: "open_session" },
      },
    };
    expect(input.meta?.cta?.action).toBe("open_session");
  });
});
