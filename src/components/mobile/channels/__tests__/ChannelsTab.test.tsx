/**
 * ChannelsTab integration tests (Phase 5 mobile redesign).
 *
 * Drives the actual component with stubbed channel + peer + preferences +
 * project tree contexts. Verifies:
 *   - the list pane renders by default
 *   - tapping a channel routes into the view pane
 *   - the back chevron returns to the list
 *   - the DM FAB opens the picker sheet
 *   - the thread takeover renders when openThreadId is non-null
 */

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import type { ReactNode } from "react";

import type { ChannelGroup, ChannelMessage } from "@/types/channels";

// Mutable channel-context state so individual tests can flip openThreadId.
const channelState = {
  groups: [
    {
      id: "g1",
      folderId: "p1",
      name: "Channels",
      position: 0,
      channels: [
        {
          id: "c1",
          folderId: "p1",
          groupId: "g1",
          name: "general",
          displayName: "general",
          type: "public" as const,
          topic: "team chat",
          isDefault: true,
          lastMessageAt: null,
          messageCount: 1,
          unreadCount: 0,
          createdAt: "2025-01-01T00:00:00Z",
        },
      ],
    },
  ] as ChannelGroup[],
  activeChannelId: null as string | null,
  setActiveChannelId: vi.fn((id: string | null) => {
    channelState.activeChannelId = id;
  }),
  activeChannelMessages: [] as ChannelMessage[],
  totalUnreadCount: 0,
  loading: false,
  sendMessage: vi.fn().mockResolvedValue(undefined),
  markChannelRead: vi.fn().mockResolvedValue(undefined),
  openThread: vi.fn(),
  closeThread: vi.fn(() => {
    channelState.openThreadId = null;
  }),
  openThreadId: null as string | null,
  threadMessages: [] as ChannelMessage[],
  refreshChannels: vi.fn().mockResolvedValue(undefined),
  createChannel: vi.fn(),
  addMessage: vi.fn(),
  addThreadReply: vi.fn(),
  addChannel: vi.fn(),
};

vi.mock("@/contexts/ChannelContext", async () => {
  const actual = await vi.importActual<
    typeof import("@/contexts/ChannelContext")
  >("@/contexts/ChannelContext");
  return {
    ...actual,
    useChannelContext: () => channelState,
    useChannelContextOptional: () => channelState,
    ChannelProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  };
});

vi.mock("@/contexts/PeerChatContext", () => ({
  usePeerChatContext: () => ({
    peers: [],
    peerNameMap: new Map(),
  }),
}));

vi.mock("@/contexts/PreferencesContext", () => ({
  usePreferencesContext: () => ({
    activeProject: { folderId: "p1" },
  }),
}));

vi.mock("@/contexts/ProjectTreeContext", () => ({
  useProjectTree: () => ({
    getProject: (id: string) =>
      id === "p1"
        ? { id: "p1", name: "Alpha", groupId: null, isAutoCreated: false, sortOrder: 0, collapsed: false }
        : undefined,
  }),
}));

vi.mock("@/contexts/SessionContext", () => ({
  useSessionContext: () => ({
    sessions: [],
    activeSessionId: null,
  }),
}));

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn() }),
}));

import { ChannelsTab } from "../ChannelsTab";

beforeEach(() => {
  channelState.activeChannelId = null;
  channelState.openThreadId = null;
  channelState.activeChannelMessages = [];
  channelState.threadMessages = [];
  channelState.setActiveChannelId.mockClear();
  channelState.closeThread.mockClear();
  channelState.openThread.mockClear();
});

afterEach(() => cleanup());

describe("ChannelsTab", () => {
  it("renders the channel list by default with the project name in the header", () => {
    render(<ChannelsTab />);
    expect(screen.getByTestId("mobile-channels-tab")).toBeTruthy();
    expect(screen.getByText(/Channels.*Alpha/)).toBeTruthy();
    expect(screen.getByText("general")).toBeTruthy();
    // FAB is visible on the list pane.
    expect(screen.getByTestId("mobile-channels-dm-fab")).toBeTruthy();
  });

  it("routes to the channel view when a row is tapped", () => {
    render(<ChannelsTab />);
    const row = screen.getByTestId("mobile-channel-row");
    fireEvent.click(row);
    expect(channelState.setActiveChannelId).toHaveBeenCalledWith("c1");
    expect(screen.getByTestId("mobile-channel-view")).toBeTruthy();
    expect(screen.getByTestId("mobile-channel-view-title").textContent).toBe("general");
    // FAB is hidden on the view pane.
    expect(screen.queryByTestId("mobile-channels-dm-fab")).toBeNull();
  });

  it("returns to the list when the back chevron is tapped", () => {
    channelState.activeChannelId = "c1";
    render(<ChannelsTab />);
    fireEvent.click(screen.getByTestId("mobile-channel-row"));
    fireEvent.click(screen.getByTestId("mobile-channel-back"));
    expect(screen.getByTestId("mobile-channel-list")).toBeTruthy();
  });

  it("opens the DM picker sheet when the FAB is tapped", () => {
    render(<ChannelsTab />);
    fireEvent.click(screen.getByTestId("mobile-channels-dm-fab"));
    // BottomSheet portals into document.body — query the document.
    const sheet = within(document.body).getByTestId("mobile-bottom-sheet");
    expect(sheet).toBeTruthy();
    expect(within(sheet).getByText("Direct message")).toBeTruthy();
  });

  it("renders the thread takeover when openThreadId is set", () => {
    channelState.activeChannelId = "c1";
    channelState.openThreadId = "m1";
    channelState.activeChannelMessages = [
      {
        id: "m1",
        channelId: "c1",
        fromSessionId: "s1",
        fromSessionName: "claude",
        toSessionId: null,
        body: "hello",
        isUserMessage: false,
        parentMessageId: null,
        replyCount: 0,
        createdAt: "2025-01-01T00:00:00Z",
      },
    ];
    render(<ChannelsTab />);
    fireEvent.click(screen.getByTestId("mobile-channel-row"));
    expect(screen.getByTestId("mobile-thread-takeover")).toBeTruthy();
    expect(screen.getByTestId("mobile-thread-back")).toBeTruthy();
    expect(screen.getByTestId("mobile-thread-empty")).toBeTruthy();
  });

  it("closes the thread takeover when its back chevron is tapped", () => {
    channelState.activeChannelId = "c1";
    channelState.openThreadId = "m1";
    channelState.activeChannelMessages = [
      {
        id: "m1",
        channelId: "c1",
        fromSessionId: null,
        fromSessionName: "You",
        toSessionId: null,
        body: "ping",
        isUserMessage: true,
        parentMessageId: null,
        replyCount: 0,
        createdAt: "2025-01-01T00:00:00Z",
      },
    ];
    render(<ChannelsTab />);
    fireEvent.click(screen.getByTestId("mobile-channel-row"));
    fireEvent.click(screen.getByTestId("mobile-thread-back"));
    expect(channelState.closeThread).toHaveBeenCalled();
  });
});
