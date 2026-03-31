"use client";

/**
 * PeerChatRoom — Folder-scoped chat room showing all agent peer messages.
 *
 * Renders the full conversation with auto-scroll, message bubbles,
 * and a chat input bar for the user to send broadcast messages.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { MessageSquare, Users } from "lucide-react";
import { usePeerChatContext } from "@/contexts/PeerChatContext";
import { PeerMessageBubble } from "./PeerMessageBubble";
import { LoopChatInput } from "@/components/loop/LoopChatInput";

interface PeerChatRoomProps {
  folderId: string | null;
  folderName: string | null;
}

export function PeerChatRoom({ folderId, folderName }: PeerChatRoomProps) {
  const { messages, peers, peerNameMap, loading, sendMessage, markAllRead } = usePeerChatContext();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isUserScrolled, setIsUserScrolled] = useState(false);

  useEffect(() => {
    markAllRead();
  }, [markAllRead]);

  useEffect(() => {
    if (!isUserScrolled && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "instant" });
    }
  }, [messages, isUserScrolled]);

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

  if (!folderId) {
    return (
      <div className="flex flex-col h-full w-full items-center justify-center text-muted-foreground/40">
        <MessageSquare className="w-10 h-10 mb-3" />
        <p className="text-sm">Select a project folder to see peer messages</p>
      </div>
    );
  }

  return (
    <div className="relative flex flex-col h-full w-full bg-background">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-card/50">
        <MessageSquare className="w-4 h-4 text-primary" />
        <span className="text-xs font-semibold text-foreground">
          {folderName ?? "Chat Room"}
        </span>
        {peers.length > 0 && (
          <span className="flex items-center gap-1 text-[10px] text-muted-foreground ml-auto">
            <Users className="w-3 h-3" />
            {peers.length} agent{peers.length !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {/* Messages */}
      <div
        ref={containerRef}
        className="flex-1 overflow-y-auto px-3 py-3 space-y-3"
        onScroll={handleScroll}
      >
        {messages.length === 0 && !loading && (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground/40">
            <MessageSquare className="w-8 h-8 mb-2" />
            <p className="text-sm">No messages yet</p>
            <p className="text-xs mt-1">
              Agent messages will appear here. Send a message to broadcast to all agents.
            </p>
          </div>
        )}

        {messages.map((msg) => (
          <PeerMessageBubble key={msg.id} message={msg} peerNameMap={peerNameMap} />
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
      <div className="border-t border-border pb-safe-bottom">
        <LoopChatInput
          onSend={handleSend}
          placeholder="Send a message to all agents..."
        />
      </div>
    </div>
  );
}
