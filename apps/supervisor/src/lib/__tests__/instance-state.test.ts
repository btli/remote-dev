import { describe, it, expect } from "vitest";
import {
  canTransition,
  assertTransition,
  isTerminal,
  IllegalTransitionError,
  ALL_STATUSES,
} from "@/lib/instance-state";
import type { InstanceStatus } from "@/db/schema";

const LEGAL: ReadonlyArray<[InstanceStatus, InstanceStatus]> = [
  ["requested", "provisioning"],
  ["requested", "terminating"],
  ["requested", "error"],
  ["provisioning", "ready"],
  ["provisioning", "terminating"],
  ["provisioning", "error"],
  ["ready", "suspended"],
  ["ready", "terminating"],
  ["ready", "error"],
  ["suspended", "ready"],
  ["suspended", "terminating"],
  ["suspended", "error"],
  ["terminating", "deleted"],
  ["terminating", "error"],
  ["error", "terminating"],
];

// A representative set of transitions that must be rejected.
const ILLEGAL: ReadonlyArray<[InstanceStatus, InstanceStatus]> = [
  ["requested", "ready"], // can't skip provisioning
  ["requested", "deleted"],
  ["provisioning", "suspended"], // not ready yet
  ["provisioning", "deleted"],
  ["ready", "provisioning"], // no going back
  ["ready", "deleted"], // must go through terminating
  ["suspended", "provisioning"],
  ["deleted", "ready"], // terminal
  ["deleted", "terminating"],
  ["deleted", "error"],
  ["error", "ready"], // error only cleans up via terminating
  ["error", "provisioning"],
  ["terminating", "ready"],
];

describe("instance state machine — legal transitions", () => {
  it.each(LEGAL)("allows %s → %s", (from, to) => {
    expect(canTransition(from, to)).toBe(true);
    expect(() => assertTransition(from, to)).not.toThrow();
  });

  it("defines ready↔suspended both ways (Phase 2 mechanics, transition legal now)", () => {
    expect(canTransition("ready", "suspended")).toBe(true);
    expect(canTransition("suspended", "ready")).toBe(true);
  });
});

describe("instance state machine — illegal transitions", () => {
  it.each(ILLEGAL)("rejects %s → %s", (from, to) => {
    expect(canTransition(from, to)).toBe(false);
    expect(() => assertTransition(from, to)).toThrow(IllegalTransitionError);
  });

  it("rejects every self-transition", () => {
    for (const s of ALL_STATUSES) {
      expect(canTransition(s, s)).toBe(false);
    }
  });
});

describe("terminal states", () => {
  it("deleted is terminal; others are not", () => {
    expect(isTerminal("deleted")).toBe(true);
    for (const s of ALL_STATUSES.filter((x) => x !== "deleted")) {
      expect(isTerminal(s)).toBe(false);
    }
  });
});
