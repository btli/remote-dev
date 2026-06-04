// @vitest-environment node
import { describe, it, expect, afterEach } from "vitest";
import {
  applyNotificationPolicy,
  inQuietHours,
  setNotificationPolicyHook,
  getNotificationPolicyHook,
  type NotificationDecision,
  type ResolvedNotificationPrefs,
} from "@/lib/notification-policy";

const base: ResolvedNotificationPrefs = {
  pushByType: {},
  mutedSessionIds: new Set(),
  quietHours: null,
  minPushSeverity: "actionable",
};
const at = (h: number) => {
  const d = new Date();
  d.setHours(h, 0, 0, 0);
  return d;
};

describe("applyNotificationPolicy", () => {
  it("suppresses push (but stores) when session is focused", () => {
    const d = applyNotificationPolicy(
      { userId: "u", sessionId: "s", type: "agent_waiting", title: "x" },
      base,
      { now: at(12), focused: true },
    );
    expect(d).toEqual({ store: true, push: false, reason: "session_focused" });
  });

  it("mutes both channels for a muted session", () => {
    const prefs = { ...base, mutedSessionIds: new Set(["s"]) };
    const d = applyNotificationPolicy(
      { userId: "u", sessionId: "s", type: "agent_waiting", title: "x" },
      prefs,
      { now: at(12), focused: false },
    );
    expect(d.store).toBe(false);
    expect(d.push).toBe(false);
  });

  it("drops passive below min severity (stores, no push)", () => {
    const d = applyNotificationPolicy(
      { userId: "u", type: "agent_exited", title: "x" },
      base,
      { now: at(12), focused: false },
    );
    expect(d.store).toBe(true);
    expect(d.push).toBe(false);
    expect(d.reason).toBe("below_min_severity");
  });

  it("honors per-type opt-out", () => {
    const prefs = { ...base, pushByType: { agent_waiting: false } };
    const d = applyNotificationPolicy(
      { userId: "u", type: "agent_waiting", title: "x" },
      prefs,
      { now: at(12), focused: false },
    );
    expect(d.push).toBe(false);
    expect(d.reason).toBe("type_opt_out");
  });

  it("pushes an actionable agent_waiting under defaults", () => {
    const d = applyNotificationPolicy(
      { userId: "u", sessionId: "s", type: "agent_waiting", title: "x" },
      base,
      { now: at(12), focused: false },
    );
    expect(d).toEqual({ store: true, push: true });
  });

  it("errors override quiet hours", () => {
    const prefs = {
      ...base,
      quietHours: { startHour: 0, endHour: 23 },
      minPushSeverity: "passive" as const,
    };
    const d = applyNotificationPolicy(
      { userId: "u", type: "agent_error", title: "x" },
      prefs,
      { now: at(12), focused: false },
    );
    expect(d.push).toBe(true);
  });

  it("suppresses a non-error push during quiet hours", () => {
    const prefs = { ...base, quietHours: { startHour: 0, endHour: 23 } };
    const d = applyNotificationPolicy(
      { userId: "u", type: "agent_waiting", title: "x" },
      prefs,
      { now: at(12), focused: false },
    );
    expect(d.push).toBe(false);
    expect(d.reason).toBe("quiet_hours");
  });

  it("inQuietHours wraps midnight", () => {
    expect(inQuietHours(at(23), { startHour: 22, endHour: 7 })).toBe(true);
    expect(inQuietHours(at(3), { startHour: 22, endHour: 7 })).toBe(true);
    expect(inQuietHours(at(12), { startHour: 22, endHour: 7 })).toBe(false);
    expect(inQuietHours(at(12), null)).toBe(false);
  });
});

describe("ResolvedNotificationPrefs shape (y5ch.6)", () => {
  it("resolved prefs shape feeds the policy directly", () => {
    const prefs: ResolvedNotificationPrefs = {
      pushByType: { agent_exited: false },
      mutedSessionIds: new Set(["s1"]),
      quietHours: { startHour: 22, endHour: 7 },
      minPushSeverity: "actionable",
    };
    expect(prefs.mutedSessionIds.has("s1")).toBe(true);
    expect(prefs.pushByType.agent_exited).toBe(false);
  });
});

describe("pluggable policy hook (y5ch.7)", () => {
  // Always clear the global hook so suites stay isolated.
  afterEach(() => setNotificationPolicyHook(null));

  it("leaves the decision unchanged when no hook is registered", () => {
    expect(getNotificationPolicyHook()).toBeNull();
    const d = applyNotificationPolicy(
      { userId: "u", sessionId: "s", type: "agent_waiting", title: "x" },
      base,
      { now: at(12), focused: false },
    );
    // Byte-identical to the built-in default (the pre-hook behavior).
    expect(d).toEqual({ store: true, push: true });
  });

  it("applies a hook patch over the base decision (force-suppress push)", () => {
    setNotificationPolicyHook((event, baseDecision) => {
      expect(event.type).toBe("agent_waiting");
      // Base would have pushed; the external policy flips push off.
      expect(baseDecision).toEqual({ store: true, push: true });
      return { push: false, reason: "external_suppress" };
    });
    const d = applyNotificationPolicy(
      { userId: "u", sessionId: "s", type: "agent_waiting", title: "x" },
      base,
      { now: at(12), focused: false },
    );
    // store carries over from base; only the patched keys change.
    expect(d).toEqual({ store: true, push: false, reason: "external_suppress" });
  });

  it("lets a hook force-push an event the base policy gated off", () => {
    setNotificationPolicyHook(() => ({ push: true, reason: "external_force" }));
    const d = applyNotificationPolicy(
      // passive type below the default min severity → base gates push off.
      { userId: "u", type: "agent_exited", title: "x" },
      base,
      { now: at(12), focused: false },
    );
    expect(d).toEqual({ store: true, push: true, reason: "external_force" });
  });

  it("treats a null/undefined patch as no-op", () => {
    setNotificationPolicyHook(() => null);
    const d = applyNotificationPolicy(
      { userId: "u", sessionId: "s", type: "agent_waiting", title: "x" },
      base,
      { now: at(12), focused: false },
    );
    expect(d).toEqual({ store: true, push: true });
  });

  it("falls back to the base decision when the hook throws", () => {
    setNotificationPolicyHook(() => {
      throw new Error("boom");
    });
    const d = applyNotificationPolicy(
      { userId: "u", sessionId: "s", type: "agent_waiting", title: "x" },
      base,
      { now: at(12), focused: false },
    );
    // The throwing hook is swallowed; the built-in decision survives.
    expect(d).toEqual({ store: true, push: true });
  });

  it("does not let a hook mutate the base decision in place", () => {
    setNotificationPolicyHook((_event, baseDecision) => {
      expect(() => {
        (baseDecision as NotificationDecision).push = false;
      }).toThrow();
      return null;
    });
    const d = applyNotificationPolicy(
      { userId: "u", sessionId: "s", type: "agent_waiting", title: "x" },
      base,
      { now: at(12), focused: false },
    );
    expect(d).toEqual({ store: true, push: true });
  });
});
