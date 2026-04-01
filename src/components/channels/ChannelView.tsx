"use client";

/**
 * ChannelView — Main channel message area.
 *
 * Shows the active channel's messages with auto-scroll, a reply thread panel,
 * and a message input bar. Follows the PeerChatRoom scroll pattern closely.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Hash, MessageSquare, Users } from "lucide-react";
import { useChannelContext } from "@/contexts/ChannelContext";
import { usePeerChatContext } from "@/contexts/PeerChatContext";
import { ChannelMessageRow } from "./ChannelMessageRow";
import { ThreadPanel } from "./ThreadPanel";
import { LoopChatInput } from "@/components/loop/LoopChatInput";

interface ChannelViewProps {
  folderId: string | null;
  folderName: string | null;
}

export function ChannelView({ folderId }: ChannelViewProps) {
  const {
    groups,
    activeChannelId,
    activeChannelMessages,
    loading,
    sendMessage,
    markChannelRead,
    openThread,
    openThreadId,
  } = useChannelContext();
  const { peers, peerNameMap } = usePeerChatContext();

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isUserScrolled, setIsUserScrolled] = useState(false);

  // Find the active channel metadata
  const activeChannel = groups
    .flatMap((g) => g.channels)
    .find((c) => c.id === activeChannelId) ?? null;

  // Auto-scroll to bottom when new messages arrive (unless user scrolled up)
  useEffect(() => {
    if (!isUserScrolled && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "instant" });
    }
  }, [activeChannelMessages, isUserScrolled]);

  // Mark channel as read when messages are visible
  useEffect(() => {
    if (!activeChannelId || activeChannelMessages.length === 0) return;
    const lastMessage = activeChannelMessages[activeChannelMessages.length - 1];
    if (lastMessage && !lastMessage.id.startsWith("opt-")) {
      markChannelRead(activeChannelId, lastMessage.id);
    }
  }, [activeChannelId, activeChannelMessages, markChannelRead]);

  const handleScroll = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const { scrollTop, scrollHeight, clientHeight } = container;
    setIsUserScrolled(scrollHeight - scrollTop - clientHeight > 50);
  }, []);

  const handleSend = useCallback(
    (text: string) => {
      setIsUserScrolled(false);
      sendMessage(text);
    },
    [sendMessage]
  );

  // No folder selected
  if (!folderId) {
    return (
      <div className="flex flex-col h-full w-full items-center justify-center text-muted-foreground/40">
        <Hash className="w-10 h-10 mb-3" />
        <p className="text-sm">Select a project folder to see channels</p>
      </div>
    );
  }

  // No channel selected
  if (!activeChannelId || !activeChannel) {
    return (
      <div className="flex flex-col h-full w-full items-center justify-center text-muted-foreground/40">
        <MessageSquare className="w-10 h-10 mb-3" />
        <p className="text-sm">Select a channel to start messaging</p>
      </div>
    );
  }

  return (
    <div className="relative flex flex-row h-full w-full bg-background overflow-hidden">
      {/* Main channel area */}
      <div className="flex flex-col flex-1 min-w-0 h-full">
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-card/50 shrink-0">
          <Hash className="w-4 h-4 text-primary shrink-0" />
          <span className="text-xs font-semibold text-foreground">
            {activeChannel.displayName || activeChannel.name}
          </span>
          {activeChannel.topic && (
            <>
              <span className="text-muted-foreground/30 text-xs">|</span>
              <span className="text-xs text-muted-foreground truncate flex-1">
                {activeChannel.topic}
              </span>
            </>
          )}
          {peers.length > 0 && (
            <span className="flex items-center gap-1 text-[10px] text-muted-foreground ml-auto shrink-0">
              <Users className="w-3 h-3" />
              {peers.length} agent{peers.length !== 1 ? "s" : ""}
            </span>
          )}
        </div>

        {/* Messages */}
        <div
          ref={containerRef}
          className="flex-1 overflow-y-auto py-3 space-y-1"
          onScroll={handleScroll}
        >
          {activeChannelMessages.length === 0 && !loading && (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground/40 px-4">
              <Hash className="w-8 h-8 mb-2" />
              <p className="text-sm font-medium">
                #{activeChannel.displayName || activeChannel.name}
              </p>
              <p className="text-xs mt-1 text-center">
                This is the beginning of the channel.
                {activeChannel.topic && ` Topic: ${activeChannel.topic}`}
              </p>
            </div>
          )}

          {activeChannelMessages.map((msg) => (
            <ChannelMessageRow
              key={msg.id}
              message={msg}
              peerNameMap={peerNameMap}
              onReplyClick={openThread}
              isThreadReply={false}
            />
          ))}

          {/* Scroll anchor */}
          <div ref={messagesEndRef} />
        </div>

        {/* Scroll to bottom button */}
        {isUserScrolled && (
          <button
            onClick={() => {
              setIsUserScrolled(false);
              messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
            }}
            className="absolute bottom-16 left-1/2 -translate-x-1/2 bg-card/90 backdrop-blur border border-border rounded-full px-3 py-1 text-xs text-muted-foreground hover:text-foreground shadow-lg transition-colors z-10"
          >
            Scroll to bottom
          </button>
        )}

        {/* Input */}
        <div className="shrink-0 border-t border-border pb-safe-bottom">
          <LoopChatInput
            onSend={handleSend}
            placeholder={`Message #${activeChannel.displayName || activeChannel.name}...`}
          />
        </div>
      </div>

      {/* Thread panel — rendered alongside when open */}
      {openThreadId && <ThreadPanel />}
    </div>
  );
}
