/**
 * ChannelView tests — desktop send-failure feedback.
 *
 * Verifies that when `sendMessage` resolves with `{ ok: false }`, the
 * desktop ChannelView surfaces a sonner error toast so silent send
 * failures aren't invisible to the user.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";

const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: { error: (msg: string) => toastError(msg) },
}));

const sendMessage = vi.fn();
const channelContextValue = {
  groups: [
    {
      id: "g1",
      name: "Channels",
      kind: "channels" as const,
      channels: [
        {
          id: "c1",
          name: "general",
          displayName: "general",
          topic: null,
          kind: "channel" as const,
        },
      ],
    },
  ],
  activeChannelId: "c1",
  activeChannelMessages: [],
  loading: false,
  sendMessage,
  markChannelRead: vi.fn(),
  openThread: vi.fn(),
  openThreadId: null,
};

vi.mock("@/contexts/ChannelContext", () => ({
  useChannelContext: () => channelContextValue,
}));

vi.mock("@/contexts/PeerChatContext", () => ({
  usePeerChatContext: () => ({
    peers: [],
    peerNameMap: new Map(),
  }),
}));

// Avoid pulling in the ThreadPanel tree (which has its own context deps).
vi.mock("../ThreadPanel", () => ({
  ThreadPanel: () => null,
}));

import { ChannelView } from "../ChannelView";

beforeEach(() => {
  toastError.mockReset();
  sendMessage.mockReset();
});

afterEach(() => {
  cleanup();
});

function typeAndSend(text: string) {
  const textarea = screen.getByPlaceholderText(
    /Message #general/i
  ) as HTMLTextAreaElement;
  fireEvent.change(textarea, { target: { value: text } });
  fireEvent.keyDown(textarea, { key: "Enter" });
}

describe("ChannelView.handleSend", () => {
  it("shows a toast when sendMessage returns { ok: false }", async () => {
    sendMessage.mockResolvedValue({ ok: false, error: "boom" });
    render(<ChannelView folderId="f1" folderName="Folder" />);
    typeAndSend("hello");
    await waitFor(() => {
      expect(sendMessage).toHaveBeenCalledWith("hello");
      expect(toastError).toHaveBeenCalledWith("Failed to send message");
    });
  });

  it("does not toast when sendMessage returns { ok: true }", async () => {
    sendMessage.mockResolvedValue({ ok: true });
    render(<ChannelView folderId="f1" folderName="Folder" />);
    typeAndSend("hi");
    await waitFor(() => {
      expect(sendMessage).toHaveBeenCalledWith("hi");
    });
    expect(toastError).not.toHaveBeenCalled();
  });
});
