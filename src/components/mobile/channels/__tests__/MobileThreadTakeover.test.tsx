/**
 * MobileThreadTakeover tests (Phase 5 mobile redesign).
 *
 * Covers the adversarial-review fixes:
 *  - ESC closes the takeover.
 *  - Auto-scroll fires only when threadMessages.length increases (a new
 *    array reference with the same length must NOT scroll).
 *  - The composer is disabled when the parent message can't be resolved.
 *  - Focus moves into the takeover on open and is restored on close.
 *  - Tab cycles between focusables inside the takeover.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";

import type { ChannelMessage } from "@/types/channels";

const channelState = {
  activeChannelMessages: [] as ChannelMessage[],
  openThreadId: null as string | null,
  threadMessages: [] as ChannelMessage[],
  sendMessage: vi.fn().mockResolvedValue(undefined),
};

vi.mock("@/contexts/ChannelContext", () => ({
  useChannelContext: () => channelState,
}));

vi.mock("@/contexts/PeerChatContext", () => ({
  usePeerChatContext: () => ({ peerNameMap: new Map() }),
}));

vi.mock("@/hooks/useMobile", () => ({
  usePrefersReducedMotion: () => true, // makes the two-phase mount synchronous
}));

import { MobileThreadTakeover } from "../MobileThreadTakeover";

const baseMessage = (over: Partial<ChannelMessage> = {}): ChannelMessage => ({
  id: over.id ?? "m1",
  channelId: over.channelId ?? "c1",
  fromSessionId: over.fromSessionId ?? "s1",
  fromSessionName: over.fromSessionName ?? "claude",
  toSessionId: over.toSessionId ?? null,
  body: over.body ?? "hi",
  isUserMessage: over.isUserMessage ?? false,
  parentMessageId: over.parentMessageId ?? null,
  replyCount: over.replyCount ?? 0,
  createdAt: over.createdAt ?? "2025-01-01T00:00:00Z",
});

beforeEach(() => {
  channelState.activeChannelMessages = [];
  channelState.openThreadId = null;
  channelState.threadMessages = [];
  channelState.sendMessage.mockClear();
  // jsdom's scrollIntoView is undefined; install a spy so the takeover
  // doesn't blow up when it auto-scrolls.
  Element.prototype.scrollIntoView = vi.fn() as unknown as typeof Element.prototype.scrollIntoView;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("MobileThreadTakeover", () => {
  it("closes on ESC", async () => {
    channelState.openThreadId = "m1";
    channelState.activeChannelMessages = [baseMessage({ id: "m1" })];
    const onClose = vi.fn();
    render(<MobileThreadTakeover open={true} onClose={onClose} />);
    // Wait one frame for the rAF inside the two-phase mount to fire.
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(() => r(undefined)));
    });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("disables the composer when parentMessage cannot be resolved", async () => {
    // openThreadId points at a message id that isn't in the channel — the
    // takeover renders but the composer must lock so we don't post replies
    // into the void.
    channelState.openThreadId = "missing";
    channelState.activeChannelMessages = [];
    render(<MobileThreadTakeover open={true} onClose={() => {}} />);
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(() => r(undefined)));
    });
    // The composer's textarea reflects the disabled prop.
    const textarea = screen.getByTestId(
      "mobile-channel-composer-textarea"
    ) as HTMLTextAreaElement;
    expect(textarea.disabled).toBe(true);
  });

  it("auto-scrolls only when threadMessages.length increases", async () => {
    channelState.openThreadId = "m1";
    channelState.activeChannelMessages = [baseMessage({ id: "m1" })];
    channelState.threadMessages = [baseMessage({ id: "r1" })];
    const scrollSpy = vi.spyOn(Element.prototype, "scrollIntoView");

    const { rerender } = render(
      <MobileThreadTakeover open={true} onClose={() => {}} />
    );
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(() => r(undefined)));
    });
    const initialCalls = scrollSpy.mock.calls.length;
    expect(initialCalls).toBeGreaterThan(0);

    // New array reference, SAME length — simulates an unrelated context
    // update (e.g. a peer summary refresh). Must NOT scroll.
    channelState.threadMessages = [baseMessage({ id: "r1" })];
    rerender(<MobileThreadTakeover open={true} onClose={() => {}} />);
    expect(scrollSpy.mock.calls.length).toBe(initialCalls);

    // Length increases — DOES scroll.
    channelState.threadMessages = [
      baseMessage({ id: "r1" }),
      baseMessage({ id: "r2" }),
    ];
    rerender(<MobileThreadTakeover open={true} onClose={() => {}} />);
    expect(scrollSpy.mock.calls.length).toBeGreaterThan(initialCalls);
  });

  it("moves focus inside the takeover on open and restores it on close", async () => {
    channelState.openThreadId = "m1";
    channelState.activeChannelMessages = [baseMessage({ id: "m1" })];
    // A button outside the takeover that holds focus before opening.
    const previous = document.createElement("button");
    previous.textContent = "before";
    document.body.appendChild(previous);
    previous.focus();
    expect(document.activeElement).toBe(previous);

    const { unmount } = render(
      <MobileThreadTakeover open={true} onClose={() => {}} />
    );
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(() => r(undefined)));
    });
    const takeover = screen.getByTestId("mobile-thread-takeover");
    // Focus should now be inside the takeover.
    expect(takeover.contains(document.activeElement)).toBe(true);

    unmount();
    // Restored to the previously-focused element.
    expect(document.activeElement).toBe(previous);
    document.body.removeChild(previous);
  });

  it("traps Tab inside the takeover (cycles last → first)", async () => {
    channelState.openThreadId = "m1";
    channelState.activeChannelMessages = [baseMessage({ id: "m1" })];
    render(<MobileThreadTakeover open={true} onClose={() => {}} />);
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(() => r(undefined)));
    });
    const takeover = screen.getByTestId("mobile-thread-takeover");
    const focusables = Array.from(
      takeover.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    );
    expect(focusables.length).toBeGreaterThanOrEqual(2);
    const first = focusables[0];
    const last = focusables[focusables.length - 1];

    // Park focus on the last focusable, press Tab — should wrap to first.
    last.focus();
    expect(document.activeElement).toBe(last);
    fireEvent.keyDown(takeover, { key: "Tab" });
    expect(document.activeElement).toBe(first);

    // Shift+Tab on the first wraps to the last.
    fireEvent.keyDown(takeover, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });
});
