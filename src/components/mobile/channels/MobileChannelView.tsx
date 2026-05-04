"use client";

/**
 * MobileChannelView — Phase 5 mobile redesign.
 *
 * Full-bleed channel message stream for the active channel, with a top
 * header (back chevron + channel name + topic) and the autocorrect-ON
 * {@link MobileChannelComposer} pinned at the bottom.
 *
 * Reuses the existing GFM-rendering {@link ChannelMessageRow} so we don't
 * duplicate markdown logic. Tapping a message's reply chip opens the thread
 * via `onOpenThread(messageId)` — the parent owns the takeover layer.
 *
 * Behaviour notes:
 *  - Auto-scrolls to bottom on new messages unless the user scrolled up.
 *  - Marks the channel read when the latest message is visible.
 *  - When there are no messages, the header + composer are still shown
 *    (per the brief: "empty channel = composer-only, no greeter"), with a
 *    very small inline whisper of context. We deliberately do not paint a
 *    big illustrated empty state.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, Copy, Hash, Lock, MessageSquare } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { useChannelContext } from "@/contexts/ChannelContext";
import { usePeerChatContext } from "@/contexts/PeerChatContext";
import { ChannelMessageRow } from "@/components/channels/ChannelMessageRow";
import type { ChannelMessage } from "@/types/channels";

import { MobileChannelComposer } from "./MobileChannelComposer";
import { ActionSheet } from "../common/ActionSheet";
import { useLongPress } from "../sessions/useSwipeAction";

const SCROLL_THRESHOLD_PX = 50;

export interface MobileChannelViewProps {
  /** Called when the user taps the back chevron in the header. */
  onBack: () => void;
  /** Called when the user taps a reply chip (or "n replies" in a thread). */
  onOpenThread: (messageId: string) => void;
}

export function MobileChannelView({ onBack, onOpenThread }: MobileChannelViewProps) {
  const {
    groups,
    activeChannelId,
    activeChannelMessages,
    sendMessage,
    markChannelRead,
    openThread,
  } = useChannelContext();
  const { peerNameMap } = usePeerChatContext();

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isUserScrolled, setIsUserScrolled] = useState(false);
  // Long-press surfaces an ActionSheet ("Reply in thread", "Copy") since
  // ChannelMessageRow's hover-only reply chip is unreachable on touch
  // devices. We track the target message rather than just its id so the
  // sheet can offer message-aware actions (Copy uses the body).
  const [actionMessage, setActionMessage] = useState<ChannelMessage | null>(null);

  const activeChannel = useMemo(
    () =>
      groups
        .flatMap((g) => g.channels)
        .find((c) => c.id === activeChannelId) ?? null,
    [groups, activeChannelId]
  );

  // Auto-scroll on new messages unless the user scrolled up.
  useEffect(() => {
    if (!isUserScrolled) {
      messagesEndRef.current?.scrollIntoView({ behavior: "instant" });
    }
  }, [activeChannelMessages, isUserScrolled]);

  // Mark the channel read when we see new messages and we're not viewing
  // an optimistic placeholder. Mirrors ChannelView's behaviour. Gated on a
  // ref tracking the last-marked id so unrelated context updates (which
  // produce a new `activeChannelMessages` reference but the same trailing
  // message) don't refire the request on every render.
  const lastMarkedRef = useRef<string | null>(null);
  useEffect(() => {
    // Reset the tracker when the user switches channels so the new channel
    // gets its first read mark even if the message id happens to collide.
    lastMarkedRef.current = null;
  }, [activeChannelId]);
  useEffect(() => {
    if (!activeChannelId || activeChannelMessages.length === 0) return;
    const last = activeChannelMessages[activeChannelMessages.length - 1];
    if (
      last &&
      !last.id.startsWith("opt-") &&
      last.id !== lastMarkedRef.current
    ) {
      lastMarkedRef.current = last.id;
      void markChannelRead(activeChannelId, last.id);
    }
  }, [activeChannelId, activeChannelMessages, markChannelRead]);

  const handleScroll = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const { scrollTop, scrollHeight, clientHeight } = container;
    setIsUserScrolled(scrollHeight - scrollTop - clientHeight > SCROLL_THRESHOLD_PX);
  }, []);

  const handleSend = useCallback(
    async (text: string) => {
      setIsUserScrolled(false);
      const result = await sendMessage(text);
      // Reject so the composer can restore the user's draft + toast.
      if (!result.ok) {
        throw result.error instanceof Error
          ? result.error
          : new Error("Failed to send");
      }
    },
    [sendMessage]
  );

  const handleReplyClick = useCallback(
    (messageId: string) => {
      // Open in the context too so the takeover sees the thread loaded.
      void openThread(messageId);
      onOpenThread(messageId);
    },
    [openThread, onOpenThread]
  );

  const handleLongPressMessage = useCallback((message: ChannelMessage) => {
    setActionMessage(message);
  }, []);

  const handleCopyMessage = useCallback(async () => {
    const body = actionMessage?.body;
    if (!body) return;
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(body);
      }
    } catch {
      // Clipboard access can fail on insecure contexts; surface a toast
      // rather than silently swallow.
      toast.error("Couldn't copy to clipboard");
    }
  }, [actionMessage]);

  const handleReplyFromAction = useCallback(() => {
    if (!actionMessage) return;
    handleReplyClick(actionMessage.id);
  }, [actionMessage, handleReplyClick]);

  if (!activeChannel) {
    // Defensive: parent shouldn't render us without an active channel, but if
    // it happens we render a minimal back-only screen rather than crash.
    return (
      <div className="flex h-full flex-col">
        <header className="flex items-center gap-1 border-b border-border bg-card px-1 py-2">
          <BackButton onBack={onBack} />
          <span className="px-1 text-sm font-medium text-foreground">Channel</span>
        </header>
        <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-muted-foreground">
          Channel unavailable.
        </div>
      </div>
    );
  }

  const Icon = activeChannel.type === "dm" ? Lock : Hash;
  const display = activeChannel.displayName || activeChannel.name;

  return (
    <div className="flex h-full flex-col" data-testid="mobile-channel-view">
      <header className="flex items-center gap-1 border-b border-border bg-card px-1 py-2">
        <BackButton onBack={onBack} />
        <div className="flex min-w-0 flex-1 items-center gap-2 px-1">
          <Icon aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span
            className="truncate text-sm font-medium text-foreground"
            data-testid="mobile-channel-view-title"
          >
            {display}
          </span>
          {activeChannel.topic ? (
            <>
              <span aria-hidden="true" className="text-muted-foreground/40">
                ·
              </span>
              <span className="truncate text-xs text-muted-foreground">
                {activeChannel.topic}
              </span>
            </>
          ) : null}
        </div>
      </header>

      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto overscroll-contain py-2"
        data-testid="mobile-channel-view-stream"
      >
        {activeChannelMessages.map((msg) => (
          <LongPressMessage
            key={msg.id}
            message={msg}
            onLongPress={handleLongPressMessage}
          >
            <ChannelMessageRow
              message={msg}
              peerNameMap={peerNameMap}
              onReplyClick={handleReplyClick}
              isThreadReply={false}
            />
          </LongPressMessage>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {isUserScrolled ? (
        <button
          type="button"
          onClick={() => {
            setIsUserScrolled(false);
            messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
          }}
          className={cn(
            "mx-auto mb-1 inline-flex items-center justify-center rounded-full",
            "border border-border bg-card px-3 py-1 text-xs text-muted-foreground",
            "shadow-sm hover:text-foreground"
          )}
        >
          Jump to latest
        </button>
      ) : null}

      <div className="pb-safe-bottom">
        <MobileChannelComposer
          onSubmit={handleSend}
          placeholder={`Message ${display}`}
        />
      </div>

      <ActionSheet
        open={actionMessage != null}
        onOpenChange={(open) => {
          if (!open) setActionMessage(null);
        }}
        title="Message actions"
        items={[
          {
            id: "reply",
            label: "Reply in thread",
            icon: <MessageSquare className="h-4 w-4" />,
            onSelect: handleReplyFromAction,
          },
          {
            id: "copy",
            label: "Copy message",
            icon: <Copy className="h-4 w-4" />,
            onSelect: handleCopyMessage,
          },
        ]}
      />
    </div>
  );
}

/**
 * Wrap a message row in a long-press surface so touch users can open the
 * message-actions sheet without relying on the hover-only Reply chip baked
 * into {@link ChannelMessageRow}. We use a <div> shell so the press doesn't
 * interfere with markdown links / code blocks inside the row — those still
 * receive their own click events.
 */
function LongPressMessage({
  message,
  onLongPress,
  children,
}: {
  message: ChannelMessage;
  onLongPress: (message: ChannelMessage) => void;
  children: ReactNode;
}) {
  const longPress = useLongPress({
    duration: 450,
    onLongPress: () => onLongPress(message),
  });
  return (
    <div data-testid="mobile-channel-message-wrap" {...longPress.bind}>
      {children}
    </div>
  );
}

function BackButton({ onBack }: { onBack: () => void }) {
  return (
    <button
      type="button"
      onClick={onBack}
      aria-label="Back to channels"
      data-testid="mobile-channel-back"
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-2",
        "min-h-[44px] min-w-[44px] text-sm font-medium text-foreground",
        "hover:bg-accent/40 active:bg-accent/60",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      )}
    >
      <ChevronLeft aria-hidden="true" className="h-5 w-5" />
    </button>
  );
}
