"use client";

/**
 * DmPickerSheet — Phase 5 mobile redesign.
 *
 * BottomSheet that lists project peers (active agent sessions) and lets the
 * user open a direct-message channel with one. DM creation in Remote Dev is
 * inherently between two sessions in the same project, so the sheet picks:
 *   - target: the peer the user taps
 *   - from:   the user's currently-active session, if it lives in the same
 *             project as the target
 *
 * If no eligible "from" session exists in the active project, the sheet
 * surfaces a single, calm explanation row instead of an actionable list.
 * Per DESIGN.md "Trust the Expert" we don't lecture — just say what's
 * needed.
 */

import { useCallback, useMemo, useState } from "react";
import { Bot, MessageSquarePlus } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { useChannelContext } from "@/contexts/ChannelContext";
import { usePeerChatContext } from "@/contexts/PeerChatContext";
import { useSessionContext } from "@/contexts/SessionContext";
import { usePreferencesContext } from "@/contexts/PreferencesContext";
import type { Channel } from "@/types/channels";

import { BottomSheet } from "../common/BottomSheet";

export interface DmPickerSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Fired with the resolved channel id once the DM has been opened. */
  onOpenDm: (channelId: string) => void;
}

export function DmPickerSheet({ open, onOpenChange, onOpenDm }: DmPickerSheetProps) {
  const { activeProject } = usePreferencesContext();
  const projectId = activeProject.folderId;
  const { peers } = usePeerChatContext();
  const { sessions, activeSessionId } = useSessionContext();
  const { setActiveChannelId, addChannel } = useChannelContext();

  const [pendingTargetId, setPendingTargetId] = useState<string | null>(null);

  // Find the user's "from" session: prefer the active session if it's in this
  // project, otherwise the first session in the project.
  const fromSessionId = useMemo<string | null>(() => {
    if (!projectId) return null;
    const inProject = sessions.filter((s) => s.projectId === projectId && s.status !== "closed");
    if (inProject.length === 0) return null;
    const active = inProject.find((s) => s.id === activeSessionId);
    if (active) return active.id;
    return inProject[0].id;
  }, [sessions, activeSessionId, projectId]);

  // Filter peers down to those that aren't the user's own from-session.
  const eligiblePeers = useMemo(
    () => peers.filter((p) => p.sessionId !== fromSessionId),
    [peers, fromSessionId]
  );

  const handlePick = useCallback(
    async (targetSessionId: string) => {
      if (!projectId || !fromSessionId) return;
      setPendingTargetId(targetSessionId);
      try {
        const resp = await fetch("/api/channels/dm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId,
            targetSessionId,
            fromSessionId,
          }),
        });
        if (!resp.ok) {
          const data = (await resp.json().catch(() => ({}))) as { error?: string };
          throw new Error(data.error ?? "Failed to open DM");
        }
        const data = (await resp.json()) as { channel: Channel };
        // Make the channel show up immediately in the list & become active.
        addChannel(data.channel);
        setActiveChannelId(data.channel.id);
        onOpenChange(false);
        onOpenDm(data.channel.id);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to open DM");
      } finally {
        setPendingTargetId(null);
      }
    },
    [projectId, fromSessionId, addChannel, setActiveChannelId, onOpenChange, onOpenDm]
  );

  const sheetTitle = "Direct message";

  // Three states: no project, no from-session, peer list.
  return (
    <BottomSheet open={open} onOpenChange={onOpenChange} title={sheetTitle}>
      {!projectId ? (
        <DmEmpty
          headline="Pick a project first."
          body="Direct messages are scoped to a project. Choose one from the Sessions tab."
        />
      ) : !fromSessionId ? (
        <DmEmpty
          headline="Open a session in this project first."
          body="DMs always have a from-session. Start any session in this project, then come back."
        />
      ) : eligiblePeers.length === 0 ? (
        <DmEmpty
          headline="No peers online."
          body="Direct messages are between two agents in the same project. When another agent comes online here it will show up."
        />
      ) : (
        <ul role="list" className="px-2 py-1" data-testid="dm-picker-sheet-items">
          {eligiblePeers.map((peer) => {
            const pending = pendingTargetId === peer.sessionId;
            return (
              <li key={peer.sessionId}>
                <button
                  type="button"
                  onClick={() => handlePick(peer.sessionId)}
                  disabled={pending}
                  data-testid="dm-picker-sheet-row"
                  data-session-id={peer.sessionId}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-md px-3",
                    "min-h-[44px] py-2.5 text-left",
                    "transition-colors",
                    "hover:bg-accent/40 active:bg-accent/60",
                    pending && "opacity-60"
                  )}
                >
                  <span
                    aria-hidden="true"
                    className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted"
                  >
                    <Bot className="h-3.5 w-3.5 text-muted-foreground" />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-medium text-foreground">
                      {peer.name}
                    </span>
                    {peer.peerSummary ? (
                      <span className="truncate text-xs text-muted-foreground">
                        {peer.peerSummary}
                      </span>
                    ) : peer.agentProvider ? (
                      <span className="truncate text-xs text-muted-foreground">
                        {peer.agentProvider}
                      </span>
                    ) : null}
                  </span>
                  {pending ? (
                    <span className="text-[11px] text-muted-foreground">Opening…</span>
                  ) : (
                    <MessageSquarePlus
                      aria-hidden="true"
                      className="h-4 w-4 text-muted-foreground"
                    />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </BottomSheet>
  );
}

function DmEmpty({ headline, body }: { headline: string; body: string }) {
  return (
    <div className="flex flex-col items-start gap-1 px-4 py-4 text-left">
      <p className="text-sm font-medium text-foreground">{headline}</p>
      <p className="text-xs text-muted-foreground">{body}</p>
    </div>
  );
}
