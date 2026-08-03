// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ClientInstanceFocusRecency,
  clearSessionControllerState,
  flushClientInstanceRecency,
  handleClientFocus,
  pickNextPrimaryConnection,
  PrimaryPromotionCoordinator,
  parseInitialTerminalDimensions,
  recordClientInput,
  resolveClientInstanceId,
  sweepClientInstanceRecency,
  tmuxSessionConfirmedAbsent,
  type PromotionRequestResult,
  type PromotionConnectionState,
  type PromotionCoordinatorHost,
} from "@/server/terminal";

type FocusedPromotionConnectionState = PromotionConnectionState & {
  connectionSeq: number;
  lastFocusAt: number;
  lastInputAt: number;
  lastInputRecencyWriteAt: number;
  sessionId?: string;
  clientInstanceId: string | null;
};

let nextConnectionSeq = 0;

class FakePromotionHost implements PromotionCoordinatorHost {
  readonly connections = new Map<string, FocusedPromotionConnectionState>();
  readonly primaries = new Map<string, string>();
  readonly lastPromotionAt = new Map<string, number>();
  readonly reassertions: Array<{ sessionId: string; connectionId: string }> = [];
  readonly broadcasts: string[] = [];
  currentTime: number | null = null;

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
    return this.currentTime ?? Date.now();
  }
}

function visibleOpenConnection(
  connectionId: string,
  lastFocusAt = 0,
  connectionSeq = ++nextConnectionSeq,
): FocusedPromotionConnectionState {
  return {
    connectionId,
    connectionSeq,
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
    nextConnectionSeq = 0;
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
    let result: PromotionRequestResult | undefined;
    handleClientFocus(
      host.connections.get(connectionId)!,
      message,
      (force, reassert) => {
        result = coordinator.requestPromotion(
          "s1",
          connectionId,
          force,
          reassert,
        );
      },
      now,
      recency,
    );
    return result;
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

  it("preserves a deferred challenger when disconnect handoff elects another connection", () => {
    host.connections.get("A")!.lastFocusAt = 50;
    host.connections.get("B")!.lastFocusAt = 200;
    host.connections.get("C")!.lastFocusAt = 100;
    host.connections.get("C")!.lastInputAt = 300;
    coordinator.requestPromotion("s1", "B", false);

    coordinator.notifyDisconnect("s1", "A");
    host.connections.delete("A");
    const nextPrimary = pickNextPrimaryConnection([
      host.connections.get("B")!,
      host.connections.get("C")!,
    ]);
    expect(nextPrimary).toBe("C");
    coordinator.clearPendingPromotionIfCandidate("s1", nextPrimary!);
    host.primaries.set("s1", nextPrimary!);
    host.lastPromotionAt.set("s1", Date.now());

    expect(coordinator.getPendingCandidate("s1")).toBe("B");
    vi.advanceTimersByTime(1000);

    expect(host.primaries.get("s1")).toBe("B");
    expect(coordinator.getPendingCandidate("s1")).toBeNull();
  });

  it("re-defers after a handoff starts a fresh cooldown and eventually promotes", () => {
    const startedAt = 10_000;
    host.currentTime = startedAt;
    host.lastPromotionAt.set("s1", startedAt);
    host.connections.get("B")!.lastFocusAt = startedAt + 300;
    host.connections.get("C")!.lastFocusAt = startedAt + 100;

    coordinator.requestPromotion("s1", "B", false);
    vi.advanceTimersByTime(200);
    host.currentTime = startedAt + 200;

    host.primaries.set("s1", "C");
    host.lastPromotionAt.set("s1", host.now());

    host.currentTime = startedAt + 1000;
    vi.advanceTimersByTime(800);
    expect(host.primaries.get("s1")).toBe("C");
    expect(coordinator.getPendingCandidate("s1")).toBe("B");

    host.currentTime = startedAt + 1200;
    vi.advanceTimersByTime(200);
    expect(host.primaries.get("s1")).toBe("B");
    expect(coordinator.getPendingCandidate("s1")).toBeNull();
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

  it("keeps a genuine pending reason when the same candidate later reasserts", () => {
    host.connections.get("A")!.lastFocusAt = 100;
    focus("B", {}, () => 200);
    focus("B", { reassert: true });

    host.connections.get("A")!.lastInputAt = 300;
    vi.advanceTimersByTime(1000);

    expect(host.primaries.get("s1")).toBe("B");
    expect(host.broadcasts).toEqual(["s1"]);
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

  it("flushes exact connection-local recency on disconnect so reconnect engagement wins", () => {
    const oldConnection = connectInstance("phone-old", "phone-instance");
    oldConnection.lastFocusAt = 1100;

    recordClientInput(oldConnection, () => 1000, instanceRecency);
    recordClientInput(oldConnection, () => 1500, instanceRecency);
    expect(instanceRecency.getLastInputAt("s1", "phone-instance")).toBe(1000);

    flushClientInstanceRecency(oldConnection, instanceRecency);
    host.connections.delete("phone-old");
    const reconnect = connectInstance("phone-new", "phone-instance");
    host.connections.get("A")!.lastInputAt = 1250;

    focus("phone-new", { reassert: true });
    vi.advanceTimersByTime(1000);

    expect(reconnect.lastFocusAt).toBe(1100);
    expect(reconnect.lastInputAt).toBe(1500);
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

  it("defers a reconnect over its half-open same-instance primary until cooldown expiry", () => {
    const zombie = host.connections.get("A")!;
    zombie.clientInstanceId = "stable-instance";
    zombie.lastFocusAt = 500;
    zombie.lastInputAt = 900;
    const reconnect = host.connections.get("B")!;
    reconnect.clientInstanceId = "stable-instance";
    reconnect.lastFocusAt = 500;
    reconnect.lastInputAt = 900;

    focus("B", { reassert: true });

    expect(host.primaries.get("s1")).toBe("A");
    expect(coordinator.getPendingCandidate("s1")).toBe("B");

    vi.advanceTimersByTime(1000);

    expect(host.primaries.get("s1")).toBe("B");
    expect(coordinator.getPendingCandidate("s1")).toBeNull();
  });

  it("drops an older pending socket instead of replacing its newer same-instance primary", () => {
    const candidate = host.connections.get("B")!;
    candidate.clientInstanceId = "stable-instance";
    candidate.connectionSeq = 10;
    candidate.lastFocusAt = 500;
    coordinator.requestPromotion("s1", "B", false);

    const replacement = host.connections.get("C")!;
    replacement.clientInstanceId = "stable-instance";
    replacement.connectionSeq = 11;
    replacement.lastFocusAt = 500;
    host.primaries.set("s1", "C");
    host.lastPromotionAt.set("s1", Date.now());

    vi.advanceTimersByTime(1000);

    expect(host.primaries.get("s1")).toBe("C");
    expect(coordinator.getPendingCandidate("s1")).toBeNull();
    expect(host.broadcasts).toHaveLength(0);
  });

  it("does not let an older same-instance genuine focus replace a pending challenger", () => {
    const primary = host.connections.get("C")!;
    primary.clientInstanceId = "stable-instance";
    primary.connectionSeq = 11;
    primary.lastFocusAt = Date.now();
    host.primaries.set("s1", "C");

    const challenger = visibleOpenConnection("D", Date.now() + 1);
    challenger.clientInstanceId = "challenger-instance";
    host.connections.set("D", challenger);
    expect(coordinator.requestPromotion("s1", "D", false)).toBe("deferred");
    expect(coordinator.getPendingCandidate("s1")).toBe("D");

    const zombie = host.connections.get("B")!;
    zombie.clientInstanceId = "stable-instance";
    zombie.connectionSeq = 10;
    expect(focus("B")).toBe("ignored");
    expect(coordinator.getPendingCandidate("s1")).toBe("D");

    vi.advanceTimersByTime(1000);

    expect(host.primaries.get("s1")).toBe("D");
    expect(coordinator.getPendingCandidate("s1")).toBeNull();
  });

  it("ignores an older same-instance reassert even with fresher engagement", () => {
    const candidate = host.connections.get("B")!;
    candidate.clientInstanceId = "stable-instance";
    candidate.connectionSeq = 10;
    const primary = host.connections.get("C")!;
    primary.clientInstanceId = "stable-instance";
    primary.connectionSeq = 11;
    primary.lastFocusAt = 500;
    host.primaries.set("s1", "C");
    host.lastPromotionAt.set("s1", Date.now() - 1000);

    expect(focus("B", {}, () => 501)).toBe("ignored");
    expect(candidate.lastFocusAt).toBe(501);
    expect(focus("B", { reassert: true })).toBe("ignored");
    expect(host.primaries.get("s1")).toBe("C");
    expect(host.broadcasts).toHaveLength(0);
  });

  it("ignores older-generation same-instance genuine focus against its newer primary", () => {
    const candidate = host.connections.get("B")!;
    candidate.clientInstanceId = "stable-instance";
    candidate.connectionSeq = 10;
    const primary = host.connections.get("C")!;
    primary.clientInstanceId = "stable-instance";
    primary.connectionSeq = 11;
    host.primaries.set("s1", "C");
    host.lastPromotionAt.set("s1", Date.now() - 1000);

    expect(coordinator.requestPromotion("s1", "B", false)).toBe("ignored");
    expect(host.primaries.get("s1")).toBe("C");
    expect(host.broadcasts).toHaveLength(0);
  });

  it("defers genuine focus from the primary's newer same-instance socket until cooldown expiry", () => {
    host.connections.get("A")!.clientInstanceId = "stable-instance";
    host.connections.get("B")!.clientInstanceId = "stable-instance";

    focus("B");

    expect(host.primaries.get("s1")).toBe("A");
    expect(coordinator.getPendingCandidate("s1")).toBe("B");

    vi.advanceTimersByTime(1000);

    expect(host.primaries.get("s1")).toBe("B");
    expect(coordinator.getPendingCandidate("s1")).toBeNull();
  });

  it("coalesces rapid same-instance flap promotions within one cooldown", () => {
    host.connections.get("A")!.clientInstanceId = "stable-instance";
    for (const connectionId of ["B", "C", "D"]) {
      const connection = visibleOpenConnection(connectionId);
      connection.clientInstanceId = "stable-instance";
      host.connections.set(connectionId, connection);
      focus(connectionId, { reassert: true });
      vi.advanceTimersByTime(100);
    }

    expect(host.broadcasts).toHaveLength(0);
    vi.advanceTimersByTime(700);

    expect(["B", "C", "D"]).toContain(host.primaries.get("s1"));
    expect(host.broadcasts).toEqual(["s1"]);
    expect(host.reassertions).toHaveLength(1);
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

  it("lets deferred genuine focus beat a primary that keeps typing", () => {
    const primary = host.connections.get("A")!;
    primary.lastFocusAt = 100;
    primary.lastInputAt = 700;
    handleClientFocus(
      host.connections.get("B")!,
      {},
      (force, reassert) =>
        coordinator.requestPromotion("s1", "B", force, reassert),
      () => 200,
    );

    primary.lastInputAt = 900;
    vi.advanceTimersByTime(1000);

    expect(host.primaries.get("s1")).toBe("B");
    expect(host.broadcasts).toEqual(["s1"]);
  });

  it("drops a deferred reassert challenger when the primary types more recently", () => {
    const primary = host.connections.get("A")!;
    primary.lastFocusAt = 100;
    primary.lastInputAt = 700;
    const challenger = host.connections.get("B")!;
    challenger.lastFocusAt = 200;
    challenger.lastInputAt = 800;

    focus("B", { reassert: true });
    expect(coordinator.getPendingCandidate("s1")).toBe("B");

    primary.lastInputAt = 900;
    vi.advanceTimersByTime(1000);

    expect(host.primaries.get("s1")).toBe("A");
    expect(host.broadcasts).toHaveLength(0);
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
        { connectionId: "A", isVisible: false, lastFocusAt: 0, lastInputAt: 0 },
        { connectionId: "B", isVisible: true, lastFocusAt: 0, lastInputAt: 0 },
        { connectionId: "C", isVisible: true, lastFocusAt: 0, lastInputAt: 0 },
      ]),
    ).toBe("B");

    expect(
      pickNextPrimaryConnection([
        { connectionId: "A", isVisible: false, lastFocusAt: 0, lastInputAt: 0 },
        { connectionId: "B", isVisible: false, lastFocusAt: 0, lastInputAt: 0 },
      ]),
    ).toBe("A");
  });

  it("ranks visible handoff survivors by their latest focus or input engagement", () => {
    expect(
      pickNextPrimaryConnection([
        { connectionId: "B", isVisible: true, lastFocusAt: 100, lastInputAt: 900 },
        { connectionId: "C", isVisible: true, lastFocusAt: 500, lastInputAt: 0 },
      ]),
    ).toBe("B");
  });

  it("falls back to focus recency when viewer-only engagement ties", () => {
    expect(
      pickNextPrimaryConnection([
        { connectionId: "B", isVisible: false, lastFocusAt: 100, lastInputAt: 900 },
        { connectionId: "C", isVisible: false, lastFocusAt: 900, lastInputAt: 0 },
      ]),
    ).toBe("C");
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

  it("does not let an older disconnect flush regress newer instance recency", () => {
    const recency = new ClientInstanceFocusRecency();
    recency.recordGenuineFocus("s1", "stable-instance", 500);
    recency.recordInput("s1", "stable-instance", 900);

    flushClientInstanceRecency({
      lastFocusAt: 400,
      lastInputAt: 800,
      lastInputRecencyWriteAt: 0,
      sessionId: "s1",
      clientInstanceId: "stable-instance",
    }, recency);

    expect(recency.getRecency("s1", "stable-instance")).toEqual({
      genuineFocusAt: 500,
      inputAt: 900,
    });
  });

  it("refreshes an already-live same-instance replacement during disconnect flush", () => {
    const recency = new ClientInstanceFocusRecency();
    recency.recordInput("s1", "phone-instance", 1000);
    const oldConnection = {
      ...visibleOpenConnection("phone-old"),
      lastInputAt: 1500,
      sessionId: "s1",
      clientInstanceId: "phone-instance",
    };
    const replacement = {
      ...visibleOpenConnection("phone-new"),
      lastInputAt: recency.getLastInputAt("s1", "phone-instance"),
      sessionId: "s1",
      clientInstanceId: "phone-instance",
    };
    flushClientInstanceRecency(
      oldConnection,
      recency,
      [replacement],
    );

    expect(replacement.lastInputAt).toBe(1500);
    const promotionHost = new FakePromotionHost();
    promotionHost.connections.set("A", {
      ...visibleOpenConnection("A"),
      lastInputAt: 1200,
    });
    promotionHost.connections.set("phone-new", replacement);
    promotionHost.primaries.set("s1", "A");
    promotionHost.lastPromotionAt.set("s1", Date.now() - 1000);
    const promotionCoordinator = new PrimaryPromotionCoordinator(
      promotionHost,
      1000,
    );
    try {
      promotionCoordinator.requestPromotion("s1", "phone-new", false, true);
      expect(promotionHost.primaries.get("s1")).toBe("phone-new");
    } finally {
      promotionCoordinator.dispose();
    }
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

describe("client instance recency orphan sweep", () => {
  it("clears zero-connection dead-tmux entries and preserves live-tmux entries", () => {
    const recency = new ClientInstanceFocusRecency();
    const deadSessionId = "00000000-0000-4000-8000-000000000001";
    const liveSessionId = "00000000-0000-4000-8000-000000000002";
    recency.recordInput(deadSessionId, "dead-instance", 100);
    recency.recordInput(liveSessionId, "live-instance", 200);

    sweepClientInstanceRecency(
      recency,
      () => 0,
      (tmuxSessionName) => tmuxSessionName === `rdv-${deadSessionId}`,
    );

    expect(recency.getSessionIds()).toEqual([liveSessionId]);
    expect(recency.getLastInputAt(liveSessionId, "live-instance")).toBe(200);
  });

  it("preserves recency when the tmux absence probe throws transiently", () => {
    const recency = new ClientInstanceFocusRecency();
    const sessionId = "00000000-0000-4000-8000-000000000003";
    recency.recordInput(sessionId, "stable-instance", 300);

    sweepClientInstanceRecency(
      recency,
      () => 0,
      (tmuxSessionName) =>
        tmuxSessionConfirmedAbsent(tmuxSessionName, () => {
          throw Object.assign(new Error("resource temporarily unavailable"), {
            code: "EAGAIN",
          });
        }),
    );

    expect(recency.getSessionIds()).toEqual([sessionId]);
  });

  it("preserves recency when tmux reports a transient socket failure", () => {
    const recency = new ClientInstanceFocusRecency();
    const sessionId = "00000000-0000-4000-8000-000000000005";
    recency.recordInput(sessionId, "stable-instance", 500);

    sweepClientInstanceRecency(
      recency,
      () => 0,
      (tmuxSessionName) =>
        tmuxSessionConfirmedAbsent(tmuxSessionName, () => {
          throw Object.assign(new Error("tmux socket unavailable"), {
            status: 1,
            stderr: Buffer.from("error connecting to tmux socket (EAGAIN)"),
          });
        }),
    );

    expect(recency.getSessionIds()).toEqual([sessionId]);
  });

  it("clears recency when tmux cleanly reports no such session", () => {
    const recency = new ClientInstanceFocusRecency();
    const sessionId = "00000000-0000-4000-8000-000000000004";
    recency.recordInput(sessionId, "stable-instance", 400);

    sweepClientInstanceRecency(
      recency,
      () => 0,
      (tmuxSessionName) =>
        tmuxSessionConfirmedAbsent(tmuxSessionName, () => {
          throw Object.assign(new Error("tmux has-session exited 1"), {
            status: 1,
            stderr: Buffer.from("can't find session"),
          });
        }),
    );

    expect(recency.getSessionIds()).toEqual([]);
  });
});

describe("tmuxSessionConfirmedAbsent", () => {
  const probeFailure = (stderr: string) => () => {
    throw Object.assign(new Error("tmux has-session exited 1"), {
      status: 1,
      stderr: Buffer.from(stderr),
    });
  };

  it("accepts the tmux 3.7b missing-server socket response", () => {
    expect(
      tmuxSessionConfirmedAbsent(
        "rdv-s1",
        probeFailure(
          "error connecting to /private/tmp/tmux-501/default (No such file or directory)",
        ),
      ),
    ).toBe(true);
  });

  it("accepts an explicit missing-session response", () => {
    expect(
      tmuxSessionConfirmedAbsent(
        "rdv-s1",
        probeFailure("can't find session: rdv-s1"),
      ),
    ).toBe(true);
  });

  it("does not accept a silent nonzero exit as confirmed absence", () => {
    expect(
      tmuxSessionConfirmedAbsent("rdv-s1", probeFailure("")),
    ).toBe(false);
  });

  it("does not accept unrelated nonzero stderr as confirmed absence", () => {
    expect(
      tmuxSessionConfirmedAbsent(
        "rdv-s1",
        probeFailure("open terminal failed: Operation not permitted (EPERM)"),
      ),
    ).toBe(false);
  });
});
