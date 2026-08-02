import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  MIN_COLS,
  MIN_ROWS,
  ResizeReconciler,
  type ReconcilerHost,
} from "./resize-reconciler";

class FakeWebSocket {
  readyState: number = WebSocket.OPEN;
  sent: string[] = [];

  send(frame: string) {
    this.sent.push(frame);
  }
}

class FakeHost implements ReconcilerHost {
  rect = { width: 800, height: 480 };
  panelVisible = true;
  pageVisible = true;
  fitNoopMode = false;
  grid = { cols: 80, rows: 24 };
  fitCalls = 0;
  ws = new FakeWebSocket();
  private nextRafId = 1;
  private rafQueue = new Map<number, () => void>();

  getContainer() {
    return {
      getBoundingClientRect: () => ({ ...this.rect }),
    } as HTMLElement;
  }

  fitVerified() {
    this.fitCalls++;
    if (this.fitNoopMode) return null;

    const proposal = {
      cols: Math.floor(this.rect.width / 8),
      rows: Math.floor(this.rect.height / 16),
    };
    if (proposal.cols < MIN_COLS || proposal.rows < MIN_ROWS) return null;
    this.grid = proposal;
    return { ...this.grid };
  }

  isPageVisible() {
    return this.pageVisible;
  }

  isPanelVisible() {
    return this.panelVisible;
  }

  getWebSocket() {
    return this.ws as unknown as WebSocket;
  }

  raf(cb: () => void) {
    const id = this.nextRafId++;
    this.rafQueue.set(id, cb);
    return id;
  }

  caf(id: number) {
    this.rafQueue.delete(id);
  }

  async pump(count = 1) {
    for (let index = 0; index < count; index++) {
      const next = this.rafQueue.entries().next().value as
        | [number, () => void]
        | undefined;
      if (!next) {
        await Promise.resolve();
        continue;
      }
      this.rafQueue.delete(next[0]);
      next[1]();
      await Promise.resolve();
    }
  }

  async pumpUntilIdle() {
    let emptyPasses = 0;
    for (let iteration = 0; iteration < 100; iteration++) {
      if (this.rafQueue.size > 0) {
        emptyPasses = 0;
        await this.pump(1);
      } else {
        await Promise.resolve();
        emptyPasses++;
        if (emptyPasses >= 3 && this.rafQueue.size === 0) return;
      }
    }
    throw new Error("rAF queue did not become idle");
  }

  get sentResizes() {
    return this.ws.sent
      .map((frame) => JSON.parse(frame) as { type: string; cols: number; rows: number })
      .filter((frame) => frame.type === "resize");
  }
}

describe("ResizeReconciler", () => {
  let host: FakeHost;
  let reconciler: ResizeReconciler;

  beforeEach(() => {
    vi.useFakeTimers();
    host = new FakeHost();
    reconciler = new ResizeReconciler(host);
  });

  afterEach(() => {
    reconciler.dispose();
    vi.useRealTimers();
  });

  it("RC-A: rect observed then hidden before debounce — re-show at same size still fits", async () => {
    host.rect = { width: 800, height: 480 };
    reconciler.observeRect(800, 480);
    host.panelVisible = false;
    reconciler.notifyPanelVisibility(false);
    await vi.advanceTimersByTimeAsync(20);
    expect(host.fitCalls).toBe(0);

    host.panelVisible = true;
    reconciler.notifyPanelVisibility(true);
    await host.pumpUntilIdle();

    expect(host.sentResizes.at(-1)).toEqual({
      type: "resize",
      cols: 100,
      rows: 30,
    });
  });

  it("RC-B: hide mid-settle aborts without fitting; reveal replays", async () => {
    reconciler.request("window-resize");
    await host.pump(1);
    host.panelVisible = false;
    reconciler.notifyPanelVisibility(false);
    await host.pumpUntilIdle();
    expect(host.fitCalls).toBe(0);

    host.panelVisible = true;
    reconciler.notifyPanelVisibility(true);
    await host.pumpUntilIdle();
    expect(host.fitCalls).toBeGreaterThan(0);
  });

  it("RC-I: socket closed at send time — dims queued and replayed on open", async () => {
    host.ws.readyState = WebSocket.CONNECTING;
    reconciler.request("active");
    await host.pumpUntilIdle();
    expect(host.sentResizes).toHaveLength(0);
    expect(reconciler.getDesiredDims()).toEqual({ cols: 100, rows: 30 });

    host.ws.readyState = WebSocket.OPEN;
    reconciler.notifySocketOpen(host.ws as unknown as WebSocket);
    expect(host.sentResizes.at(-1)).toEqual({
      type: "resize",
      cols: 100,
      rows: 30,
    });
  });

  it("finding #5: no-op fit commits nothing and sends nothing", async () => {
    host.fitNoopMode = true;
    reconciler.observeRect(800, 480);
    await vi.advanceTimersByTimeAsync(20);
    await host.pumpUntilIdle();
    expect(host.sentResizes).toHaveLength(0);
    expect(reconciler.getDesiredDims()).toBeNull();

    host.fitNoopMode = false;
    reconciler.request("window-focus");
    await host.pumpUntilIdle();
    expect(host.sentResizes.at(-1)).toEqual({
      type: "resize",
      cols: 100,
      rows: 30,
    });
  });

  it("finding #6: stale socket identity — notifySocketOpen(oldWs) is a no-op", () => {
    const oldWs = host.ws;
    host.ws = new FakeWebSocket();

    reconciler.notifySocketOpen(oldWs as unknown as WebSocket);

    expect(host.ws.sent).toHaveLength(0);
    expect(oldWs.sent).toHaveLength(0);
  });

  it("finding #6: dispose cancels in-flight work; all methods no-op after", async () => {
    reconciler.request("active");
    await host.pump(1);
    reconciler.dispose();
    await host.pumpUntilIdle();
    expect(host.fitCalls).toBe(0);

    reconciler.request("active");
    reconciler.notifyPanelVisibility(true);
    reconciler.observeRect(900, 500);
    reconciler.notifySocketOpen(host.ws as unknown as WebSocket);
    await vi.advanceTimersByTimeAsync(20);
    await host.pumpUntilIdle();
    expect(host.fitCalls).toBe(0);
  });

  it("reconcileOnce resolves with verified dims (pre-connect path)", async () => {
    const result = reconciler.reconcileOnce("post-init");
    await host.pumpUntilIdle();
    expect(await result).toEqual({ cols: 100, rows: 30 });
  });

  it("reconcileOnce follows a superseding request to the latest verified dimensions", async () => {
    const result = reconciler.reconcileOnce("post-init");
    await host.pump(1);
    host.rect = { width: 960, height: 640 };
    reconciler.request("resize-observer");
    await host.pumpUntilIdle();

    expect(await result).toEqual({ cols: 120, rows: 40 });
    expect(host.sentResizes).toEqual([
      { type: "resize", cols: 120, rows: 40 },
    ]);
  });

  it("never sends grids below 10×3 and does not commit them", async () => {
    host.rect = { width: 72, height: 32 };
    reconciler.request("window-resize");
    await host.pumpUntilIdle();

    expect(host.sentResizes).toHaveLength(0);
    expect(reconciler.getDesiredDims()).toBeNull();
  });

  it("request while page hidden is deferred, not dropped", async () => {
    host.pageVisible = false;
    reconciler.request("window-resize");
    await host.pumpUntilIdle();
    expect(host.fitCalls).toBe(0);

    host.pageVisible = true;
    reconciler.request("page-visible");
    await host.pumpUntilIdle();
    expect(host.sentResizes.at(-1)).toEqual({
      type: "resize",
      cols: 100,
      rows: 30,
    });
  });
});
