"use client";

/**
 * MobileThreadTakeover — full-screen slide-in-from-right thread panel.
 *
 * Phase 5 mobile redesign. Replaces the desktop {@link ThreadPanel}'s
 * 320-wide side panel with a full-screen takeover that animates in over
 * the channel view (`translateX(100%) → 0`) and dismisses with either the
 * back chevron or a swipe-from-the-left-edge.
 *
 * The component reuses {@link ChannelMessageRow} for the parent + replies
 * (no GFM duplication) and {@link MobileChannelComposer} for the reply
 * composer (autocorrect ON).
 *
 * `position: fixed`, z-50; sits above the channel view but below the bottom
 * tab bar so global navigation stays reachable. Reduced motion = instant.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, MessageSquare } from "lucide-react";

import { cn } from "@/lib/utils";
import { usePrefersReducedMotion } from "@/hooks/useMobile";
import { useChannelContext } from "@/contexts/ChannelContext";
import { usePeerChatContext } from "@/contexts/PeerChatContext";
import { ChannelMessageRow } from "@/components/channels/ChannelMessageRow";

import { useDialogPolish } from "../common/useDialogPolish";
import { MobileChannelComposer } from "./MobileChannelComposer";
import { useThreadTakeoverSwipe } from "./useThreadTakeoverSwipe";

const TAKEOVER_DURATION_MS = 240;
const TAKEOVER_EASING = "cubic-bezier(0.32, 0.72, 0, 1)";

export interface MobileThreadTakeoverProps {
  /** Externally controlled. The takeover renders only while this is true. */
  open: boolean;
  /** Fires when the user requests dismissal (back chevron or swipe). */
  onClose: () => void;
}

export function MobileThreadTakeover({ open, onClose }: MobileThreadTakeoverProps) {
  const reducedMotion = usePrefersReducedMotion();
  const {
    activeChannelMessages,
    openThreadId,
    threadMessages,
    sendMessage,
  } = useChannelContext();
  const { peerNameMap } = usePeerChatContext();

  const containerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Two-phase mount so the slide-in/out transitions both play.
  const [mounted, setMounted] = useState(false);
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- two-phase mount/transition state machine
      setMounted(true);
      const id = requestAnimationFrame(() => setEntered(true));
      return () => cancelAnimationFrame(id);
    }
    if (!mounted) return;
    setEntered(false);
    if (reducedMotion) {
      setMounted(false);
      return;
    }
    const t = window.setTimeout(() => setMounted(false), TAKEOVER_DURATION_MS);
    return () => window.clearTimeout(t);
  }, [open, mounted, reducedMotion]);

  // ESC closes — handy for desktop testing and for users with hardware keyboards.
  useEffect(() => {
    if (!entered) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [entered, onClose]);

  // Focus trap + body scroll lock — WCAG / aria-modal compliance. Refcounts
  // on `document.body.dataset.scrollLockCount` so concurrent BottomSheets
  // and this takeover don't clobber each other's lock.
  useDialogPolish({ active: entered, panelRef: containerRef });

  // Resolve the parent message from the active channel.
  const parentMessage = useMemo(
    () =>
      openThreadId
        ? activeChannelMessages.find((m) => m.id === openThreadId) ?? null
        : null,
    [openThreadId, activeChannelMessages]
  );

  // Auto-scroll to bottom only when a NEW reply arrives. Without the length
  // gate, every unrelated context update (e.g. peer summary refresh) would
  // produce a new `threadMessages` array reference and snap the user back
  // to the bottom while they're reading earlier replies.
  const prevLengthRef = useRef(0);
  useEffect(() => {
    if (!entered) {
      prevLengthRef.current = 0;
      return;
    }
    if (threadMessages.length > prevLengthRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: "instant" });
    }
    prevLengthRef.current = threadMessages.length;
  }, [entered, threadMessages]);

  // When the takeover targets a different parent message, treat it as a
  // fresh thread and reset the length tracker so the first paint scrolls
  // to bottom again.
  useEffect(() => {
    prevLengthRef.current = 0;
  }, [openThreadId]);

  const handleSend = useCallback(
    async (text: string) => {
      if (!openThreadId) return;
      await sendMessage(text, openThreadId);
    },
    [openThreadId, sendMessage]
  );

  // Swipe-from-left-edge back gesture.
  const swipe = useThreadTakeoverSwipe({
    enabled: entered,
    onDismiss: onClose,
  });

  if (!mounted) return null;

  // The live transform: while dragging, follow the finger 1:1; otherwise the
  // transition handles enter/exit.
  const dragging = swipe.dragging;
  const transform = dragging
    ? `translate3d(${swipe.dragOffsetPx}px, 0, 0)`
    : entered
      ? "translate3d(0, 0, 0)"
      : "translate3d(100%, 0, 0)";

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-modal="true"
      aria-label={parentMessage ? "Thread replies" : "Thread"}
      data-testid="mobile-thread-takeover"
      data-state={entered ? "open" : "closed"}
      className={cn(
        // Full-screen above the channel view but below the bottom tab bar.
        "fixed inset-0 z-40 flex flex-col bg-background text-foreground",
        "pt-safe-top",
        "will-change-transform"
      )}
      style={{
        transform,
        transitionProperty: dragging ? "none" : "transform",
        transitionDuration: reducedMotion || dragging ? "0ms" : `${TAKEOVER_DURATION_MS}ms`,
        transitionTimingFunction: reducedMotion ? "linear" : TAKEOVER_EASING,
      }}
      // Bind the back gesture on the outer container so any horizontal swipe
      // starting in the left 24px is intercepted.
      onTouchStart={swipe.bind.onTouchStart}
      onTouchMove={swipe.bind.onTouchMove}
      onTouchEnd={swipe.bind.onTouchEnd}
      onTouchCancel={swipe.bind.onTouchCancel}
    >
      {/* Header */}
      <header className="flex items-center gap-1 border-b border-border bg-card px-1 py-2">
        <button
          type="button"
          onClick={onClose}
          aria-label="Back to channel"
          data-testid="mobile-thread-back"
          className={cn(
            "inline-flex items-center gap-1 rounded-md px-2",
            "min-h-[44px] min-w-[44px] text-sm font-medium text-foreground",
            "hover:bg-accent/40 active:bg-accent/60",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          )}
        >
          <ChevronLeft aria-hidden="true" className="h-5 w-5" />
          <span className="sr-only sm:not-sr-only">Back</span>
        </button>
        <div className="flex flex-1 items-center gap-2 px-1">
          <MessageSquare aria-hidden="true" className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium text-foreground">Thread</span>
          {threadMessages.length > 0 ? (
            <span className="ml-auto text-xs text-muted-foreground">
              {threadMessages.length}{" "}
              {threadMessages.length === 1 ? "reply" : "replies"}
            </span>
          ) : null}
        </div>
      </header>

      {/* Scroll region: parent + divider + replies */}
      <div className="flex-1 overflow-y-auto overscroll-contain">
        {parentMessage ? (
          <>
            <ChannelMessageRow
              message={parentMessage}
              peerNameMap={peerNameMap}
              isThreadReply={false}
            />
            <div className="my-2 flex items-center gap-2 px-4">
              <div className="flex-1 border-t border-border" />
              <span className="shrink-0 text-[10px] text-muted-foreground">
                {threadMessages.length === 0
                  ? "No replies yet"
                  : `${threadMessages.length} ${threadMessages.length === 1 ? "reply" : "replies"}`}
              </span>
              <div className="flex-1 border-t border-border" />
            </div>
          </>
        ) : (
          <div className="flex h-full flex-col items-center justify-center px-6 py-12 text-center text-muted-foreground">
            <MessageSquare aria-hidden="true" className="mb-2 h-6 w-6" />
            <p className="text-sm">Thread is no longer available.</p>
          </div>
        )}

        {parentMessage && threadMessages.length === 0 ? (
          <p
            data-testid="mobile-thread-empty"
            className="px-6 pb-4 text-center text-xs text-muted-foreground"
          >
            Be the first to reply.
          </p>
        ) : null}

        {threadMessages.map((msg) => (
          <ChannelMessageRow
            key={msg.id}
            message={msg}
            peerNameMap={peerNameMap}
            isThreadReply
          />
        ))}

        <div ref={messagesEndRef} />
      </div>

      {/* Reply composer */}
      <div className="pb-safe-bottom">
        <MobileChannelComposer
          onSubmit={handleSend}
          placeholder="Reply in thread"
          disabled={!parentMessage}
        />
      </div>
    </div>
  );
}
