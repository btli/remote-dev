/**
 * DmPickerSheet tests (Phase 5 mobile redesign).
 *
 * Covers the empty-state flavors, the happy path (POST /api/channels/dm
 * triggers addChannel + setActiveChannelId + onOpenDm), and the failure
 * path (sheet stays alive and surfaces a toast.error rather than crashing).
 */

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, fireEvent, cleanup, waitFor, within } from "@testing-library/react";

// Mutable channel/peer state so individual tests can vary.
const channelState = {
  setActiveChannelId: vi.fn(),
  addChannel: vi.fn(),
};

const peerState = {
  peers: [] as Array<{
    sessionId: string;
    name: string;
    peerSummary: string | null;
    agentProvider: string | null;
  }>,
};

const sessionState = {
  sessions: [] as Array<{ id: string; projectId: string; status: string }>,
  activeSessionId: null as string | null,
};

const prefsState = {
  activeProject: { folderId: null as string | null },
};

const toastError = vi.fn();

vi.mock("@/contexts/ChannelContext", () => ({
  useChannelContext: () => channelState,
}));
vi.mock("@/contexts/PeerChatContext", () => ({
  usePeerChatContext: () => peerState,
}));
vi.mock("@/contexts/SessionContext", () => ({
  useSessionContext: () => sessionState,
}));
vi.mock("@/contexts/PreferencesContext", () => ({
  usePreferencesContext: () => prefsState,
}));
vi.mock("@/hooks/useMobile", () => ({
  usePrefersReducedMotion: () => true,
}));
vi.mock("sonner", () => ({
  toast: { error: (msg: string) => toastError(msg) },
}));

import { DmPickerSheet } from "../DmPickerSheet";

beforeEach(() => {
  channelState.setActiveChannelId.mockReset();
  channelState.addChannel.mockReset();
  toastError.mockReset();
  peerState.peers = [];
  sessionState.sessions = [];
  sessionState.activeSessionId = null;
  prefsState.activeProject.folderId = null;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("DmPickerSheet", () => {
  it("shows the no-project empty state when no project is active", async () => {
    render(<DmPickerSheet open={true} onOpenChange={() => {}} onOpenDm={() => {}} />);
    const sheet = within(document.body).getByTestId("mobile-bottom-sheet");
    expect(within(sheet).getByText("Pick a project first.")).toBeTruthy();
  });

  it("shows the no-from-session empty state when no session is in the project", async () => {
    prefsState.activeProject.folderId = "p1";
    sessionState.sessions = [];
    render(<DmPickerSheet open={true} onOpenChange={() => {}} onOpenDm={() => {}} />);
    const sheet = within(document.body).getByTestId("mobile-bottom-sheet");
    expect(
      within(sheet).getByText("Open a session in this project first.")
    ).toBeTruthy();
  });

  it("shows the no-peers empty state when no eligible peers exist", () => {
    prefsState.activeProject.folderId = "p1";
    sessionState.sessions = [{ id: "s1", projectId: "p1", status: "active" }];
    sessionState.activeSessionId = "s1";
    peerState.peers = []; // no peers
    render(<DmPickerSheet open={true} onOpenChange={() => {}} onOpenDm={() => {}} />);
    const sheet = within(document.body).getByTestId("mobile-bottom-sheet");
    expect(within(sheet).getByText("No peers online.")).toBeTruthy();
  });

  it("opens a DM on tap: POSTs, calls addChannel + setActiveChannelId + onOpenDm", async () => {
    prefsState.activeProject.folderId = "p1";
    sessionState.sessions = [{ id: "s1", projectId: "p1", status: "active" }];
    sessionState.activeSessionId = "s1";
    peerState.peers = [
      { sessionId: "s2", name: "claude", peerSummary: null, agentProvider: "claude" },
    ];

    const fakeChannel = {
      id: "ch-dm-1",
      folderId: "p1",
      groupId: "dms",
      name: "claude",
      displayName: "claude",
      type: "dm",
      topic: null,
      isDefault: false,
      lastMessageAt: null,
      messageCount: 0,
      unreadCount: 0,
      createdAt: "2025-01-01T00:00:00Z",
    };
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ channel: fakeChannel }),
    } as Response);
    vi.stubGlobal("fetch", fetchSpy);

    const onOpenChange = vi.fn();
    const onOpenDm = vi.fn();
    render(
      <DmPickerSheet open={true} onOpenChange={onOpenChange} onOpenDm={onOpenDm} />
    );
    const row = within(document.body).getByTestId("dm-picker-sheet-row");
    fireEvent.click(row);

    await waitFor(() => {
      expect(channelState.addChannel).toHaveBeenCalledWith(fakeChannel);
    });
    expect(channelState.setActiveChannelId).toHaveBeenCalledWith("ch-dm-1");
    expect(onOpenDm).toHaveBeenCalledWith("ch-dm-1");
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/channels/dm",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("surfaces a toast.error when the POST fails (no crash)", async () => {
    prefsState.activeProject.folderId = "p1";
    sessionState.sessions = [{ id: "s1", projectId: "p1", status: "active" }];
    sessionState.activeSessionId = "s1";
    peerState.peers = [
      { sessionId: "s2", name: "claude", peerSummary: null, agentProvider: null },
    ];
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: "Boom" }),
    } as Response);
    vi.stubGlobal("fetch", fetchSpy);

    render(<DmPickerSheet open={true} onOpenChange={() => {}} onOpenDm={() => {}} />);
    const row = within(document.body).getByTestId("dm-picker-sheet-row");
    fireEvent.click(row);

    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith("Boom");
    });
    expect(channelState.addChannel).not.toHaveBeenCalled();
  });
});
