/**
 * ThreadPanel tests — desktop thread send-failure feedback.
 *
 * Verifies that when `sendMessage` resolves with `{ ok: false }` while
 * replying in a thread, the panel surfaces a sonner error toast.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";

const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: { error: (msg: string) => toastError(msg) },
}));

const sendMessage = vi.fn();
const parentMessage = {
  id: "p1",
  channelId: "c1",
  parentMessageId: null,
  authorSessionId: "s1",
  body: "parent",
  createdAt: new Date().toISOString(),
  replyCount: 0,
};

const channelContextValue = {
  activeChannelMessages: [parentMessage],
  openThreadId: "p1",
  closeThread: vi.fn(),
  threadMessages: [],
  sendMessage,
};

vi.mock("@/contexts/ChannelContext", () => ({
  useChannelContext: () => channelContextValue,
}));

vi.mock("@/contexts/PeerChatContext", () => ({
  usePeerChatContext: () => ({
    peerNameMap: new Map(),
  }),
}));

// Replace the message row with a stub so we don't pull in markdown deps.
vi.mock("../ChannelMessageRow", () => ({
  ChannelMessageRow: () => null,
}));

import { ThreadPanel } from "../ThreadPanel";

beforeEach(() => {
  toastError.mockReset();
  sendMessage.mockReset();
});

afterEach(() => {
  cleanup();
});

function typeAndSend(text: string) {
  const textarea = screen.getByPlaceholderText(
    /Reply in thread/i
  ) as HTMLTextAreaElement;
  fireEvent.change(textarea, { target: { value: text } });
  fireEvent.keyDown(textarea, { key: "Enter" });
}

describe("ThreadPanel.handleSend", () => {
  it("shows a toast when sendMessage returns { ok: false }", async () => {
    sendMessage.mockResolvedValue({ ok: false, error: "boom" });
    render(<ThreadPanel />);
    typeAndSend("reply");
    await waitFor(() => {
      expect(sendMessage).toHaveBeenCalledWith("reply", "p1");
      expect(toastError).toHaveBeenCalledWith("Failed to send message");
    });
  });

  it("does not toast when sendMessage returns { ok: true }", async () => {
    sendMessage.mockResolvedValue({ ok: true });
    render(<ThreadPanel />);
    typeAndSend("reply ok");
    await waitFor(() => {
      expect(sendMessage).toHaveBeenCalledWith("reply ok", "p1");
    });
    expect(toastError).not.toHaveBeenCalled();
  });
});
