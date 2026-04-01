"use client";

/**
 * ThreadPanel — Slide-in panel for thread replies.
 *
 * Fixed 320px width panel showing the parent message and its thread replies.
 * Auto-scrolls to the bottom on new replies.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { X, MessageSquare } from "lucide-react";
import { useChannelContext } from "@/contexts/ChannelContext";
import { usePeerChatContext } from "@/contexts/PeerChatContext";
import { ChannelMessageRow } from "./ChannelMessageRow";
import { LoopChatInput } from "@/components/loop/LoopChatInput";

export function ThreadPanel() {
  const {
    activeChannelMessages,
    openThreadId,
    closeThread,
    threadMessages,
    sendMessage,
  } = useChannelContext();
  const { peerNameMap } = usePeerChatContext();

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isUserScrolled, setIsUserScrolled] = useState(false);

  // Find parent message from active channel messages
  const parentMessage = openThreadId
    ? activeChannelMessages.find((m) => m.id === openThreadId) ?? null
    : null;

  // Auto-scroll when thread messages change
  useEffect(() => {
    if (!isUserScrolled && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "instant" });
    }
  }, [threadMessages, isUserScrolled]);

  const handleScroll = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const { scrollTop, scrollHeight, clientHeight } = container;
    setIsUserScrolled(scrollHeight - scrollTop - clientHeight > 50);
  }, []);

  const handleSend = useCallback(
    (text: string) => {
      if (!openThreadId) return;
      setIsUserScrolled(false);
      sendMessage(text, openThreadId);
    },
    [openThreadId, sendMessage]
  );

  if (!openThreadId) return null;

  return (
    <div className="flex flex-col w-80 shrink-0 h-full border-l border-border bg-card/30 backdrop-blur-sm">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-card/50 shrink-0">
        <MessageSquare className="w-4 h-4 text-primary shrink-0" />
        <span className="text-xs font-semibold text-foreground flex-1">
          Thread
        </span>
        <button
          onClick={closeThread}
          className="text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Close thread"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Scrollable content */}
      <div
        ref={containerRef}
        className="flex-1 overflow-y-auto py-2"
        onScroll={handleScroll}
      >
        {/* Parent message */}
        {parentMessage && (
          <>
            <ChannelMessageRow
              message={parentMessage}
              peerNameMap={peerNameMap}
              isThreadReply={false}
            />
            {/* Divider */}
            <div className="flex items-center gap-2 px-4 my-2">
              <div className="flex-1 border-t border-border" />
              <span className="text-[10px] text-muted-foreground shrink-0">
                {threadMessages.length}{" "}
                {threadMessages.length === 1 ? "reply" : "replies"}
              </span>
              <div className="flex-1 border-t border-border" />
            </div>
          </>
        )}

        {/* Thread replies */}
        {threadMessages.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-muted-foreground/40 px-4">
            <MessageSquare className="w-6 h-6 mb-2" />
            <p className="text-xs text-center">
              No replies yet. Be the first to reply!
            </p>
          </div>
        ) : (
          <div className="space-y-1">
            {threadMessages.map((msg) => (
              <ChannelMessageRow
                key={msg.id}
                message={msg}
                peerNameMap={peerNameMap}
                isThreadReply={true}
              />
            ))}
          </div>
        )}

        {/* Scroll anchor */}
        <div ref={messagesEndRef} />
      </div>

      {/* Scroll to bottom */}
      {isUserScrolled && (
        <button
          onClick={() => {
            setIsUserScrolled(false);
            messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
          }}
          className="mx-3 mb-1 bg-card/90 backdrop-blur border border-border rounded-full px-3 py-1 text-xs text-muted-foreground hover:text-foreground shadow-lg transition-colors"
        >
          Scroll to bottom
        </button>
      )}

      {/* Reply input */}
      <div className="shrink-0 border-t border-border">
        <LoopChatInput
          onSend={handleSend}
          placeholder="Reply in thread..."
        />
      </div>
    </div>
  );
}
