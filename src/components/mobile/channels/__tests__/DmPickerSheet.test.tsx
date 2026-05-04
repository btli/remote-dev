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
  refreshChannels: vi.fn().mockResolvedValue(undefined),
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
  channelState.refreshChannels.mockReset();
  channelState.refreshChannels.mockResolvedValue(undefined);
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

  it("opens a DM on tap: POSTs, refreshChannels + setActiveChannelId + onOpenDm", async () => {
    prefsState.activeProject.folderId = "p1";
    sessionState.sessions = [{ id: "s1", projectId: "p1", status: "active" }];
    sessionState.activeSessionId = "s1";
    peerState.peers = [
      { sessionId: "s2", name: "claude", peerSummary: null, agentProvider: "claude" },
    ];

    // The /api/channels/dm endpoint returns the raw DB row — missing
    // unreadCount + folderId. The picker must NOT pipe that into addChannel
    // (which would render NaN unread totals); instead it refetches the
    // normalized channel list via refreshChannels.
    const dbRow = {
      id: "ch-dm-1",
      projectId: "p1",
      groupId: "dms",
      name: "claude",
      displayName: "claude",
      type: "dm",
    };
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ channel: dbRow }),
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
      expect(channelState.refreshChannels).toHaveBeenCalledTimes(1);
    });
    // addChannel must NOT be called with the unnormalized row.
    expect(channelState.addChannel).not.toHaveBeenCalled();
    expect(channelState.setActiveChannelId).toHaveBeenCalledWith("ch-dm-1");
    expect(onOpenDm).toHaveBeenCalledWith("ch-dm-1");
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/channels/dm",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("aborts the in-flight POST when the sheet closes mid-request", async () => {
    prefsState.activeProject.folderId = "p1";
    sessionState.sessions = [{ id: "s1", projectId: "p1", status: "active" }];
    sessionState.activeSessionId = "s1";
    peerState.peers = [
      { sessionId: "s2", name: "claude", peerSummary: null, agentProvider: "claude" },
    ];

    let abortedSignal: AbortSignal | null = null;
    // Resolve only after we observe an abort, so we exercise the cancel
    // path without racing a fast resolution.
    const fetchSpy = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      abortedSignal = init.signal ?? null;
      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () =>
          reject(
            typeof DOMException !== "undefined"
              ? new DOMException("Aborted", "AbortError")
              : new Error("Aborted")
          )
        );
      });
    });
    vi.stubGlobal("fetch", fetchSpy);

    const onOpenChange = vi.fn();
    const onOpenDm = vi.fn();
    const { rerender } = render(
      <DmPickerSheet open={true} onOpenChange={onOpenChange} onOpenDm={onOpenDm} />
    );
    const row = within(document.body).getByTestId("dm-picker-sheet-row");
    fireEvent.click(row);
    // Close the sheet before the fetch resolves.
    rerender(
      <DmPickerSheet open={false} onOpenChange={onOpenChange} onOpenDm={onOpenDm} />
    );

    await waitFor(() => {
      expect(abortedSignal?.aborted).toBe(true);
    });
    // Even after the rejection settles, no channel state should have
    // been mutated and onOpenDm should NOT fire.
    await new Promise((r) => setTimeout(r, 0));
    expect(channelState.refreshChannels).not.toHaveBeenCalled();
    expect(channelState.setActiveChannelId).not.toHaveBeenCalled();
    expect(onOpenDm).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
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
