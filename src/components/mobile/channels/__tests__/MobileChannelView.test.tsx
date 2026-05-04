/**
 * MobileChannelView tests (Phase 5 mobile redesign).
 *
 * Covers two adversarial-review concerns:
 *   - markChannelRead is called once per UNIQUE last-message-id, not on
 *     every re-render with the same id.
 *   - Empty channels render without a greeter — the composer + header are
 *     the only persistent UI.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";

import type { ChannelMessage, ChannelGroup } from "@/types/channels";

const channelState = {
  groups: [] as ChannelGroup[],
  activeChannelId: null as string | null,
  activeChannelMessages: [] as ChannelMessage[],
  sendMessage: vi.fn().mockResolvedValue({ ok: true }),
  markChannelRead: vi.fn().mockResolvedValue(undefined),
  openThread: vi.fn(),
};

vi.mock("@/contexts/ChannelContext", () => ({
  useChannelContext: () => channelState,
}));
vi.mock("@/contexts/PeerChatContext", () => ({
  usePeerChatContext: () => ({ peerNameMap: new Map() }),
}));

import { MobileChannelView } from "../MobileChannelView";

const channel = (over: Partial<ChannelGroup["channels"][number]> = {}) => ({
  id: over.id ?? "c1",
  folderId: "p1",
  groupId: "g1",
  name: over.name ?? "general",
  displayName: over.displayName ?? "general",
  type: over.type ?? "public",
  topic: over.topic ?? null,
  isDefault: over.isDefault ?? false,
  lastMessageAt: null,
  messageCount: 0,
  unreadCount: over.unreadCount ?? 0,
  createdAt: "2025-01-01T00:00:00Z",
});

const message = (over: Partial<ChannelMessage> = {}): ChannelMessage => ({
  id: over.id ?? "m1",
  channelId: over.channelId ?? "c1",
  fromSessionId: over.fromSessionId ?? "s1",
  fromSessionName: over.fromSessionName ?? "claude",
  toSessionId: over.toSessionId ?? null,
  body: over.body ?? "hello",
  isUserMessage: over.isUserMessage ?? false,
  parentMessageId: over.parentMessageId ?? null,
  replyCount: over.replyCount ?? 0,
  createdAt: over.createdAt ?? "2025-01-01T00:00:00Z",
});

beforeEach(() => {
  channelState.groups = [
    {
      id: "g1",
      folderId: "p1",
      name: "Channels",
      position: 0,
      channels: [channel({ id: "c1" })],
    },
  ] as ChannelGroup[];
  channelState.activeChannelId = "c1";
  channelState.activeChannelMessages = [];
  channelState.markChannelRead.mockClear();
  channelState.sendMessage.mockClear();
  channelState.openThread.mockClear();
  Element.prototype.scrollIntoView = vi.fn() as unknown as typeof Element.prototype.scrollIntoView;
});

afterEach(() => cleanup());

describe("MobileChannelView", () => {
  it("calls markChannelRead once per unique last-message-id, not on every re-render with the same id", () => {
    channelState.activeChannelMessages = [message({ id: "m1" })];
    const { rerender } = render(
      <MobileChannelView onBack={() => {}} onOpenThread={() => {}} />
    );
    expect(channelState.markChannelRead).toHaveBeenCalledTimes(1);
    expect(channelState.markChannelRead).toHaveBeenLastCalledWith("c1", "m1");

    // New array reference, same trailing id — must NOT refire the request.
    channelState.activeChannelMessages = [message({ id: "m1" })];
    rerender(<MobileChannelView onBack={() => {}} onOpenThread={() => {}} />);
    expect(channelState.markChannelRead).toHaveBeenCalledTimes(1);

    // New trailing id — DOES refire.
    channelState.activeChannelMessages = [
      message({ id: "m1" }),
      message({ id: "m2" }),
    ];
    rerender(<MobileChannelView onBack={() => {}} onOpenThread={() => {}} />);
    expect(channelState.markChannelRead).toHaveBeenCalledTimes(2);
    expect(channelState.markChannelRead).toHaveBeenLastCalledWith("c1", "m2");
  });

  it("ignores optimistic placeholder messages (id starts with 'opt-')", () => {
    channelState.activeChannelMessages = [message({ id: "opt-pending" })];
    render(<MobileChannelView onBack={() => {}} onOpenThread={() => {}} />);
    expect(channelState.markChannelRead).not.toHaveBeenCalled();
  });

  it("opens an action sheet on long-press and routes 'Reply in thread' through openThread", () => {
    vi.useFakeTimers();
    channelState.activeChannelMessages = [message({ id: "m1", body: "hello" })];
    const onOpenThread = vi.fn();
    render(<MobileChannelView onBack={() => {}} onOpenThread={onOpenThread} />);
    const wrap = screen.getByTestId("mobile-channel-message-wrap");
    // Begin a press; useLongPress fires after ~450ms.
    fireEvent.pointerDown(wrap, { clientX: 0, clientY: 0, button: 0 });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    fireEvent.pointerUp(wrap);
    // Action sheet is rendered; its menu items live inside the portal.
    const sheet = screen.getByTestId("mobile-bottom-sheet");
    expect(sheet).toBeTruthy();
    // Tap "Reply in thread" — should call openThread + onOpenThread.
    const replyItem = sheet.querySelector(
      '[data-action-id="reply"]'
    ) as HTMLButtonElement;
    expect(replyItem).toBeTruthy();
    fireEvent.click(replyItem);
    expect(channelState.openThread).toHaveBeenCalledWith("m1");
    expect(onOpenThread).toHaveBeenCalledWith("m1");
    vi.useRealTimers();
  });

  it("renders an empty channel as composer + header only (no greeter)", () => {
    channelState.activeChannelMessages = [];
    render(<MobileChannelView onBack={() => {}} onOpenThread={() => {}} />);
    // Composer and header are present.
    expect(screen.getByTestId("mobile-channel-view")).toBeTruthy();
    expect(screen.getByTestId("mobile-channel-view-title").textContent).toBe(
      "general"
    );
    expect(screen.getByTestId("mobile-channel-composer-textarea")).toBeTruthy();
    // No greeter / illustrated empty state.
    expect(screen.queryByText(/be the first/i)).toBeNull();
    expect(screen.queryByText(/welcome/i)).toBeNull();
    expect(screen.queryByText(/no messages/i)).toBeNull();
    // markChannelRead must not have been called for an empty stream.
    expect(channelState.markChannelRead).not.toHaveBeenCalled();
  });
});
