export const MIN_COLS = 10;
export const MIN_ROWS = 3;

export type ReconcileReason =
  | "panel-visible"
  | "page-visible"
  | "window-focus"
  | "window-resize"
  | "visual-viewport"
  | "resize-observer"
  | "font-change"
  | "socket-open"
  | "post-init"
  | "active"
  | "refit"
  | "dpr-change";

export interface FitResult {
  cols: number;
  rows: number;
}

export interface ReconcilerHost {
  getContainer(): HTMLElement | null;
  fitVerified(): FitResult | null;
  isPageVisible(): boolean;
  isPanelVisible(): boolean;
  getWebSocket(): WebSocket | null;
  onDimensions?(cols: number, rows: number): void;
  raf(cb: () => void): number;
  caf(id: number): void;
}

export interface ReconcilerLimits {
  minWidth: number;
  minHeight: number;
  minCols: number;
  minRows: number;
  stableFrames: number;
  maxFrames: number;
  observerDebounceMs: number;
}

interface RectSize {
  width: number;
  height: number;
}

const DEFAULT_LIMITS: ReconcilerLimits = {
  minWidth: 100,
  minHeight: 80,
  minCols: MIN_COLS,
  minRows: MIN_ROWS,
  stableFrames: 2,
  maxFrames: 10,
  observerDebounceMs: 16,
};

export class ResizeReconciler {
  private readonly limits: ReconcilerLimits;
  private disposed = false;
  private epoch = 0;
  private generation = 0;
  private committedRect: RectSize | null = null;
  private desiredDims: FitResult | null = null;
  private observerTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly pendingFrames = new Map<number, () => void>();

  constructor(
    private readonly host: ReconcilerHost,
    opts: Partial<ReconcilerLimits> = {},
  ) {
    this.limits = { ...DEFAULT_LIMITS, ...opts };
  }

  request(_reason: ReconcileReason): void {
    void this.startReconcile();
  }

  reconcileOnce(_reason: ReconcileReason): Promise<FitResult | null> {
    return this.startReconcile();
  }

  notifyPanelVisibility(visible: boolean): void {
    if (this.disposed) return;

    if (!visible) {
      // Dropping the committed rect is what makes an identical-size reveal
      // reconcile again instead of being deduped away (RC-A).
      this.committedRect = null;
      this.generation++;
      this.cancelPendingFrames();
      if (this.observerTimer !== null) {
        clearTimeout(this.observerTimer);
        this.observerTimer = null;
      }
      return;
    }

    this.request("panel-visible");
  }

  observeRect(width: number, height: number): void {
    if (this.disposed) return;
    if (
      this.committedRect?.width === width &&
      this.committedRect.height === height
    ) {
      return;
    }

    if (this.observerTimer !== null) clearTimeout(this.observerTimer);
    const epoch = this.epoch;
    this.observerTimer = setTimeout(() => {
      this.observerTimer = null;
      if (this.disposed || epoch !== this.epoch) return;
      this.request("resize-observer");
    }, this.limits.observerDebounceMs);
  }

  notifySocketOpen(socket: WebSocket): void {
    if (this.disposed || socket !== this.host.getWebSocket()) return;

    if (this.desiredDims) this.sendResize(socket, this.desiredDims);
    this.request("socket-open");
  }

  getDesiredDims(): FitResult | null {
    return this.desiredDims ? { ...this.desiredDims } : null;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.epoch++;
    this.generation++;
    if (this.observerTimer !== null) {
      clearTimeout(this.observerTimer);
      this.observerTimer = null;
    }
    this.cancelPendingFrames();
  }

  private async startReconcile(): Promise<FitResult | null> {
    if (this.disposed) return null;

    const epoch = this.epoch;
    const generation = ++this.generation;
    this.cancelPendingFrames();
    if (!this.isLive(epoch, generation)) return null;

    let lastWidth = 0;
    let lastHeight = 0;
    let stableFrames = 0;

    for (let attempt = 0; attempt < this.limits.maxFrames; attempt++) {
      await this.nextFrame();
      if (!this.isLive(epoch, generation)) return null;

      const rect = this.getRect();
      if (!rect || !this.isMeasurable(rect)) continue;

      if (rect.width === lastWidth && rect.height === lastHeight) {
        stableFrames++;
        if (stableFrames >= this.limits.stableFrames) break;
      } else {
        stableFrames = 0;
        lastWidth = rect.width;
        lastHeight = rect.height;
      }
    }

    if (!this.isLive(epoch, generation)) return null;

    const rect = this.getRect();
    if (!rect || !this.isMeasurable(rect)) return null;

    const dims = this.host.fitVerified();
    if (!this.isCurrent(epoch, generation) || !dims) return null;
    if (dims.cols < this.limits.minCols || dims.rows < this.limits.minRows) {
      return null;
    }

    this.committedRect = rect;
    this.desiredDims = { ...dims };
    const socket = this.host.getWebSocket();
    if (socket?.readyState === WebSocket.OPEN) this.sendResize(socket, dims);
    this.host.onDimensions?.(dims.cols, dims.rows);
    return { ...dims };
  }

  private nextFrame(): Promise<void> {
    return new Promise((resolve) => {
      const id = this.host.raf(() => {
        this.pendingFrames.delete(id);
        resolve();
      });
      this.pendingFrames.set(id, resolve);
    });
  }

  private cancelPendingFrames() {
    for (const [id, resolve] of this.pendingFrames) {
      this.host.caf(id);
      resolve();
    }
    this.pendingFrames.clear();
  }

  private isCurrent(epoch: number, generation: number) {
    return (
      !this.disposed &&
      epoch === this.epoch &&
      generation === this.generation
    );
  }

  /** Re-checked after every async boundary: a superseded or hidden generation
   *  must abort before it can measure or fit (RC-B). */
  private isLive(epoch: number, generation: number) {
    return this.isCurrent(epoch, generation) && this.isVisible();
  }

  private isVisible() {
    return this.host.isPageVisible() && this.host.isPanelVisible();
  }

  private getRect(): RectSize | null {
    const container = this.host.getContainer();
    if (!container) return null;
    const { width, height } = container.getBoundingClientRect();
    return { width, height };
  }

  private isMeasurable(rect: RectSize) {
    return (
      rect.width >= this.limits.minWidth &&
      rect.height >= this.limits.minHeight
    );
  }

  private sendResize(socket: WebSocket, dims: FitResult) {
    try {
      socket.send(
        JSON.stringify({ type: "resize", cols: dims.cols, rows: dims.rows }),
      );
    } catch {
      // Desired dimensions stay queued for the next socket-open replay.
    }
  }
}
