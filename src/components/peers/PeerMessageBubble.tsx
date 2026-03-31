"use client";

import { type ReactNode } from "react";
import { Bot, User } from "lucide-react";
import type { PeerChatMessage } from "@/types/peer-chat";
import type { PeerNameMap } from "@/contexts/PeerChatContext";

interface PeerMessageBubbleProps {
  message: PeerChatMessage;
  /** Session ID → current display name map for live name resolution. */
  peerNameMap: PeerNameMap;
}

function formatTime(isoString: string): string {
  return new Date(isoString).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Resolve sender display name: prefer current name from map, fall back to stored name. */
function resolveSenderName(message: PeerChatMessage, peerNameMap: PeerNameMap): string {
  if (message.fromSessionId) {
    const currentName = peerNameMap.get(message.fromSessionId);
    if (currentName) return currentName;
  }
  return message.fromSessionName;
}

/** Mention token format: @<sid:UUID>, stored in body and resolved at render time. */
const MENTION_RE = /@<sid:([0-9a-f-]{36})>/g;

/** Parse message body and render @mentions as styled inline spans. */
function renderBodyWithMentions(body: string, peerNameMap: PeerNameMap): ReactNode {
  const matches = Array.from(body.matchAll(MENTION_RE));
  if (matches.length === 0) return body;

  const parts: ReactNode[] = [];
  let lastIndex = 0;

  for (const match of matches) {
    const matchIndex = match.index!;
    if (matchIndex > lastIndex) {
      parts.push(body.slice(lastIndex, matchIndex));
    }

    const sessionId = match[1];
    const name = peerNameMap.get(sessionId);
    parts.push(
      <span
        key={`mention-${matchIndex}`}
        className="text-primary font-medium"
        title={name ? `Session: ${sessionId}` : `Unknown session: ${sessionId}`}
      >
        @{name ?? sessionId.slice(0, 8)}
      </span>
    );

    lastIndex = matchIndex + match[0].length;
  }

  if (lastIndex < body.length) {
    parts.push(body.slice(lastIndex));
  }

  return <>{parts}</>;
}

export function PeerMessageBubble({ message, peerNameMap }: PeerMessageBubbleProps) {
  const renderedBody = renderBodyWithMentions(message.body, peerNameMap);

  if (message.isUserMessage) {
    return (
      <div className="flex items-start gap-2 max-w-[85%] ml-auto flex-row-reverse">
        <div className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-500/20 flex items-center justify-center mt-1">
          <User className="w-3.5 h-3.5 text-blue-400" />
        </div>
        <div className="flex flex-col gap-0.5 items-end">
          <div className="bg-blue-600/20 border border-blue-500/30 rounded-2xl rounded-tr-sm px-3 py-2 text-sm text-foreground whitespace-pre-wrap break-words">
            {renderedBody}
          </div>
          <span className="text-[10px] text-muted-foreground/60 pr-1">
            {formatTime(message.createdAt)}
          </span>
        </div>
      </div>
    );
  }

  const displayName = resolveSenderName(message, peerNameMap);

  return (
    <div className="flex items-start gap-2 max-w-[85%]">
      <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center mt-1">
        <Bot className="w-3.5 h-3.5 text-primary" />
      </div>
      <div className="flex flex-col gap-0.5">
        <span className="text-[10px] text-muted-foreground/80 font-medium pl-1">
          {displayName}
          {message.toSessionId && (
            <span className="text-muted-foreground/50 ml-1">(direct)</span>
          )}
        </span>
        <div className="bg-card border border-border rounded-2xl rounded-tl-sm px-3 py-2 text-sm text-foreground whitespace-pre-wrap break-words">
          {renderedBody}
        </div>
        <span className="text-[10px] text-muted-foreground/60 pl-1">
          {formatTime(message.createdAt)}
        </span>
      </div>
    </div>
  );
}
