// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ClientInstanceFocusRecency,
  clearSessionControllerState,
  handleClientFocus,
  pickNextPrimaryConnection,
  PrimaryPromotionCoordinator,
  parseInitialTerminalDimensions,
  recordClientInput,
  resolveClientInstanceId,
  type PromotionConnectionState,
  type PromotionCoordinatorHost,
} from "@/server/terminal";

type FocusedPromotionConnectionState = PromotionConnectionState & {
  lastFocusAt: number;
  lastInputAt: number;
  lastInputRecencyWriteAt: number;
  sessionId?: string;
  clientInstanceId: string | null;
};

class FakePromotionHost implements PromotionCoordinatorHost {
  readonly connections = new Map<string, FocusedPromotionConnectionState>();
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

function visibleOpenConnection(
  connectionId: string,
  lastFocusAt = 0,
): FocusedPromotionConnectionState {
  return {
    connectionId,
    clientInstanceId: null,
    isVisible: true,
    isSocketOpen: true,
    lastFocusAt,
    lastInputAt: 0,
    lastInputRecencyWriteAt: 0,
  };
}

describe("PrimaryPromotionCoordinator", () => {
  let host: FakePromotionHost;
  let coordinator: PrimaryPromotionCoordinator;
  let instanceRecency: ClientInstanceFocusRecency;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2030-01-01T00:00:00Z"));
    host = new FakePromotionHost();
    coordinator = new PrimaryPromotionCoordinator(host, 1000);
    instanceRecency = new ClientInstanceFocusRecency();
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

  const focus = (
    connectionId: string,
    message: { force?: boolean; reassert?: boolean } = {},
    now: () => number = Date.now,
    recency: ClientInstanceFocusRecency | undefined = undefined,
  ) => {
    handleClientFocus(
      host.connections.get(connectionId)!,
      message,
      (force, reassert) =>
        coordinator.requestPromotion("s1", connectionId, force, reassert),
      now,
      recency,
    );
  };

  const connectInstance = (
    connectionId: string,
    clientInstanceId: string | undefined,
  ): FocusedPromotionConnectionState => {
    const resolvedInstanceId = resolveClientInstanceId(clientInstanceId, connectionId);
    const inherited = instanceRecency.getRecency("s1", resolvedInstanceId);
    const connection = {
      ...visibleOpenConnection(connectionId, inherited.genuineFocusAt),
      lastInputAt: inherited.inputAt,
      lastInputRecencyWriteAt: 0,
      sessionId: "s1",
      clientInstanceId: resolvedInstanceId,
    };
    host.connections.set(connectionId, connection);
    return connection;
  };

  it("promotes the still-mapped open visible candidate when the cooldown expires", () => {
    host.connections.get("B")!.lastFocusAt = Date.now();
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
    host.connections.get("B")!.lastFocusAt = Date.now();
    host.connections.get("C")!.lastFocusAt = Date.now();
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

  it("promotes a genuine challenger after the primary reconnect-flushes a reassert", () => {
    focus("B");
    vi.advanceTimersByTime(100);
    focus("A", { reassert: true });

    expect(coordinator.getPendingCandidate("s1")).toBe("B");
    expect(host.connections.get("A")!.lastFocusAt).toBe(0);
    vi.advanceTimersByTime(900);
    expect(host.primaries.get("s1")).toBe("B");
  });

  it("does not promote a deferred challenger after the primary genuinely refocuses", () => {
    focus("B");
    vi.advanceTimersByTime(100);
    focus("A");

    expect(coordinator.getPendingCandidate("s1")).toBe("B");
    vi.advanceTimersByTime(900);
    expect(host.primaries.get("s1")).toBe("A");
    expect(coordinator.getPendingCandidate("s1")).toBeNull();
    expect(host.broadcasts).toHaveLength(0);
  });

  it("does not let a recency-qualified reassert replace an existing pending candidate", () => {
    focus("B");
    host.connections.get("C")!.lastFocusAt = Date.now() + 1;
    focus("C", { reassert: true });

    expect(coordinator.getPendingCandidate("s1")).toBe("B");
    expect(host.connections.get("C")!.lastFocusAt).toBe(Date.now() + 1);
  });

  it("lets a mobile-style reconnect with newer inherited recency contest and win after cooldown", () => {
    host.connections.get("A")!.lastFocusAt = 100;
    const firstPhone = connectInstance("phone-old", "phone-instance");
    handleClientFocus(firstPhone, {}, vi.fn(), () => 200, instanceRecency);
    host.connections.delete("phone-old");

    connectInstance("phone-new", "phone-instance");
    focus("phone-new", { reassert: true });

    expect(coordinator.getPendingCandidate("s1")).toBe("phone-new");
    expect(host.primaries.get("s1")).toBe("A");
    vi.advanceTimersByTime(1000);
    expect(host.primaries.get("s1")).toBe("phone-new");
  });

  it("ignores an unattended reconnect whose inherited recency is older than the active phone", () => {
    host.connections.get("A")!.lastFocusAt = 300;
    const firstDesktop = connectInstance("desktop-old", "desktop-instance");
    handleClientFocus(firstDesktop, {}, vi.fn(), () => 100, instanceRecency);
    host.connections.delete("desktop-old");

    connectInstance("desktop-new", "desktop-instance");
    focus("desktop-new", { reassert: true });

    expect(host.primaries.get("s1")).toBe("A");
    expect(coordinator.getPendingCandidate("s1")).toBeNull();
  });

  it("uses inherited input engagement to let an actively typed client reclaim on reconnect", () => {
    host.connections.get("A")!.lastFocusAt = 500;
    const firstPhone = connectInstance("phone-old", "phone-instance");
    handleClientFocus(firstPhone, {}, vi.fn(), () => 100, instanceRecency);
    recordClientInput(firstPhone, () => 800, instanceRecency);
    host.connections.delete("phone-old");

    const reconnect = connectInstance("phone-new", "phone-instance");
    focus("phone-new", { reassert: true });

    expect(reconnect.lastFocusAt).toBe(100);
    expect(reconnect.lastInputAt).toBe(800);
    expect(coordinator.getPendingCandidate("s1")).toBe("phone-new");
    vi.advanceTimersByTime(1000);
    expect(host.primaries.get("s1")).toBe("phone-new");
  });

  it("does not let a focus-fresh unattended reconnect rob an actively typed primary", () => {
    const primary = host.connections.get("A")!;
    primary.lastFocusAt = 500;
    primary.lastInputAt = 900;
    const desktop = connectInstance("desktop", "desktop-instance");
    desktop.lastFocusAt = 800;

    focus("desktop", { reassert: true });

    expect(host.primaries.get("s1")).toBe("A");
    expect(coordinator.getPendingCandidate("s1")).toBeNull();
  });

  it("promotes a reconnect over its half-open same-instance primary immediately", () => {
    const zombie = host.connections.get("A")!;
    zombie.clientInstanceId = "stable-instance";
    zombie.lastFocusAt = 500;
    zombie.lastInputAt = 900;
    const reconnect = host.connections.get("B")!;
    reconnect.clientInstanceId = "stable-instance";
    reconnect.lastFocusAt = 500;
    reconnect.lastInputAt = 900;

    focus("B", { reassert: true });

    expect(host.primaries.get("s1")).toBe("B");
    expect(coordinator.getPendingCandidate("s1")).toBeNull();
  });

  it("promotes a genuine focus from the primary's newer same-instance socket immediately", () => {
    host.connections.get("A")!.clientInstanceId = "stable-instance";
    host.connections.get("B")!.clientInstanceId = "stable-instance";

    focus("B");

    expect(host.primaries.get("s1")).toBe("B");
    expect(coordinator.getPendingCandidate("s1")).toBeNull();
  });

  it("inherits genuine focus recency across two connections with the same clientInstanceId", () => {
    host.connections.get("A")!.lastFocusAt = 100;
    host.lastPromotionAt.set("s1", Date.now() - 1000);
    const first = connectInstance("first", "stable-instance");
    handleClientFocus(first, {}, vi.fn(), () => 250, instanceRecency);
    host.connections.delete("first");

    const reconnect = connectInstance("second", "stable-instance");
    expect(reconnect.lastFocusAt).toBe(250);
    focus("second", { reassert: true }, () => 999, instanceRecency);

    expect(reconnect.lastFocusAt).toBe(250);
    expect(host.primaries.get("s1")).toBe("second");
  });

  it("does not inherit focus recency when clientInstanceId is absent", () => {
    const first = connectInstance("legacy-first", undefined);
    handleClientFocus(first, {}, vi.fn(), () => 250, instanceRecency);
    host.connections.delete("legacy-first");

    const reconnect = connectInstance("legacy-second", undefined);

    expect(first.clientInstanceId).toBe("legacy-first");
    expect(reconnect.clientInstanceId).toBe("legacy-second");
    expect(reconnect.lastFocusAt).toBe(0);
  });

  it("treats genuine and reassert open flushes as distinct promotion intents", () => {
    const now = Date.now();
    host.lastPromotionAt.set("s1", now - 1000);
    host.connections.get("B")!.isVisible = false;

    focus("B");
    expect(host.connections.get("B")!.isVisible).toBe(true);
    expect(host.primaries.get("s1")).toBe("B");
    expect(coordinator.getPendingCandidate("s1")).toBeNull();

    host.primaries.set("s1", "A");
    host.lastPromotionAt.set("s1", now);
    host.connections.get("B")!.isVisible = false;
    focus("B");
    expect(host.connections.get("B")!.isVisible).toBe(true);
    expect(host.primaries.get("s1")).toBe("A");
    expect(coordinator.getPendingCandidate("s1")).toBe("B");

    host.connections.get("C")!.isVisible = false;
    focus("C", { reassert: true });
    expect(host.connections.get("C")!.isVisible).toBe(true);
    expect(host.primaries.get("s1")).toBe("A");
    expect(coordinator.getPendingCandidate("s1")).toBe("B");
    expect(host.connections.get("C")!.lastFocusAt).toBe(0);
  });

  it("keeps the current primary when deferred focus recency timestamps tie", () => {
    const timestamp = Date.now();
    handleClientFocus(
      host.connections.get("B")!,
      {},
      (force, reassert) =>
        coordinator.requestPromotion("s1", "B", force, reassert),
      () => timestamp,
    );
    handleClientFocus(
      host.connections.get("A")!,
      {},
      (force, reassert) =>
        coordinator.requestPromotion("s1", "A", force, reassert),
      () => timestamp,
    );

    vi.advanceTimersByTime(1000);

    expect(host.primaries.get("s1")).toBe("A");
    expect(coordinator.getPendingCandidate("s1")).toBeNull();
    expect(host.broadcasts).toHaveLength(0);
  });

  it("promotes a genuinely newer deferred candidate over a zero-recency primary", () => {
    handleClientFocus(
      host.connections.get("B")!,
      {},
      (force, reassert) =>
        coordinator.requestPromotion("s1", "B", force, reassert),
      () => 1,
    );

    vi.advanceTimersByTime(1000);

    expect(host.connections.get("A")!.lastFocusAt).toBe(0);
    expect(host.connections.get("B")!.lastFocusAt).toBe(1);
    expect(host.primaries.get("s1")).toBe("B");
  });

  it("retains the current primary when both deferred recency timestamps are zero", () => {
    coordinator.requestPromotion("s1", "B", false);

    vi.advanceTimersByTime(1000);

    expect(host.connections.get("A")!.lastFocusAt).toBe(0);
    expect(host.connections.get("B")!.lastFocusAt).toBe(0);
    expect(host.primaries.get("s1")).toBe("A");
  });

  it("promotes the deferred challenger when the newer primary has blurred", () => {
    focus("B");
    vi.advanceTimersByTime(100);
    focus("A");
    host.connections.get("A")!.isVisible = false;
    coordinator.notifyBlur("s1", "A");

    vi.advanceTimersByTime(900);

    expect(host.primaries.get("s1")).toBe("B");
    expect(coordinator.getPendingCandidate("s1")).toBeNull();
  });

  it("clearSession removes a pending candidate and cancels its timer", () => {
    coordinator.requestPromotion("s1", "B", false);

    coordinator.clearSession("s1");
    vi.advanceTimersByTime(1000);

    expect(coordinator.getPendingCandidate("s1")).toBeNull();
    expect(host.primaries.get("s1")).toBe("A");
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

describe("replacement primary selection", () => {
  it("prefers visible connections and keeps pool order for zero-timestamp ties", () => {
    expect(
      pickNextPrimaryConnection([
        { connectionId: "A", isVisible: false, lastFocusAt: 0 },
        { connectionId: "B", isVisible: true, lastFocusAt: 0 },
        { connectionId: "C", isVisible: true, lastFocusAt: 0 },
      ]),
    ).toBe("B");

    expect(
      pickNextPrimaryConnection([
        { connectionId: "A", isVisible: false, lastFocusAt: 0 },
        { connectionId: "B", isVisible: false, lastFocusAt: 0 },
      ]),
    ).toBe("A");
  });
});

describe("last-connection controller cleanup", () => {
  it("preserves engagement across a total disconnect so reconnect can inherit it", () => {
    const sizeController = { clearSession: vi.fn() };
    const promotionCoordinator = { clearSession: vi.fn() };
    const focusRecency = new ClientInstanceFocusRecency();
    focusRecency.recordGenuineFocus("s1", "stable-instance", 123);
    focusRecency.recordInput("s1", "stable-instance", 456);

    clearSessionControllerState(
      "s1",
      sizeController,
      promotionCoordinator,
    );

    expect(sizeController.clearSession).toHaveBeenCalledWith("s1");
    expect(promotionCoordinator.clearSession).toHaveBeenCalledWith("s1");
    expect(focusRecency.getRecency("s1", "stable-instance")).toEqual({
      genuineFocusAt: 123,
      inputAt: 456,
    });
  });
});

describe("client instance engagement recency", () => {
  it("keeps connection input exact while throttling inherited-map writes to once per second", () => {
    const recency = new ClientInstanceFocusRecency();
    recency.recordInput("s1", "stable-instance", 900);
    const connection = {
      lastInputAt: 900,
      lastInputRecencyWriteAt: 0,
      sessionId: "s1",
      clientInstanceId: "stable-instance",
    };

    recordClientInput(connection, () => 1000, recency);
    recordClientInput(connection, () => 1500, recency);

    expect(connection.lastInputAt).toBe(1500);
    expect(recency.getLastInputAt("s1", "stable-instance")).toBe(1000);

    recordClientInput(connection, () => 2000, recency);
    expect(recency.getLastInputAt("s1", "stable-instance")).toBe(2000);
  });

  it("caps each session at 16 instances and evicts the oldest engagement", () => {
    const recency = new ClientInstanceFocusRecency();
    recency.recordGenuineFocus("s1", "instance-0", 1);
    recency.recordInput("s1", "instance-0", 100);
    for (let index = 1; index < 16; index++) {
      recency.recordGenuineFocus("s1", `instance-${index}`, index + 1);
    }

    recency.recordGenuineFocus("s1", "instance-16", 17);

    expect(recency.getRecency("s1", "instance-0")).toEqual({
      genuineFocusAt: 1,
      inputAt: 100,
    });
    expect(recency.getRecency("s1", "instance-1")).toEqual({
      genuineFocusAt: 0,
      inputAt: 0,
    });
    expect(recency.getLastGenuineFocusAt("s1", "instance-16")).toBe(17);
  });
});
