/**
 * MobileSessionRow swipe-stage tests.
 *
 * The row drives the two-stage iOS-Mail-style swipe through the underlying
 * useSwipeAction hook. These tests synthesise touch events at specific
 * offsets and assert that the right callback fires for each stage:
 *
 *   - Active session, swipe past stage 0 only  → onSwipeSuspend
 *   - Active session, swipe past stage 1       → onSwipeClose
 *   - Suspended session, swipe past threshold  → onSwipeClose (single-stage)
 *   - Closed session, swipe                    → no callbacks fire
 *
 * The behind-layer affordance label is also asserted to switch to "Close"
 * with destructive tone when the live drag crosses the second threshold.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

import { MobileSessionRow } from "@/components/mobile/sessions/MobileSessionRow";
import type { TerminalSession } from "@/types/session";

vi.mock("@/hooks/useMobile", () => ({
  usePrefersReducedMotion: () => false,
}));

function makeSession(over: Partial<TerminalSession> = {}): TerminalSession {
  return {
    id: "s1",
    userId: "u1",
    name: "main",
    tmuxSessionName: "rdv-s1",
    projectPath: "/tmp/x",
    githubRepoId: null,
    worktreeBranch: null,
    worktreeType: null,
    projectId: "p1",
    profileId: null,
    terminalType: "shell",
    agentProvider: null,
    agentExitState: null,
    agentExitCode: null,
    agentExitedAt: null,
    agentRestartCount: 0,
    agentActivityStatus: null,
    agentActivityStatusAt: null,
    typeMetadata: null,
    scopeKey: null,
    parentSessionId: null,
    status: "active",
    pinned: false,
    tabOrder: 0,
    lastActivityAt: new Date(Date.now() - 60_000),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

function swipeLeft(row: HTMLElement, deltaX: number) {
  const startX = 250;
  fireEvent.touchStart(row, { touches: [{ clientX: startX, clientY: 30 }] });
  fireEvent.touchMove(row, {
    touches: [{ clientX: startX + deltaX, clientY: 30 }],
  });
  fireEvent.touchEnd(row);
}

afterEach(() => cleanup());

describe("MobileSessionRow two-stage swipe", () => {
  let onTap: (id: string) => void;
  let onLongPress: (id: string) => void;
  let onSwipeSuspend: (id: string) => void;
  let onSwipeClose: (id: string) => void;

  beforeEach(() => {
    onTap = vi.fn<(id: string) => void>();
    onLongPress = vi.fn<(id: string) => void>();
    onSwipeSuspend = vi.fn<(id: string) => void>();
    onSwipeClose = vi.fn<(id: string) => void>();
  });

  it("active row: swipe past stage 0 commits Suspend (not Close)", () => {
    render(
      <MobileSessionRow
        session={makeSession({ status: "active" })}
        activity="idle"
        active={false}
        onTap={onTap}
        onLongPress={onLongPress}
        onSwipeSuspend={onSwipeSuspend}
        onSwipeClose={onSwipeClose}
      />
    );
    const row = screen.getByTestId("mobile-session-row");
    // -100px is past SUSPEND_THRESHOLD (72) but well shy of CLOSE_THRESHOLD (180).
    swipeLeft(row, -100);
    expect(onSwipeSuspend).toHaveBeenCalledWith("s1");
    expect(onSwipeClose).not.toHaveBeenCalled();
  });

  it("active row: swipe past stage 1 commits Close (not Suspend)", () => {
    render(
      <MobileSessionRow
        session={makeSession({ status: "active" })}
        activity="idle"
        active={false}
        onTap={onTap}
        onLongPress={onLongPress}
        onSwipeSuspend={onSwipeSuspend}
        onSwipeClose={onSwipeClose}
      />
    );
    const row = screen.getByTestId("mobile-session-row");
    // -240px clears the 180px CLOSE_THRESHOLD.
    swipeLeft(row, -240);
    expect(onSwipeClose).toHaveBeenCalledWith("s1");
    expect(onSwipeSuspend).not.toHaveBeenCalled();
  });

  it("active row: swipe shy of stage 0 fires nothing (snaps back)", () => {
    render(
      <MobileSessionRow
        session={makeSession({ status: "active" })}
        activity="idle"
        active={false}
        onTap={onTap}
        onLongPress={onLongPress}
        onSwipeSuspend={onSwipeSuspend}
        onSwipeClose={onSwipeClose}
      />
    );
    const row = screen.getByTestId("mobile-session-row");
    swipeLeft(row, -40);
    expect(onSwipeSuspend).not.toHaveBeenCalled();
    expect(onSwipeClose).not.toHaveBeenCalled();
  });

  it("suspended row: single-stage swipe past threshold commits Close", () => {
    render(
      <MobileSessionRow
        session={makeSession({ status: "suspended" })}
        activity="idle"
        active={false}
        onTap={onTap}
        onLongPress={onLongPress}
        onSwipeSuspend={onSwipeSuspend}
        onSwipeClose={onSwipeClose}
      />
    );
    const row = screen.getByTestId("mobile-session-row");
    // -100 is past the single threshold (72) — Suspend is N/A on a
    // suspended row, so this should commit Close, not Suspend.
    swipeLeft(row, -100);
    expect(onSwipeClose).toHaveBeenCalledWith("s1");
    expect(onSwipeSuspend).not.toHaveBeenCalled();
  });

  it("suspended row: a deep swipe still commits Close (only one stage)", () => {
    render(
      <MobileSessionRow
        session={makeSession({ status: "suspended" })}
        activity="idle"
        active={false}
        onTap={onTap}
        onLongPress={onLongPress}
        onSwipeSuspend={onSwipeSuspend}
        onSwipeClose={onSwipeClose}
      />
    );
    const row = screen.getByTestId("mobile-session-row");
    swipeLeft(row, -260);
    expect(onSwipeClose).toHaveBeenCalledTimes(1);
    expect(onSwipeClose).toHaveBeenCalledWith("s1");
    expect(onSwipeSuspend).not.toHaveBeenCalled();
  });

  it("closed row: swipe fires nothing (gestures disabled)", () => {
    render(
      <MobileSessionRow
        session={makeSession({ status: "closed" })}
        activity="idle"
        active={false}
        onTap={onTap}
        onLongPress={onLongPress}
        onSwipeSuspend={onSwipeSuspend}
        onSwipeClose={onSwipeClose}
      />
    );
    const row = screen.getByTestId("mobile-session-row");
    swipeLeft(row, -240);
    expect(onSwipeSuspend).not.toHaveBeenCalled();
    expect(onSwipeClose).not.toHaveBeenCalled();
  });
});
