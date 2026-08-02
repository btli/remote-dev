import type { Logger } from "@/lib/logger";

export interface TmuxExec {
  (args: string[], callback: (err: Error | null) => void): void;
}

interface TmuxSize {
  cols: number;
  rows: number;
}

interface ResizeRequest extends TmuxSize {
  tmuxSessionName: string;
  force: boolean;
}

interface SessionSizeState {
  epoch: number;
  applied: TmuxSize | null;
  desired: ResizeRequest | null;
  busy: boolean;
}

function sizesEqual(left: TmuxSize | null, right: TmuxSize): boolean {
  return left?.cols === right.cols && left.rows === right.rows;
}

/**
 * Serializes tmux window resizing per remote-dev session.
 *
 * Requests are latest-wins while an exec is in flight. The applied-size cache
 * is only updated after a successful callback, and forced requests bypass that
 * cache because tmux may have been resized by an external client.
 */
export class TmuxSizeController {
  private readonly sessions = new Map<string, SessionSizeState>();
  private readonly sessionEpochs = new Map<string, number>();

  constructor(
    private readonly exec: TmuxExec,
    private readonly log: Logger,
  ) {}

  requestResize(
    sessionId: string,
    tmuxSessionName: string,
    cols: number,
    rows: number,
    opts: { force?: boolean } = {},
  ): void {
    const state = this.getOrCreateState(sessionId);
    const force = state.desired?.force === true || opts.force === true;
    state.desired = {
      tmuxSessionName,
      cols,
      rows,
      force,
    };
    this.pump(sessionId, state);
  }

  /**
   * Forget all sizing state for a tmux session that has been destroyed.
   * Stale callbacks retain the old state identity and safely no-op after the
   * maps are deleted, while a recreated session can start work immediately.
   */
  clearSession(sessionId: string): void {
    const state = this.sessions.get(sessionId);
    if (state) {
      state.epoch++;
      state.applied = null;
      state.desired = null;
      state.busy = false;
    }
    this.sessions.delete(sessionId);
    this.sessionEpochs.delete(sessionId);
  }

  getAppliedSize(sessionId: string): TmuxSize | null {
    const applied = this.sessions.get(sessionId)?.applied;
    return applied ? { ...applied } : null;
  }

  private getOrCreateState(sessionId: string): SessionSizeState {
    const existing = this.sessions.get(sessionId);
    if (existing) return existing;

    const state: SessionSizeState = {
      epoch: this.sessionEpochs.get(sessionId) ?? 0,
      applied: null,
      desired: null,
      busy: false,
    };
    this.sessions.set(sessionId, state);
    return state;
  }

  private pump(sessionId: string, state: SessionSizeState): void {
    if (state.busy) return;

    const request = state.desired;
    if (!request) return;

    state.desired = null;
    if (!request.force && sizesEqual(state.applied, request)) return;

    state.busy = true;
    const requestEpoch = state.epoch;
    let completed = false;
    const complete = (error: Error | null): void => {
      if (completed) return;
      completed = true;

      const current = this.sessions.get(sessionId);
      if (current !== state) return;

      state.busy = false;
      if (current.epoch === requestEpoch) {
        if (error) {
          this.log.warn("tmux resize-window failed", {
            error: String(error),
            sessionId,
            tmuxSessionName: request.tmuxSessionName,
            cols: request.cols,
            rows: request.rows,
          });
        } else {
          state.applied = { cols: request.cols, rows: request.rows };
        }
      }

      this.pump(sessionId, state);
    };

    try {
      this.exec(
        [
          "resize-window",
          "-t",
          request.tmuxSessionName,
          "-x",
          String(request.cols),
          "-y",
          String(request.rows),
        ],
        complete,
      );
    } catch (error) {
      complete(error instanceof Error ? error : new Error(String(error)));
    }
  }
}
