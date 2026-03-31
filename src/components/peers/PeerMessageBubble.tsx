"use client";

import { Bot, User } from "lucide-react";
import type { PeerChatMessage } from "@/types/peer-chat";

interface PeerMessageBubbleProps {
  message: PeerChatMessage;
}

function formatTime(isoString: string): string {
  return new Date(isoString).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function PeerMessageBubble({ message }: PeerMessageBubbleProps) {
  if (message.isUserMessage) {
    return (
      <div className="flex items-start gap-2 max-w-[85%] ml-auto flex-row-reverse">
        <div className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-500/20 flex items-center justify-center mt-1">
          <User className="w-3.5 h-3.5 text-blue-400" />
        </div>
        <div className="flex flex-col gap-0.5 items-end">
          <div className="bg-blue-600/20 border border-blue-500/30 rounded-2xl rounded-tr-sm px-3 py-2 text-sm text-foreground whitespace-pre-wrap break-words">
            {message.body}
          </div>
          <span className="text-[10px] text-muted-foreground/60 pr-1">
            {formatTime(message.createdAt)}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-2 max-w-[85%]">
      <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center mt-1">
        <Bot className="w-3.5 h-3.5 text-primary" />
      </div>
      <div className="flex flex-col gap-0.5">
        <span className="text-[10px] text-muted-foreground/80 font-medium pl-1">
          {message.fromSessionName}
          {message.toSessionId && (
            <span className="text-muted-foreground/50 ml-1">(direct)</span>
          )}
        </span>
        <div className="bg-card border border-border rounded-2xl rounded-tl-sm px-3 py-2 text-sm text-foreground whitespace-pre-wrap break-words">
          {message.body}
        </div>
        <span className="text-[10px] text-muted-foreground/60 pl-1">
          {formatTime(message.createdAt)}
        </span>
      </div>
    </div>
  );
}
