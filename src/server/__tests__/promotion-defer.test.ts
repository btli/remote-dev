// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PrimaryPromotionCoordinator,
  parseInitialTerminalDimensions,
  type PromotionConnectionState,
  type PromotionCoordinatorHost,
} from "@/server/terminal";

class FakePromotionHost implements PromotionCoordinatorHost {
  readonly connections = new Map<string, PromotionConnectionState>();
  readonly primaries = new Map<string, string>();
  readonly lastPromotionAt = new Map<string, number>();
  readonly reassertions: Array<{ sessionId: string; connectionId: string }> = [];
  readonly broadcasts: string[] = [];

  getConnection(connectionId: string): PromotionConnectionState | undefined {
    return this.connections.get(connectionId);
  }

  getPrimary(sessionId: string): string | undefined {
    return this.primaries.get(sessionId);
  }

  setPrimary(sessionId: string, connectionId: string): void {
    this.primaries.set(sessionId, connectionId);
  }

  getLastPromotionAt(sessionId: string): number | undefined {
    return this.lastPromotionAt.get(sessionId);
  }

  setLastPromotionAt(sessionId: string, timestamp: number): void {
    this.lastPromotionAt.set(sessionId, timestamp);
  }

  reassertSize(sessionId: string, connectionId: string): void {
    this.reassertions.push({ sessionId, connectionId });
  }

  broadcastPrimaryChanged(sessionId: string): void {
    this.broadcasts.push(sessionId);
  }

  now(): number {
    return Date.now();
  }
}

function visibleOpenConnection(connectionId: string): PromotionConnectionState {
  return { connectionId, isVisible: true, isSocketOpen: true };
}

describe("PrimaryPromotionCoordinator", () => {
  let host: FakePromotionHost;
  let coordinator: PrimaryPromotionCoordinator;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2030-01-01T00:00:00Z"));
    host = new FakePromotionHost();
    coordinator = new PrimaryPromotionCoordinator(host, 1000);
    host.connections.set("A", visibleOpenConnection("A"));
    host.connections.set("B", visibleOpenConnection("B"));
    host.connections.set("C", visibleOpenConnection("C"));
    host.primaries.set("s1", "A");
    host.lastPromotionAt.set("s1", Date.now());
  });

  afterEach(() => {
    coordinator.dispose();
    vi.useRealTimers();
  });

  it("promotes the still-mapped open visible candidate when the cooldown expires", () => {
    coordinator.requestPromotion("s1", "B", false);

    expect(coordinator.getPendingCandidate("s1")).toBe("B");
    expect(host.primaries.get("s1")).toBe("A");

    vi.advanceTimersByTime(1000);

    expect(host.primaries.get("s1")).toBe("B");
    expect(host.reassertions).toEqual([{ sessionId: "s1", connectionId: "B" }]);
    expect(host.broadcasts).toEqual(["s1"]);
    expect(coordinator.getPendingCandidate("s1")).toBeNull();
  });

  it("drops a deferred candidate that is no longer socket-open at timer fire", () => {
    coordinator.requestPromotion("s1", "B", false);
    host.connections.get("B")!.isSocketOpen = false;

    vi.advanceTimersByTime(1000);

    expect(host.primaries.get("s1")).toBe("A");
    expect(host.reassertions).toHaveLength(0);
    expect(coordinator.getPendingCandidate("s1")).toBeNull();
  });

  it("drops a deferred candidate that is no longer visible at timer fire", () => {
    coordinator.requestPromotion("s1", "B", false);
    host.connections.get("B")!.isVisible = false;

    vi.advanceTimersByTime(1000);

    expect(host.primaries.get("s1")).toBe("A");
    expect(host.reassertions).toHaveLength(0);
    expect(coordinator.getPendingCandidate("s1")).toBeNull();
  });

  it("client blur clears pending only when the blurring connection is the candidate", () => {
    coordinator.requestPromotion("s1", "B", false);
    coordinator.notifyBlur("s1", "A");
    expect(coordinator.getPendingCandidate("s1")).toBe("B");

    coordinator.notifyBlur("s1", "B");
    vi.advanceTimersByTime(1000);

    expect(host.primaries.get("s1")).toBe("A");
    expect(coordinator.getPendingCandidate("s1")).toBeNull();
  });

  it("a replaced candidate survives disconnect cleanup for the previous candidate", () => {
    coordinator.requestPromotion("s1", "B", false);
    coordinator.requestPromotion("s1", "C", false);

    coordinator.notifyDisconnect("s1", "B");
    expect(coordinator.getPendingCandidate("s1")).toBe("C");

    vi.advanceTimersByTime(1000);
    expect(host.primaries.get("s1")).toBe("C");
  });

  it("a successful forced promotion cancels an existing deferred promotion", () => {
    coordinator.requestPromotion("s1", "B", false);
    coordinator.requestPromotion("s1", "B", true);

    expect(host.primaries.get("s1")).toBe("B");
    expect(coordinator.getPendingCandidate("s1")).toBeNull();

    vi.advanceTimersByTime(1000);
    expect(host.broadcasts).toEqual(["s1"]);
    expect(host.reassertions).toEqual([{ sessionId: "s1", connectionId: "B" }]);
  });

  it("an already-primary focus always forces a size reassertion", () => {
    coordinator.requestPromotion("s1", "A", false);

    expect(host.primaries.get("s1")).toBe("A");
    expect(host.reassertions).toEqual([{ sessionId: "s1", connectionId: "A" }]);
    expect(host.broadcasts).toHaveLength(0);
  });
});

describe("parseInitialTerminalDimensions", () => {
  it("clamps a 2x1 initial URL grid to 10x3", () => {
    expect(parseInitialTerminalDimensions("2", "1")).toEqual({ cols: 10, rows: 3 });
  });

  it("clamps a 9x2 initial URL grid to 10x3", () => {
    expect(parseInitialTerminalDimensions("9", "2")).toEqual({ cols: 10, rows: 3 });
  });

  it("preserves the minimum valid 10x3 initial URL grid", () => {
    expect(parseInitialTerminalDimensions("10", "3")).toEqual({ cols: 10, rows: 3 });
  });

  it("uses 80x24 defaults for absent, nonnumeric, or nonpositive dimensions", () => {
    expect(parseInitialTerminalDimensions(undefined, undefined)).toEqual({ cols: 80, rows: 24 });
    expect(parseInitialTerminalDimensions("nope", "NaN")).toEqual({ cols: 80, rows: 24 });
    expect(parseInitialTerminalDimensions("0", "-1")).toEqual({ cols: 80, rows: 24 });
  });
});
