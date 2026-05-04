"use client";

/**
 * ChannelsTab — Phase 5 mobile redesign.
 *
 * Top-level Channels tab. Drives a two-pane router:
 *   - "list" → {@link MobileChannelList} (channel groups + unread badges)
 *   - "view" → {@link MobileChannelView} (message stream + composer)
 *
 * The thread takeover ({@link MobileThreadTakeover}) is rendered above the
 * view as a fixed full-screen layer when `openThreadId` is set in context.
 *
 * The DM creation FAB sits above the bottom tab bar (per the brief:
 * `bottom-[calc(56px+env(safe-area-inset-bottom)+16px)]`) and only shows on
 * the channel list (not while reading a channel).
 */

import { useCallback, useEffect, useState } from "react";
import { MessageSquarePlus } from "lucide-react";

import { cn } from "@/lib/utils";
import { useChannelContextOptional } from "@/contexts/ChannelContext";
import { usePreferencesContext } from "@/contexts/PreferencesContext";
import { useProjectTree } from "@/contexts/ProjectTreeContext";

import { MobileChannelList } from "./MobileChannelList";
import { MobileChannelView } from "./MobileChannelView";
import { MobileThreadTakeover } from "./MobileThreadTakeover";
import { DmPickerSheet } from "./DmPickerSheet";

type Pane = "list" | "view";

export function ChannelsTab() {
  const channels = useChannelContextOptional();
  const { activeProject } = usePreferencesContext();
  const projectTree = useProjectTree();

  const [pane, setPane] = useState<Pane>("list");
  const [dmSheetOpen, setDmSheetOpen] = useState(false);

  const projectName =
    activeProject.folderId
      ? projectTree.getProject(activeProject.folderId)?.name ?? null
      : null;

  // Pull values out as nullable so hooks below stay unconditional. The early
  // return for "no provider" comes after all hooks have run.
  const activeChannelId = channels?.activeChannelId ?? null;
  const setActiveChannelId = channels?.setActiveChannelId;
  const openThreadId = channels?.openThreadId ?? null;
  const closeThread = channels?.closeThread;

  const handleOpenChannel = useCallback(
    (channelId: string) => {
      setActiveChannelId?.(channelId);
      setPane("view");
    },
    [setActiveChannelId]
  );

  const handleBackToList = useCallback(() => {
    // Closing a thread that's still open should also collapse it so the
    // takeover doesn't reappear on the next channel-view entry.
    if (openThreadId && closeThread) closeThread();
    setPane("list");
  }, [openThreadId, closeThread]);

  const handleOpenThread = useCallback(() => {
    // ChannelView already opens the thread in context; we don't need to do
    // anything here — the takeover renders off `openThreadId`.
  }, []);

  const handleDmOpened = useCallback(() => {
    // The picker already calls setActiveChannelId; route into the view.
    setPane("view");
  }, []);

  // If the user navigates away from the tab and back, we want to keep their
  // last pane. We only force back to list if the active channel disappears
  // (e.g. archived from the desktop while we weren't looking).
  useEffect(() => {
    if (pane === "view" && !activeChannelId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- recover when active channel disappears externally
      setPane("list");
    }
  }, [pane, activeChannelId]);

  // If there's no ChannelProvider mounted (defensive — page.tsx mounts it),
  // render a calm empty state. This keeps the tab usable in tests and in
  // edge-case routes where channels haven't loaded yet. All hooks above
  // already ran so the order stays stable across renders.
  if (!channels || !closeThread) {
    return (
      <div
        data-testid="mobile-channels-no-provider"
        className="flex h-full flex-col items-center justify-center gap-2 px-6 py-12 text-center"
      >
        <p className="text-base font-medium text-foreground">Channels unavailable.</p>
        <p className="text-sm text-muted-foreground">
          Pick a project from the Sessions tab to load channels.
        </p>
      </div>
    );
  }

  return (
    <div className="relative flex h-full flex-col" data-testid="mobile-channels-tab">
      {pane === "list" ? (
        <>
          <header className="border-b border-border bg-card px-3 py-2">
            <h2 className="text-sm font-medium text-foreground">
              Channels{projectName ? ` · ${projectName}` : ""}
            </h2>
          </header>
          <div className="flex-1 overflow-y-auto overscroll-contain">
            <MobileChannelList onOpen={handleOpenChannel} projectName={projectName} />
          </div>
          {/* DM creation FAB. Sits above the 56pt bottom tab bar + safe area. */}
          <button
            type="button"
            onClick={() => setDmSheetOpen(true)}
            aria-label="New direct message"
            data-testid="mobile-channels-dm-fab"
            className={cn(
              "fixed right-4 z-30",
              // Anchored above the tab bar (56) + safe area + 16px breathing room.
              "bottom-[calc(56px+env(safe-area-inset-bottom)+16px)]",
              "inline-flex h-12 w-12 items-center justify-center rounded-full",
              // Achromatic primary, no neon. Per Achromatic-Default Rule.
              "bg-foreground text-background shadow-lg",
              "hover:bg-foreground/90 active:bg-foreground/80",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            )}
          >
            <MessageSquarePlus aria-hidden="true" className="h-5 w-5" />
          </button>
        </>
      ) : (
        <MobileChannelView onBack={handleBackToList} onOpenThread={handleOpenThread} />
      )}

      {/* Thread takeover layer — full-screen, rendered when a thread is open. */}
      <MobileThreadTakeover open={!!openThreadId} onClose={closeThread} />

      {/* DM picker bottom sheet */}
      <DmPickerSheet
        open={dmSheetOpen}
        onOpenChange={setDmSheetOpen}
        onOpenDm={handleDmOpened}
      />
    </div>
  );
}
