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
  applied: TmuxSize | null;
  desired: ResizeRequest | null;
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
  private readonly inFlightNames = new Map<string, object>();

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
   * Forget sizing state for a disconnected or destroyed session. An in-flight
   * name lock deliberately survives eviction so a recreated state cannot run a
   * concurrent command against the same tmux session. Its callback releases
   * the lock, ignores the evicted state by object identity, and pumps live work.
   */
  clearSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  getAppliedSize(sessionId: string): TmuxSize | null {
    const applied = this.sessions.get(sessionId)?.applied;
    return applied ? { ...applied } : null;
  }

  private getOrCreateState(sessionId: string): SessionSizeState {
    const existing = this.sessions.get(sessionId);
    if (existing) return existing;

    const state: SessionSizeState = {
      applied: null,
      desired: null,
    };
    this.sessions.set(sessionId, state);
    return state;
  }

  private pump(sessionId: string, state: SessionSizeState): void {
    const request = state.desired;
    if (!request) return;

    if (!request.force && sizesEqual(state.applied, request)) {
      state.desired = null;
      return;
    }
    if (this.inFlightNames.has(request.tmuxSessionName)) return;

    state.desired = null;
    const lock = {};
    this.inFlightNames.set(request.tmuxSessionName, lock);
    let completed = false;
    const complete = (error: Error | null): void => {
      if (completed) return;
      completed = true;

      if (this.inFlightNames.get(request.tmuxSessionName) === lock) {
        this.inFlightNames.delete(request.tmuxSessionName);
      }

      const current = this.sessions.get(sessionId);
      if (current === state) {
        if (error) {
          // A failed command means tmux's actual size is unknown. In
          // particular, a forced repair may have followed an external tmux
          // resize, so retaining the old cache would suppress the next
          // ordinary same-size request forever.
          state.applied = null;
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

      this.pumpCurrentStateForName(request.tmuxSessionName);
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

  private pumpCurrentStateForName(tmuxSessionName: string): void {
    for (const [sessionId, state] of this.sessions) {
      if (state.desired?.tmuxSessionName !== tmuxSessionName) continue;
      this.pump(sessionId, state);
      return;
    }
  }
}
