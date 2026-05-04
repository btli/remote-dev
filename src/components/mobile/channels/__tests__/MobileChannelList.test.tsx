/**
 * MobileChannelList tests (Phase 5 mobile redesign).
 *
 * Verifies channel groups render, unread badges show counts, and tapping a
 * row both selects the channel in context and fires onOpen.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

import type { ChannelGroup } from "@/types/channels";

import { MobileChannelList } from "../MobileChannelList";

const setActiveChannelId = vi.fn();

const baseChannel = (
  over: Partial<ChannelGroup["channels"][number]> = {}
): ChannelGroup["channels"][number] => ({
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

vi.mock("@/contexts/ChannelContext", () => ({
  useChannelContext: () => ({
    groups: [
      {
        id: "g1",
        folderId: "p1",
        name: "Channels",
        position: 0,
        channels: [
          baseChannel({ id: "c1", displayName: "general", topic: "team chat" }),
          baseChannel({ id: "c2", displayName: "alerts", unreadCount: 3 }),
        ],
      },
      {
        id: "g2",
        folderId: "p1",
        name: "Direct Messages",
        position: 1,
        channels: [
          baseChannel({ id: "dm1", displayName: "claude", type: "dm", unreadCount: 105 }),
        ],
      },
    ],
    activeChannelId: "c1",
    setActiveChannelId,
    loading: false,
  }),
}));

afterEach(() => {
  cleanup();
  setActiveChannelId.mockReset();
});

describe("MobileChannelList", () => {
  it("renders all groups with their channel rows", () => {
    render(<MobileChannelList onOpen={() => {}} />);
    expect(screen.getByText("Channels")).toBeTruthy();
    expect(screen.getByText("Direct Messages")).toBeTruthy();
    expect(screen.getByText("general")).toBeTruthy();
    expect(screen.getByText("alerts")).toBeTruthy();
    expect(screen.getByText("claude")).toBeTruthy();
  });

  it("renders unread badges with correct counts", () => {
    render(<MobileChannelList onOpen={() => {}} />);
    const badges = screen.getAllByTestId("mobile-channel-row-unread");
    // Two channels have unread > 0.
    expect(badges).toHaveLength(2);
    // Counts: 3 and 99+ (capped).
    expect(badges.map((b) => b.textContent)).toEqual(["3", "99+"]);
  });

  it("does not render a badge for channels with 0 unread", () => {
    render(<MobileChannelList onOpen={() => {}} />);
    const generalRow = screen
      .getAllByTestId("mobile-channel-row")
      .find((el) => el.getAttribute("data-channel-id") === "c1");
    expect(generalRow).toBeTruthy();
    expect(
      generalRow!.querySelector('[data-testid="mobile-channel-row-unread"]')
    ).toBeNull();
  });

  it("calls setActiveChannelId and onOpen when a row is tapped", () => {
    const onOpen = vi.fn();
    render(<MobileChannelList onOpen={onOpen} />);
    const row = screen
      .getAllByTestId("mobile-channel-row")
      .find((el) => el.getAttribute("data-channel-id") === "c2");
    fireEvent.click(row!);
    expect(setActiveChannelId).toHaveBeenCalledWith("c2");
    expect(onOpen).toHaveBeenCalledWith("c2");
  });

  it("marks the active channel with aria-current=page", () => {
    render(<MobileChannelList onOpen={() => {}} />);
    const active = screen
      .getAllByTestId("mobile-channel-row")
      .find((el) => el.getAttribute("data-channel-id") === "c1");
    expect(active!.getAttribute("aria-current")).toBe("page");
  });
});
